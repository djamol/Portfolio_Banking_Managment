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

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const publicPath = path.join(__dirname, 'public');
const hasFrontend = fs.existsSync(path.join(publicPath, 'index.html'));

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
  host: HOST,
  port: PORT,
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

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    dbType: db.getDbType(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.use('/api/investments', investmentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/portfolio', portfolioRoutes);

if (hasFrontend) {
  logger.info('Serving bundled frontend from /public');
  app.use(express.static(publicPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  logger.warn('Frontend bundle not found; API-only mode');
  app.get('/', (req, res) => {
    res.send('Portfolio Management Backend API');
  });
}

logger.info('Initializing database before binding HTTP port', {
  note: 'Health checks will fail until database connection succeeds'
});

db.initializeDatabase()
  .then(() => {
    app.listen(PORT, HOST, () => {
      logger.info('Server is ready', {
        url: `http://${HOST}:${PORT}`,
        healthCheck: `http://${HOST}:${PORT}/api/health`,
        dbType: db.getDbType()
      });
    });
  })
  .catch((err) => {
    logger.logError('Application startup', err, {
      hint: 'Container will exit because the app cannot start without a database connection'
    });
    process.exit(1);
  });
