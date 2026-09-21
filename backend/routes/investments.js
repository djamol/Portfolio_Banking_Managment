const express = require('express');
const router = express.Router();
const store = require('../db');
const { resolveNav } = require('../utils/mf-api');

const VALID_TXN_TYPES = store.VALID_TXN_TYPES || new Set([
  'buy', 'sell', 'dividend', 'interest', 'fee', 'deposit', 'withdrawal', 'transfer_in', 'transfer_out'
]);

async function resolveMutualFundNav(schemeCode, investmentDate, savedNav) {
  if (!schemeCode) return { nav: savedNav, source: savedNav != null ? 'imported' : null };
  try {
    const resolved = await resolveNav(schemeCode, investmentDate);
    return { nav: resolved.nav, source: `mfapi-${resolved.source}` };
  } catch (error) {
    if (savedNav != null && savedNav !== '' && Number(savedNav) > 0) {
      return { nav: savedNav, source: 'imported' };
    }
    throw error;
  }
}

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

router.get('/transactions', async (req, res) => {
  try {
    const { investment_id, from, to, txn_type, limit, offset } = req.query;
    if (txn_type && !VALID_TXN_TYPES.has(txn_type)) {
      return res.status(400).json({ success: false, error: `Invalid txn_type: ${txn_type}` });
    }
    const result = await store.listTransactions({
      investment_id,
      from,
      to,
      txn_type,
      limit,
      offset
    });
    res.json({ success: true, data: result.rows, meta: result.meta });
  } catch (error) {
    console.error('Error listing investment transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/transactions', async (req, res) => {
  try {
    const { investment_id, txn_date, txn_type, units, price, cashflow_amount, notes } = req.body;
    if (!investment_id || !txn_date || !txn_type || cashflow_amount == null || cashflow_amount === '') {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: investment_id, txn_date, txn_type, cashflow_amount'
      });
    }
    if (!VALID_TXN_TYPES.has(txn_type)) {
      return res.status(400).json({ success: false, error: `Invalid txn_type: ${txn_type}` });
    }
    const created = await store.createTransaction({
      investment_id,
      txn_date,
      txn_type,
      units,
      price,
      cashflow_amount,
      notes
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Error creating investment transaction:', error);
    const status = /not found|required|Invalid/i.test(error.message) ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

router.put('/transactions/:txnId', async (req, res) => {
  try {
    const { investment_id, txn_date, txn_type, units, price, cashflow_amount, notes } = req.body;
    if (txn_type && !VALID_TXN_TYPES.has(txn_type)) {
      return res.status(400).json({ success: false, error: `Invalid txn_type: ${txn_type}` });
    }
    const updated = await store.updateTransaction(req.params.txnId, {
      investment_id,
      txn_date,
      txn_type,
      units,
      price,
      cashflow_amount,
      notes
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating investment transaction:', error);
    const status = /not found|required|Invalid/i.test(error.message) ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

router.delete('/transactions/:txnId', async (req, res) => {
  try {
    const deleted = await store.deleteTransaction(req.params.txnId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    res.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting investment transaction:', error);
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
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, units, nav_price, nav_source, avg_buy_price, invested_amount, profit_loss, investment_date, notes, mutual_fund_scheme_code, mutual_fund_scheme_name } = req.body;

    if (!website_app_name || !investment_type || !amount || !investment_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: website_app_name, investment_type, amount, investment_date'
      });
    }

    let resolvedNav = nav_price;
    let resolvedNavSource = nav_source || (nav_price != null ? 'imported' : null);
    if (investment_type === 'Mutual Fund' && mutual_fund_scheme_code) {
      const resolved = await resolveMutualFundNav(mutual_fund_scheme_code, investment_date, nav_price);
      resolvedNav = resolved.nav;
      resolvedNavSource = resolved.source;
    }

    const newInvestment = await store.createInvestment({
      website_app_name,
      investment_type,
      sub_type_name,
      sub_type_category,
      amount,
      units,
      nav_price: resolvedNav,
      nav_source: resolvedNavSource,
      mutual_fund_scheme_code,
      mutual_fund_scheme_name,
      avg_buy_price,
      invested_amount,
      profit_loss,
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
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, units, nav_price, nav_source, avg_buy_price, invested_amount, profit_loss, investment_date, notes, mutual_fund_scheme_code, mutual_fund_scheme_name } = req.body;
    let resolvedNav = nav_price;
    let resolvedNavSource = nav_source || (nav_price != null ? 'imported' : null);
    if (investment_type === 'Mutual Fund' && mutual_fund_scheme_code) {
      const resolved = await resolveMutualFundNav(mutual_fund_scheme_code, investment_date, nav_price);
      resolvedNav = resolved.nav;
      resolvedNavSource = resolved.source;
    }
    const updatedInvestment = await store.updateInvestment(req.params.id, {
      website_app_name,
      investment_type,
      sub_type_name,
      sub_type_category,
      amount,
      units,
      nav_price: resolvedNav,
      nav_source: resolvedNavSource,
      mutual_fund_scheme_code,
      mutual_fund_scheme_name,
      avg_buy_price,
      invested_amount,
      profit_loss,
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
