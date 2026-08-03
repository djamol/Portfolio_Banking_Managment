#!/bin/sh
set -e

# Optional in-container MariaDB/MySQL. Enable with EMBEDDED_MYSQL=true|1|yes
# When disabled (default), the app uses DB_HOST as usual (e.g. host.docker.internal or compose "db").

is_truthy() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

start_embedded_mysql() {
  DB_NAME="${DB_NAME:-portfolio}"
  DB_USER="${DB_USER:-root}"
  DB_PASSWORD="${DB_PASSWORD:-${MYSQL_ROOT_PASSWORD:-portfolio}}"
  MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$DB_PASSWORD}"
  DATADIR="${MYSQL_DATADIR:-/var/lib/mysql}"
  SOCKET="${MYSQL_UNIX_PORT:-/run/mysqld/mysqld.sock}"
  # Internal listen port 3306; publish as host 3307 via -p 3307:3306
  EMBEDDED_MYSQL_PORT="${EMBEDDED_MYSQL_PORT:-3306}"
  DB_PORT="${DB_PORT:-$EMBEDDED_MYSQL_PORT}"

  export DB_HOST=127.0.0.1
  export DB_PORT
  export DB_PASSWORD
  export MYSQL_ROOT_PASSWORD

  mkdir -p /run/mysqld "$DATADIR"
  chown -R mysql:mysql /run/mysqld "$DATADIR"

  if [ ! -d "$DATADIR/mysql" ]; then
    echo "[entrypoint] Initializing embedded MySQL data directory..."
    mariadb-install-db --user=mysql --datadir="$DATADIR" --auth-root-authentication-method=normal >/dev/null
  fi

  echo "[entrypoint] Starting embedded MySQL on port ${EMBEDDED_MYSQL_PORT} (publish host:3307 → container:${EMBEDDED_MYSQL_PORT})..."
  mysqld \
    --user=mysql \
    --datadir="$DATADIR" \
    --socket="$SOCKET" \
    --bind-address=0.0.0.0 \
    --port="$EMBEDDED_MYSQL_PORT" \
    --skip-networking=0 \
    --console &
  MYSQL_PID=$!

  echo "[entrypoint] Waiting for embedded MySQL (pid $MYSQL_PID)..."
  i=0
  max="${EMBEDDED_MYSQL_WAIT_RETRIES:-60}"
  while [ "$i" -lt "$max" ]; do
    if mysqladmin --socket="$SOCKET" ping --silent 2>/dev/null; then
      break
    fi
    # Fail fast if mysqld exited
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

  # Fresh install: root has no password. Restarts: use MYSQL_ROOT_PASSWORD.
  # Also allow TCP clients (host-mapped -p 3307:3306) via root@'%'.
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

  echo "[entrypoint] Embedded MySQL ready on container :${EMBEDDED_MYSQL_PORT} (map -p 3307:3306, database=${DB_NAME})"
}

if is_truthy "${EMBEDDED_MYSQL:-false}"; then
  if [ "$(printf '%s' "${DB_TYPE:-mysql}" | tr '[:upper:]' '[:lower:]')" = "mongodb" ]; then
    echo "[entrypoint] EMBEDDED_MYSQL is set but DB_TYPE=mongodb — skipping embedded MySQL"
  else
    start_embedded_mysql
  fi
fi

exec "$@"
