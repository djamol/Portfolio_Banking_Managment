const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./config/index');
const investmentRoutes = require('./routes/investments');
const analyticsRoutes = require('./routes/analytics');
const categoriesRoutes = require('./routes/categories');
const portfolioRoutes = require('./routes/portfolio');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// CRITICAL FIX: Place trust proxy right after initializing app
app.enable('trust proxy');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check for login / connectivity tests
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', dbType: db.getDbType() });
});

// Routes
app.use('/api/investments', investmentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/portfolio', portfolioRoutes);

// Serve Angular frontend when bundled in single-container image (./public)
const publicPath = path.join(__dirname, 'public');
const hasFrontend = fs.existsSync(path.join(publicPath, 'index.html'));

if (hasFrontend) {
  app.use(express.static(publicPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('Portfolio Management Backend API');
  });
}

// Initialize database and start server
db.initializeDatabase()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Database type: ${db.getDbType()}`);
      console.log(`[${new Date().toLocaleString()}] Server is running on http://${HOST}:${PORT}`);
      console.log(`Local access: http://localhost:${PORT}`);
      console.log(`Network access: use your machine IP or domain with port ${PORT}, e.g. http://your-domain.com:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
  });