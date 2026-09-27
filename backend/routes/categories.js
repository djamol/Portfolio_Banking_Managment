const express = require('express');
const router = express.Router();
const store = require('../db');
const { syncLookupTablesFromInvestments } = require('../utils/sync-lookup-tables');

router.get('/sub-type-names', async (req, res) => {
  try {
    const rows = await store.getAllSubTypeNames();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching sub-type names:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sub-type-names', async (req, res) => {
  try {
    const { name, investment_type } = req.body;

    if (!name || !investment_type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, investment_type'
      });
    }

    const newSubType = await store.createSubTypeName({ name, investment_type });
    res.status(201).json({ success: true, data: newSubType });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Sub-type name already exists'
      });
    }
    console.error('Error creating sub-type name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sub-type-names/:investmentType', async (req, res) => {
  try {
    const rows = await store.getSubTypeNamesByType(req.params.investmentType);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching sub-type names:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const rows = await store.getAllCategories();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { category, sub_type_name_id, investment_type } = req.body;

    if (!category || !investment_type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: category, investment_type'
      });
    }

    const newCategory = await store.createCategory({ category, sub_type_name_id, investment_type });
    res.status(201).json({ success: true, data: newCategory });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Category already exists for this sub-type'
      });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Scan investments, group by investment_type + sub_type_name (+ category),
 * and insert any missing rows into sub_type_names / sub_type_categories.
 */
router.post('/sync-from-investments', async (req, res) => {
  try {
    const data = await syncLookupTablesFromInvestments(store);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error syncing lookup tables from investments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/categories/:investmentType/:subTypeNameId?', async (req, res) => {
  try {
    const { investmentType, subTypeNameId } = req.params;
    const rows = await store.getCategories(investmentType, subTypeNameId);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/sub-type-names/:id', async (req, res) => {
  try {
    await store.deleteSubTypeName(req.params.id);
    res.json({ success: true, message: 'Sub-type name deleted successfully' });
  } catch (error) {
    console.error('Error deleting sub-type name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await store.deleteCategory(req.params.id);
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
