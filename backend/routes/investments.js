const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get all investments
router.get('/', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT * FROM investments 
      ORDER BY investment_date DESC, created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investment by ID
router.get('/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(
      'SELECT * FROM investments WHERE id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new investment
router.post('/', async (req, res) => {
  try {
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes } = req.body;
    
    if (!website_app_name || !investment_type || !amount || !investment_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: website_app_name, investment_type, amount, investment_date' 
      });
    }

    const pool = db.getPool();
    const [result] = await pool.query(
      `INSERT INTO investments (website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [website_app_name, investment_type, sub_type_name || null, sub_type_category || null, amount, investment_date, notes || null]
    );

    // Add to history
    await pool.query(
      `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
       VALUES (?, ?, ?, 'added', ?)`,
      [result.insertId, amount, investment_date, notes || null]
    );

    const [newInvestment] = await pool.query(
      'SELECT * FROM investments WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({ success: true, data: newInvestment[0] });
  } catch (error) {
    console.error('Error creating investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update investment
router.put('/:id', async (req, res) => {
  try {
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes } = req.body;
    
    const pool = db.getPool();
    
    // Get old amount for history
    const [oldInvestment] = await pool.query(
      'SELECT amount FROM investments WHERE id = ?',
      [req.params.id]
    );

    if (oldInvestment.length === 0) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }

    await pool.query(
      `UPDATE investments 
       SET website_app_name = ?, investment_type = ?, sub_type_name = ?, 
           sub_type_category = ?, amount = ?, investment_date = ?, notes = ?
       WHERE id = ?`,
      [website_app_name, investment_type, sub_type_name || null, sub_type_category || null, 
       amount, investment_date, notes || null, req.params.id]
    );

    // Add to history if amount changed
    if (oldInvestment[0].amount !== amount) {
      await pool.query(
        `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
         VALUES (?, ?, ?, 'updated', ?)`,
        [req.params.id, amount, investment_date || new Date().toISOString().split('T')[0], notes || null]
      );
    }

    const [updatedInvestment] = await pool.query(
      'SELECT * FROM investments WHERE id = ?',
      [req.params.id]
    );

    res.json({ success: true, data: updatedInvestment[0] });
  } catch (error) {
    console.error('Error updating investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete investment
router.delete('/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    
    // Get investment details before deletion for history
    const [investment] = await pool.query(
      'SELECT * FROM investments WHERE id = ?',
      [req.params.id]
    );

    if (investment.length === 0) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }

    // Add to history
    await pool.query(
      `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
       VALUES (?, ?, ?, 'removed', ?)`,
      [req.params.id, investment[0].amount, new Date().toISOString().split('T')[0], investment[0].notes || null]
    );

    // Delete investment
    await pool.query('DELETE FROM investments WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: 'Investment deleted successfully' });
  } catch (error) {
    console.error('Error deleting investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;