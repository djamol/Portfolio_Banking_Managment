const express = require('express');
const cors = require('cors');
const db = require('./config/database');
const investmentRoutes = require('./routes/investments');
const analyticsRoutes = require('./routes/analytics');
const categoriesRoutes = require('./routes/categories');
const portfolioRoutes = require('./routes/portfolio');
app.enable('trust proxy');

const app = express();
const PORT = process.env.PORT || 3000; // 

// CRITICAL FIX: Place trust proxy right after initializing app
app.enable('trust proxy');

app.use(cors());
app.use(express.json());

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
    app.listen(PORT, () => {
      console.log(`Tables created successfully`);
      console.log(`Database initialized successfully`);
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
  });