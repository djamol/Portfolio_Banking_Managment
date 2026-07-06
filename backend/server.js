const express = require('express');
const cors = require('cors');
const db = require('./config/database');
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
  res.json({ success: true, status: 'ok' });
});

// Routes
app.use('/api/investments', investmentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/portfolio', portfolioRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.send('Portfolio Management Backend API');
});

// Initialize database and start server
db.initializeDatabase()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Tables created successfully`);
      console.log(`Database initialized successfully`);
      console.log(`[${new Date().toLocaleString()}] Server is running on http://${HOST}:${PORT}`);
      console.log(`Local access: http://localhost:${PORT}`);
      console.log(`Network access: use your machine IP or domain with port ${PORT}, e.g. http://your-domain.com:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
  });