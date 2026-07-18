// DirectAdmin_run.js Only for DirectAdmin Node.js panel Its not main file for the app 
// main file is server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./config/index');
const logger = require('./utils/logger');
const investmentRoutes = require('./routes/investments');
const analyticsRoutes = require('./routes/analytics');
const categoriesRoutes = require('./routes/categories');
const portfolioRoutes = require('./routes/portfolio');
const configRoutes = require('./routes/config');
const bankingRoutes = require('./routes/banking');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// DirectAdmin Application URL path (e.g. /portfolio). Proxy forwards the full path.
const BASE_PATH = String(process.env.BASE_PATH || '/portfolio').replace(/\/$/, '') || '';
const publicPath = path.join(__dirname, 'public');
const hasFrontend = fs.existsSync(path.join(publicPath, 'index.html'));

let httpServerModule;
let nginxUnitMode = false;
try {
  httpServerModule = require('unit-http');
  nginxUnitMode = true;
} catch {
  httpServerModule = require('http');
}

process.on('unhandledRejection', (reason) => {
  logger.logError('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  logger.logError('Uncaught exception', error);
  process.exit(1);
});

logger.info('Portfolio app starting', {
  nodeVersion: process.version,
  pid: process.pid,
  cwd: process.cwd(),
  runtime: nginxUnitMode ? 'nginx-unit' : 'standalone',
  host: nginxUnitMode ? '(managed by nginx unit)' : HOST,
  port: nginxUnitMode ? '(managed by nginx unit)' : PORT,
  basePath: BASE_PATH || '/',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbType: db.getDbType(),
  frontendBundled: hasFrontend,
  publicPath
});

app.enable('trust proxy');
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - started;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ip: req.ip
    });
  });
  next();
});

const router = express.Router();

router.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    dbType: db.getDbType(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

router.use('/api/investments', investmentRoutes);
router.use('/api/analytics', analyticsRoutes);
router.use('/api/categories', categoriesRoutes);
router.use('/api/portfolio', portfolioRoutes);
router.use('/api/config', configRoutes);
router.use('/api/banking', bankingRoutes);

if (hasFrontend) {
  logger.info('Serving bundled frontend from /public', { basePath: BASE_PATH || '/' });
  router.use(express.static(publicPath));
  router.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  logger.warn('Frontend bundle not found; API-only mode');
  router.get('/', (req, res) => {
    res.send('Portfolio Management Backend API');
  });
}

app.use(BASE_PATH || '/', router);

logger.info('Initializing database before binding HTTP port', {
  note: 'Health checks will fail until database connection succeeds'
});

function bindHttpServer() {
  return new Promise((resolve, reject) => {
    const healthPath = `${BASE_PATH}/api/health`;

    if (nginxUnitMode) {
      const server = httpServerModule.createServer(app);
      server.listen(() => {
        logger.info('Server is ready', {
          runtime: 'nginx-unit',
          basePath: BASE_PATH || '/',
          healthCheck: healthPath,
          dbType: db.getDbType()
        });
        resolve(server);
      });
      server.on('error', reject);
      return;
    }

    const server = app.listen(PORT, HOST, () => {
      logger.info('Server is ready', {
        runtime: 'standalone',
        url: `http://${HOST}:${PORT}${BASE_PATH || ''}`,
        healthCheck: `http://${HOST}:${PORT}${healthPath}`,
        dbType: db.getDbType()
      });
      resolve(server);
    });
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.logError('Port already in use', error, {
          hint: nginxUnitMode
            ? 'Restart the app from DirectAdmin Node.js panel instead of running node server.js manually'
            : `Stop the process using port ${PORT} or set PORT to a free port`
        });
      }
      reject(error);
    });
  });
}

db.initializeDatabase()
  .then(() => bindHttpServer())
  .catch((err) => {
    logger.logError('Application startup', err, {
      hint: 'Container will exit because the app cannot start without a database connection'
    });
    process.exit(1);
  });
