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

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/config ./config
COPY backend/db ./db
COPY backend/routes ./routes
COPY backend/utils ./utils
COPY backend/server.js ./

COPY --from=frontend-build /app/frontend/dist/portfolio-frontend ./public

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

EXPOSE 3000

# DB retries can take up to ~30s (15 x 2s); allow extra time before marking unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "const p=Number(process.env.PORT);const port=(!Number.isFinite(p)||p<=0)?3000:p;require('http').get('http://127.0.0.1:'+port+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
