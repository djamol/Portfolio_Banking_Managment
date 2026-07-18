const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const banking = require('../db/banking');
const { parseBankStatement } = require('../utils/bank-parsers');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 }
});

router.get('/accounts', async (req, res) => {
  try {
    const rows = await banking.getAccounts();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    const { bank_name, account_name } = req.body;
    if (!bank_name || !account_name) {
      return res.status(400).json({ success: false, error: 'bank_name and account_name are required' });
    }
    const row = await banking.createAccount(req.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error('Error creating bank account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  try {
    const existing = await banking.getAccountById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Account not found' });
    const row = await banking.updateAccount(req.params.id, req.body);
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('Error updating bank account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const ok = await banking.deleteAccount(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Account not found' });
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    console.error('Error deleting bank account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const result = await banking.getTransactions(req.query);
    res.json({ success: true, data: result.rows, meta: { total: result.total, limit: result.limit, offset: result.offset } });
  } catch (error) {
    console.error('Error fetching bank transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/transactions/:id', async (req, res) => {
  try {
    const row = await banking.updateTransaction(req.params.id, req.body);
    if (!row) return res.status(404).json({ success: false, error: 'Transaction not found' });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('Error updating bank transaction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const ok = await banking.deleteTransaction(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Transaction not found' });
    res.json({ success: true, message: 'Transaction deleted' });
  } catch (error) {
    console.error('Error deleting bank transaction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/transactions/bulk-categorize', async (req, res) => {
  try {
    const { ids, category } = req.body;
    if (!Array.isArray(ids) || !category) {
      return res.status(400).json({ success: false, error: 'ids[] and category are required' });
    }
    const updated = await banking.bulkCategorize(ids, category);
    res.json({ success: true, data: { updated } });
  } catch (error) {
    console.error('Error bulk categorizing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/recategorize', async (req, res) => {
  try {
    const updated = await banking.recategorizeAll(req.body.account_id);
    res.json({ success: true, data: { updated } });
  } catch (error) {
    console.error('Error recategorizing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const rows = await banking.getCategories();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const data = await banking.getAnalytics(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching bank analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }
    const accountId = Number(req.body.account_id);
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'account_id is required' });
    }

    const account = await banking.getAccountById(accountId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    const bankHint = req.body.bank_hint || account.bank_name || '';
    const parsed = parseBankStatement({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      accountId,
      bankHint
    });

    const importBatchId = crypto.randomBytes(8).toString('hex');
    const result = await banking.importTransactions(accountId, parsed.transactions, importBatchId);

    // Auto-fill account number / IFSC from statement meta when missing
    const metaUpdates = {};
    if (!account.account_number && parsed.meta?.accountNumber) {
      metaUpdates.account_number = parsed.meta.accountNumber;
    }
    if (!account.ifsc && parsed.meta?.ifsc) {
      metaUpdates.ifsc = parsed.meta.ifsc;
    }
    if (Object.keys(metaUpdates).length) {
      await banking.updateAccount(accountId, { ...account, ...metaUpdates });
    }

    res.json({
      success: true,
      data: {
        bank: parsed.bank,
        meta: parsed.meta,
        parsed: parsed.transactions.length,
        ...result,
        sample: parsed.transactions.slice(0, 5)
      }
    });
  } catch (error) {
    console.error('Error importing bank statement:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }
    const accountId = Number(req.body.account_id);
    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'Select a target account before preview to check existing vs new transactions'
      });
    }

    const account = await banking.getAccountById(accountId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    const bankHint = req.body.bank_hint || account.bank_name || '';
    const parsed = parseBankStatement({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      accountId,
      bankHint
    });

    const fingerprints = parsed.transactions.map((t) => t.fingerprint);
    const existingSet = await banking.findExistingFingerprints(accountId, fingerprints);

    const newTxns = [];
    const existingTxns = [];
    for (const txn of parsed.transactions) {
      if (existingSet.has(txn.fingerprint)) existingTxns.push(txn);
      else newTxns.push(txn);
    }

    res.json({
      success: true,
      data: {
        bank: parsed.bank,
        meta: parsed.meta,
        count: parsed.transactions.length,
        existing_count: existingTxns.length,
        new_count: newTxns.length,
        preview: newTxns.slice(0, 25),
        existing_preview: existingTxns.slice(0, 10),
        categories: [...new Set(parsed.transactions.map((t) => t.category))].sort()
      }
    });
  } catch (error) {
    console.error('Error previewing bank statement:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
