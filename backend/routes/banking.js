const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const banking = require('../db/banking');
const { parseBankStatement } = require('../utils/bank-parsers');
const {
  buildTransactionsWorkbook,
  buildStatementWorkbook,
  buildStatementPdf,
  workbookToBuffer,
  parseTransactionsUpload
} = require('../utils/bank-txn-io');

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
    res.json({
      success: true,
      data: result.rows,
      meta: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        total_debit: result.total_debit,
        total_credit: result.total_credit,
        net_cashflow: result.net_cashflow
      }
    });
  } catch (error) {
    console.error('Error fetching bank transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/transactions', async (req, res) => {
  try {
    const { account_id, txn_date } = req.body;
    if (!account_id || !txn_date) {
      return res.status(400).json({ success: false, error: 'account_id and txn_date are required' });
    }
    if (!req.body.withdrawal && !req.body.deposit) {
      return res.status(400).json({ success: false, error: 'withdrawal or deposit is required' });
    }
    const row = await banking.createTransaction(req.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error('Error creating transaction:', error);
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

router.post('/transactions/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, error: 'ids[] is required' });
    }
    const deleted = await banking.bulkDelete(ids);
    res.json({ success: true, data: { deleted } });
  } catch (error) {
    console.error('Error bulk deleting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/recategorize', async (req, res) => {
  try {
    const mode = req.body.mode || 'auto_only';
    const customRules = await banking.getCategoryRules();
    const updated = await banking.recategorizeAll(req.body.account_id, { mode, customRules });
    res.json({ success: true, data: { updated, mode } });
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

router.get('/rules', async (req, res) => {
  try {
    const rows = await banking.getCategoryRules();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/rules', async (req, res) => {
  try {
    const { pattern, category } = req.body;
    if (!pattern || !category) {
      return res.status(400).json({ success: false, error: 'pattern and category are required' });
    }
    const row = await banking.createCategoryRule(req.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error('Error creating rule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/rules/:id', async (req, res) => {
  try {
    const row = await banking.updateCategoryRule(req.params.id, req.body);
    if (!row) return res.status(404).json({ success: false, error: 'Rule not found' });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('Error updating rule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/rules/:id', async (req, res) => {
  try {
    const ok = await banking.deleteCategoryRule(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Rule not found' });
    res.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    console.error('Error deleting rule:', error);
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

router.get('/analytics/by-payee', async (req, res) => {
  try {
    const data = await banking.getAnalyticsByPayee(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching payee analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/cash-summary', async (req, res) => {
  try {
    const data = await banking.getCashSummary();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching cash summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/accounts/:id/continuity', async (req, res) => {
  try {
    const data = await banking.balanceContinuity(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error checking continuity:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/duplicates/scan', async (req, res) => {
  try {
    const accountId = req.query.account_id || null;
    const data = await banking.findNearDuplicates(accountId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error scanning near-duplicates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/duplicates/clean', async (req, res) => {
  try {
    const accountId = req.body.account_id != null && req.body.account_id !== '' ? req.body.account_id : null;
    const deleteIds = Array.isArray(req.body.delete_ids) ? req.body.delete_ids : null;
    const data = await banking.cleanNearDuplicates(accountId, {
      deleteIds,
      dryRun: !!req.body.dry_run
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error cleaning near-duplicates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/budgets', async (req, res) => {
  try {
    const rows = await banking.getBudgets(req.query.period_month);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/budgets/status', async (req, res) => {
  try {
    const rows = await banking.budgetStatus(req.query.period_month, {
      exclude_transfers: req.query.exclude_transfers
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching budget status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/budgets', async (req, res) => {
  try {
    if (!req.body.category || req.body.amount == null) {
      return res.status(400).json({ success: false, error: 'category and amount are required' });
    }
    const row = await banking.upsertBudget(req.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error('Error saving budget:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/budgets/:id', async (req, res) => {
  try {
    const ok = await banking.deleteBudget(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Budget not found' });
    res.json({ success: true, message: 'Budget deleted' });
  } catch (error) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/recurring', async (req, res) => {
  try {
    const rows = await banking.getRecurring(req.query.account_id);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error detecting recurring:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/transfers/match', async (req, res) => {
  try {
    const data = await banking.matchTransfers(req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error matching transfers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/forecast', async (req, res) => {
  try {
    const data = await banking.getForecast(req.query.account_id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching forecast:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/import/batches/:batchId', async (req, res) => {
  try {
    const data = await banking.undoImportBatch(req.params.batchId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error undoing import batch:', error);
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

    const customRules = await banking.getCategoryRules();
    const bankHint = req.body.bank_hint || account.bank_name || '';
    const parsed = await parseBankStatement({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      accountId,
      bankHint,
      accountNumber: account.account_number || null,
      customRules,
      password: req.body.pdf_password || req.body.password || ''
    });

    const importBatchId = crypto.randomBytes(8).toString('hex');
    const result = await banking.importTransactions(accountId, parsed.transactions, importBatchId);

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

    // Opening balance continuity hint
    let openingWarning = null;
    if (parsed.transactions.length && account.opening_balance != null) {
      const sorted = [...parsed.transactions].sort((a, b) =>
        String(a.txn_date).localeCompare(String(b.txn_date))
      );
      const first = sorted.find((t) => t.balance != null);
      if (first) {
        const expected = Number(account.opening_balance) - Number(first.withdrawal || 0) + Number(first.deposit || 0);
        if (Math.abs(expected - Number(first.balance)) > 1) {
          openingWarning = {
            opening_balance: Number(account.opening_balance),
            first_txn_balance: Number(first.balance),
            first_txn_date: first.txn_date
          };
        }
      }
    }

    res.json({
      success: true,
      data: {
        bank: parsed.bank,
        meta: parsed.meta,
        parsed: parsed.transactions.length,
        ...result,
        sample: parsed.transactions.slice(0, 5),
        opening_warning: openingWarning
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

    const customRules = await banking.getCategoryRules();
    const bankHint = req.body.bank_hint || account.bank_name || '';
    const parsed = await parseBankStatement({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      accountId,
      bankHint,
      accountNumber: account.account_number || null,
      customRules,
      password: req.body.pdf_password || req.body.password || ''
    });

    const fingerprints = parsed.transactions.map((t) => t.fingerprint);
    const existingSet = await banking.findExistingFingerprints(accountId, fingerprints);

    const newTxns = [];
    const existingTxns = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let minDate = null;
    let maxDate = null;
    for (const txn of parsed.transactions) {
      totalDebit += Number(txn.withdrawal) || 0;
      totalCredit += Number(txn.deposit) || 0;
      if (!minDate || txn.txn_date < minDate) minDate = txn.txn_date;
      if (!maxDate || txn.txn_date > maxDate) maxDate = txn.txn_date;
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
        date_from: minDate,
        date_to: maxDate,
        total_debit: Math.round(totalDebit * 100) / 100,
        total_credit: Math.round(totalCredit * 100) / 100,
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

router.get('/export/transactions', async (req, res) => {
  try {
    const filters = { ...req.query };
    delete filters.limit;
    delete filters.offset;
    delete filters.format;
    delete filters.layout;
    const rows = await banking.getTransactionsExport(filters);
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const layout = String(req.query.layout || 'statement').toLowerCase();
    const meta = {
      exported_at: new Date().toISOString(),
      account_id: req.query.account_id || '',
      from: req.query.from || '',
      to: req.query.to || '',
      row_count: rows.length
    };
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (layout === 'raw' || format === 'csv') {
      const wb = buildTransactionsWorkbook(rows, meta);
      if (format === 'csv') {
        const XLSX = require('xlsx');
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets.Transactions);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="bank_transactions_${dateStamp}.csv"`
        );
        return res.send(csv);
      }
      const buf = workbookToBuffer(wb);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="bank_transactions_backup_${dateStamp}.xlsx"`
      );
      return res.send(buf);
    }

    const accounts = await banking.getAccounts();
    const accountsById = new Map(accounts.map((a) => [Number(a.id), a]));

    if (format === 'pdf') {
      const buf = await buildStatementPdf(rows, accountsById, meta);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Acct_Statement_${dateStamp}.pdf"`
      );
      return res.send(buf);
    }

    const wb = buildStatementWorkbook(rows, accountsById, meta);
    const buf = workbookToBuffer(wb);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Acct_Statement_${dateStamp}.xlsx"`
    );
    return res.send(buf);
  } catch (error) {
    console.error('Error exporting bank transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/import/transactions', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'file is required (.xlsx or .csv)' });
    }
    const rows = parseTransactionsUpload(req.file.buffer, req.file.originalname);
    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: 'No valid transaction rows found. Export XLS must include account_id and txn_date.'
      });
    }
    const importBatchId = `bak_${crypto.randomBytes(6).toString('hex')}`;
    const result = await banking.importTransactionBackup(rows, importBatchId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error importing bank transaction backup:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
