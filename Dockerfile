# Single-container build: Angular frontend + Express backend
# Stage 1 — build frontend
FROM node:20-alpine AS frontend-build

# Back4App/Kaniko builders often have limited RAM; keep Angular build within bounds
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV NG_BUILD_MAX_WORKERS=1
ENV CI=true

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci && npm cache clean --force

COPY frontend/angular.json frontend/tsconfig.json frontend/tsconfig.app.json ./
COPY frontend/src ./src

RUN node ./node_modules/@angular/cli/bin/ng build --configuration production --base-href /

# Stage 2 — backend + serve static frontend
FROM node:20-alpine

# MariaDB packages are present for optional in-image MySQL (EMBEDDED_MYSQL=true).
# Default remains external DB via DB_HOST (compose "db" or host.docker.internal).
RUN apk add --no-cache mariadb mariadb-client \
  && mkdir -p /run/mysqld /var/lib/mysql \
  && chown -R mysql:mysql /run/mysqld /var/lib/mysql

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/config ./config
COPY backend/db ./db
COPY backend/routes ./routes
COPY backend/utils ./utils
COPY backend/server.js ./

COPY --from=frontend-build /app/frontend/dist/portfolio-frontend ./public

COPY docker-entrypoint.sh /docker-entrypoint.sh
# Strip CRLF (Windows checkouts) so shebang resolves under Linux
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info

# Defaults shown in Docker Desktop "Run container" (override as needed)
ENV DB_TYPE=mysql
ENV DB_HOST=host.docker.internal
ENV DB_USER=root
ENV DB_PASSWORD=
ENV DB_NAME=portfolio
ENV PORT=3000
# Set EMBEDDED_MYSQL=true to start MariaDB inside this container (DB_HOST forced to 127.0.0.1)
ENV EMBEDDED_MYSQL=false
ENV EMBEDDED_MYSQL_PORT=3306
ENV MYSQL_ROOT_PASSWORD=portfolio

EXPOSE 3000
# Container MySQL :3306 — publish as host 3307 with -p 3307:3306
EXPOSE 3306

VOLUME ["/var/lib/mysql"]

# DB retries can take up to ~30s (15 x 2s); embedded MySQL init may need longer
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "const p=Number(process.env.PORT);const port=(!Number.isFinite(p)||p<=0)?3000:p;require('http').get('http://127.0.0.1:'+port+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
