const express = require('express');
const cors = require('cors');
const db = require('./config/database');
const investmentRoutes = require('./routes/investments');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3000; // Changed back to 3000

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/investments', investmentRoutes);
app.use('/api/analytics', analyticsRoutes);

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