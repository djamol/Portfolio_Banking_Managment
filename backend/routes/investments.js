const express = require('express');
const router = express.Router();
const store = require('../db');

router.get('/', async (req, res) => {
  try {
    const rows = await store.getAllInvestments();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const { website_app_name, sub_type_name, sub_type_category } = req.query;
    const rows = await store.searchInvestments({ website_app_name, sub_type_name, sub_type_category });
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error searching investments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await store.getInvestmentById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('Error fetching investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes } = req.body;

    if (!website_app_name || !investment_type || !amount || !investment_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: website_app_name, investment_type, amount, investment_date'
      });
    }

    const newInvestment = await store.createInvestment({
      website_app_name,
      investment_type,
      sub_type_name,
      sub_type_category,
      amount,
      investment_date,
      notes
    });

    res.status(201).json({ success: true, data: newInvestment });
  } catch (error) {
    console.error('Error creating investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes } = req.body;
    const updatedInvestment = await store.updateInvestment(req.params.id, {
      website_app_name,
      investment_type,
      sub_type_name,
      sub_type_category,
      amount,
      investment_date,
      notes
    });

    if (!updatedInvestment) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }

    res.json({ success: true, data: updatedInvestment });
  } catch (error) {
    console.error('Error updating investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await store.deleteInvestment(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }
    res.json({ success: true, message: 'Investment deleted successfully' });
  } catch (error) {
    console.error('Error deleting investment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
