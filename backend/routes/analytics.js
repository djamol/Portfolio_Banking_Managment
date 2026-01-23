const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get total portfolio value
router.get('/total', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT SUM(amount) as total_amount, COUNT(*) as total_investments
      FROM investments
    `);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching total:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by type
router.get('/by-type', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        investment_type,
        COUNT(*) as count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM investments
      GROUP BY investment_type
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by type:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by month
router.get('/by-month', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(investment_date, '%Y-%m') as month,
        SUM(amount) as total_amount,
        COUNT(*) as count
      FROM investments
      GROUP BY DATE_FORMAT(investment_date, '%Y-%m')
      ORDER BY month DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by month:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by year
router.get('/by-year', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        YEAR(investment_date) as year,
        SUM(amount) as total_amount,
        COUNT(*) as count
      FROM investments
      GROUP BY YEAR(investment_date)
      ORDER BY year DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by year:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get monthly changes (comparison)
router.get('/monthly-changes', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(change_date, '%Y-%m') as month,
        SUM(CASE WHEN change_type = 'added' THEN amount ELSE 0 END) as added,
        SUM(CASE WHEN change_type = 'removed' THEN amount ELSE 0 END) as removed,
        SUM(CASE WHEN change_type = 'updated' THEN amount ELSE 0 END) as updated
      FROM investment_history
      GROUP BY DATE_FORMAT(change_date, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching monthly changes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get yearly changes
router.get('/yearly-changes', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        YEAR(change_date) as year,
        SUM(CASE WHEN change_type = 'added' THEN amount ELSE 0 END) as added,
        SUM(CASE WHEN change_type = 'removed' THEN amount ELSE 0 END) as removed,
        SUM(CASE WHEN change_type = 'updated' THEN amount ELSE 0 END) as updated
      FROM investment_history
      GROUP BY YEAR(change_date)
      ORDER BY year DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching yearly changes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by website/app
router.get('/by-platform', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        website_app_name,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM investments
      GROUP BY website_app_name
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by platform:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get portfolio growth over time
router.get('/growth', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(investment_date, '%Y-%m') as month,
        SUM(amount) OVER (ORDER BY DATE_FORMAT(investment_date, '%Y-%m') ASC) as cumulative_amount
      FROM investments
      GROUP BY DATE_FORMAT(investment_date, '%Y-%m')
      ORDER BY month ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching growth:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by sub type name
router.get('/by-sub-type-name', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        sub_type_name,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM investments
      WHERE sub_type_name IS NOT NULL AND sub_type_name != ''
      GROUP BY sub_type_name
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by sub type name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by sub type category
router.get('/by-sub-type-category', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        sub_type_category,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM investments
      WHERE sub_type_category IS NOT NULL AND sub_type_category != ''
      GROUP BY sub_type_category
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by sub type category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investment summary table
router.get('/summary-table', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        id,
        website_app_name,
        investment_type,
        sub_type_name,
        sub_type_category,
        amount,
        investment_date
      FROM investments
      ORDER BY amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching summary table:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investment history by investment ID
router.get('/investment-history/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    const investmentId = req.params.id;
    const [rows] = await pool.query(`
      SELECT 
        id,
        investment_id,
        change_type,
        amount,
        change_date,
        notes
      FROM investment_history
      WHERE investment_id = ?
      ORDER BY change_date DESC
    `, [investmentId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching investment history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;