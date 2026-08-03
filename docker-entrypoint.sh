#!/bin/sh
set -e

# In-container MariaDB. Default ON for standalone image (EMBEDDED_MYSQL=true).
# Compose sets EMBEDDED_MYSQL=false and uses the separate "db" service.
# Publishing MySQL to the host is optional — Internal Docker DB uses 127.0.0.1:3306 inside.

is_truthy() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

# Pick host publish port hint: explicit value, or random in 3310–3999 when unset/random/auto
resolve_publish_port() {
  case "$(printf '%s' "${MYSQL_PUBLISH_PORT:-random}" | tr '[:upper:]' '[:lower:]')" in
    ''|random|auto|0)
      # $RANDOM is ash/bash; fall back to time-based if missing
      r="${RANDOM:-}"
      if [ -z "$r" ]; then
        r=$(awk 'BEGIN{srand(); print int(rand()*100000)}' 2>/dev/null || date +%S)
      fi
      echo $((3310 + (r % 690)))
      ;;
    *)
      echo "$MYSQL_PUBLISH_PORT"
      ;;
  esac
}

start_embedded_mysql() {
  DB_NAME="${DB_NAME:-portfolio}"
  DB_USER="${DB_USER:-root}"
  DB_PASSWORD="${DB_PASSWORD:-${MYSQL_ROOT_PASSWORD:-portfolio}}"
  MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$DB_PASSWORD}"
  DATADIR="${MYSQL_DATADIR:-/var/lib/mysql}"
  SOCKET="${MYSQL_UNIX_PORT:-/run/mysqld/mysqld.sock}"
  # Always listen on 3306 inside the container. Host publish is optional and separate.
  EMBEDDED_MYSQL_PORT="${EMBEDDED_MYSQL_PORT:-3306}"
  MYSQL_PUBLISH_PORT="$(resolve_publish_port)"

  if [ -n "${DB_PORT:-}" ] && [ "$DB_PORT" != "$EMBEDDED_MYSQL_PORT" ]; then
    echo "[entrypoint] Ignoring DB_PORT=${DB_PORT} for embedded MySQL (host publish port?). Using internal ${EMBEDDED_MYSQL_PORT}"
  fi

  export DB_HOST=127.0.0.1
  export DB_HOST_DOCKER=127.0.0.1
  export DB_PORT="$EMBEDDED_MYSQL_PORT"
  export EMBEDDED_MYSQL_PORT
  export MYSQL_PUBLISH_PORT
  export DB_PASSWORD
  export MYSQL_ROOT_PASSWORD
  export EMBEDDED_MYSQL=true

  mkdir -p /run/mysqld "$DATADIR"
  chown -R mysql:mysql /run/mysqld "$DATADIR"

  if [ ! -d "$DATADIR/mysql" ]; then
    echo "[entrypoint] Initializing embedded MySQL data directory..."
    mariadb-install-db --user=mysql --datadir="$DATADIR" --auth-root-authentication-method=normal >/dev/null
  fi

  echo "[entrypoint] Starting embedded MySQL on 0.0.0.0:${EMBEDDED_MYSQL_PORT} (internal; host publish optional)"
  mysqld \
    --user=mysql \
    --datadir="$DATADIR" \
    --socket="$SOCKET" \
    --bind-address=0.0.0.0 \
    --port="$EMBEDDED_MYSQL_PORT" \
    --skip-networking=0 \
    --skip-name-resolve \
    --console &
  MYSQL_PID=$!

  echo "[entrypoint] Waiting for embedded MySQL (pid $MYSQL_PID)..."
  i=0
  max="${EMBEDDED_MYSQL_WAIT_RETRIES:-60}"
  while [ "$i" -lt "$max" ]; do
    if mysqladmin --socket="$SOCKET" ping --silent 2>/dev/null; then
      break
    fi
    if ! kill -0 "$MYSQL_PID" 2>/dev/null; then
      echo "[entrypoint] Embedded MySQL process exited early" >&2
      exit 1
    fi
    i=$((i + 1))
    sleep 1
  done

  if ! mysqladmin --socket="$SOCKET" ping --silent 2>/dev/null; then
    echo "[entrypoint] Embedded MySQL failed to become ready" >&2
    kill "$MYSQL_PID" 2>/dev/null || true
    exit 1
  fi

  if mysql --socket="$SOCKET" -uroot -e "SELECT 1" >/dev/null 2>&1; then
    mysql --socket="$SOCKET" -uroot <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;
FLUSH PRIVILEGES;
SQL
  else
    mysql --socket="$SOCKET" -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';
ALTER USER 'root'@'%' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;
FLUSH PRIVILEGES;
SQL
  fi

  if [ "$DB_USER" != "root" ]; then
    mysql --socket="$SOCKET" -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
FLUSH PRIVILEGES;
SQL
  fi

  echo "[entrypoint] Embedded MySQL ready at 127.0.0.1:${EMBEDDED_MYSQL_PORT} (no host publish needed for the app)"
  echo "[entrypoint] Optional host access: docker run -p ${MYSQL_PUBLISH_PORT}:${EMBEDDED_MYSQL_PORT} ...  OR  -P (random host port)"
  echo "$MYSQL_PUBLISH_PORT" > /tmp/mysql-publish-port
}

# Default ON for standalone image; compose sets false
if is_truthy "${EMBEDDED_MYSQL:-true}"; then
  if [ "$(printf '%s' "${DB_TYPE:-mysql}" | tr '[:upper:]' '[:lower:]')" = "mongodb" ]; then
    echo "[entrypoint] EMBEDDED_MYSQL is set but DB_TYPE=mongodb — skipping embedded MySQL"
  else
    start_embedded_mysql
  fi
else
  echo "[entrypoint] EMBEDDED_MYSQL disabled — using external DB_HOST=${DB_HOST:-unset}"
fi

exec "$@"
