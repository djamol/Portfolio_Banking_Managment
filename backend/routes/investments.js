const express = require('express');
const multer = require('multer');
const router = express.Router();
const store = require('../db');
const { resolveNav } = require('../utils/mf-api');
const { xirr } = require('../db/investment-flows');
const { parseFdStatement } = require('../utils/fd-statement');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_TXN_TYPES = store.VALID_TXN_TYPES || new Set([
  'buy', 'sell', 'dividend', 'interest', 'fee', 'deposit', 'withdrawal', 'transfer_in', 'transfer_out'
]);

const INVESTMENT_FIELDS = [
  'website_app_name', 'investment_type', 'sub_type_name', 'sub_type_category', 'amount', 'units',
  'nav_price', 'nav_source', 'avg_buy_price', 'invested_amount', 'profit_loss', 'investment_date',
  'notes', 'mutual_fund_scheme_code', 'mutual_fund_scheme_name',
  'interest_rate', 'maturity_date', 'maturity_amount', 'payout_frequency', 'compounding', 'external_ref'
];
const BULK_MAX_IDS = 1000;

function mergeInvestment(existing, changes) {
  const merged = {};
  for (const key of INVESTMENT_FIELDS) {
    merged[key] = changes[key] !== undefined ? changes[key] : existing[key];
  }
  return merged;
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function resolveMutualFundNav(schemeCode, investmentDate, savedNav) {
  if (!schemeCode) return { nav: savedNav, source: savedNav != null ? 'imported' : null };
  try {
    const resolved = await resolveNav(schemeCode, investmentDate);
    return { nav: resolved.nav, source: `mfapi-${resolved.source}` };
  } catch (error) {
    if (savedNav != null && savedNav !== '' && Number(savedNav) > 0) {
      console.warn(`MFAPI NAV lookup failed for scheme ${schemeCode}; keeping saved NAV:`, error.message);
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

const FD_REF_PREFIX = 'fd';

function fdRef(accountNo) {
  return accountNo ? `${FD_REF_PREFIX}:${String(accountNo).replace(/\s/g, '')}` : null;
}

/** Match on external_ref, falling back to the notes tag when the column is missing. */
function findByRef(investments, ref) {
  if (!ref) return null;
  return investments.find((row) => row.external_ref === ref)
    || investments.find((row) => String(row.notes || '').includes(ref))
    || null;
}

function fdNotes(deposit) {
  return [
    deposit.account_no ? fdRef(deposit.account_no) : null,
    deposit.branch ? `branch:${deposit.branch}` : null,
    deposit.maturity_date ? `maturity:${deposit.maturity_date}` : null,
    deposit.interest_rate ? `rate:${deposit.interest_rate}` : null
  ].filter(Boolean).join('\n');
}

function fdInvestmentPayload(deposit, defaults) {
  const payoutFrequency = deposit.payout_frequency
    || (deposit.cumulative ? 'at-maturity' : defaults.payout_frequency || 'quarterly');
  return {
    website_app_name: deposit.platform || defaults.platform,
    investment_type: defaults.investment_type || 'FD',
    sub_type_name: deposit.sub_type_name || defaults.sub_type_name || 'Bank FD',
    sub_type_category: deposit.sub_type_category || deposit.tenure_category || null,
    amount: deposit.principal,
    invested_amount: deposit.principal,
    interest_rate: deposit.interest_rate ?? null,
    maturity_date: deposit.maturity_date || null,
    maturity_amount: deposit.maturity_amount ?? null,
    payout_frequency: payoutFrequency,
    compounding: payoutFrequency === 'at-maturity' ? (defaults.compounding || 'quarterly') : null,
    external_ref: fdRef(deposit.account_no),
    investment_date: deposit.start_date || todayYmd(),
    notes: fdNotes(deposit)
  };
}

router.post('/import/fd/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }

    const parsed = await parseFdStatement({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      password: req.body.password || ''
    });
    const investments = await store.getAllInvestments();

    const deposits = parsed.deposits.map((deposit) => {
      const ref = fdRef(deposit.account_no);
      const existing = findByRef(investments, ref);
      return {
        ...deposit,
        external_ref: ref,
        existing_id: existing ? existing.id : null,
        existing_amount: existing ? Number(existing.amount) : null,
        status: existing
          ? (Number(existing.amount) === deposit.principal ? 'unchanged' : 'update')
          : 'new'
      };
    });

    res.json({
      success: true,
      data: {
        bank: parsed.bank,
        holder: parsed.holder,
        skipped: parsed.skipped,
        count: deposits.length,
        total_principal: round2(deposits.reduce((sum, d) => sum + (d.principal || 0), 0)),
        deposits
      }
    });
  } catch (error) {
    console.error('Error previewing FD statement:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/import/fd', async (req, res) => {
  try {
    const { deposits, platform } = req.body || {};
    if (!Array.isArray(deposits) || !deposits.length) {
      return res.status(400).json({ success: false, error: 'deposits array is required' });
    }
    if (!platform) {
      return res.status(400).json({ success: false, error: 'platform is required' });
    }

    const defaults = {
      platform,
      investment_type: req.body.investment_type || 'FD',
      sub_type_name: req.body.sub_type_name || 'Bank FD',
      payout_frequency: req.body.payout_frequency || 'quarterly',
      compounding: req.body.compounding || 'quarterly'
    };

    const investments = await store.getAllInvestments();
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (const deposit of deposits) {
      try {
        if (!deposit.principal || !deposit.start_date) {
          errors.push(`Skipped ${deposit.account_no || 'row'}: missing principal or start date`);
          continue;
        }
        const payload = fdInvestmentPayload(deposit, defaults);
        const existing = findByRef(investments, payload.external_ref);
        if (existing) {
          await store.updateInvestment(existing.id, mergeInvestment(existing, payload));
          updated += 1;
        } else {
          await store.createInvestment(payload);
          imported += 1;
        }
      } catch (error) {
        errors.push(`${deposit.account_no || 'row'}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      data: { imported, updated, errors, totalProcessed: deposits.length },
      message: `FD import completed: ${imported} added, ${updated} updated.`
    });
  } catch (error) {
    console.error('Error importing FD statement:', error);
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

router.get('/returns', async (req, res) => {
  try {
    const [investments, txns] = await Promise.all([store.getAllInvestments(), store.getAllTransactions()]);
    const today = todayYmd();
    const flowsById = new Map();
    for (const t of txns) {
      const id = Number(t.investment_id);
      if (!flowsById.has(id)) flowsById.set(id, []);
      flowsById.get(id).push({ date: String(t.txn_date).slice(0, 10), amount: Number(t.cashflow_amount) });
    }

    const portfolioFlows = [];
    let portfolioTxnValue = 0;
    const summary = { invested: 0, received: 0, current_value: 0, gain: 0 };
    const items = [];

    for (const inv of investments) {
      const id = Number(inv.id);
      const current = Number(inv.amount) || 0;
      const flows = flowsById.get(id) || [];
      let basis = 'none';
      let invested = 0;
      let received = 0;
      let itemXirr = null;

      if (flows.length) {
        basis = 'transactions';
        for (const f of flows) {
          if (f.amount < 0) invested += -f.amount;
          else received += f.amount;
        }
        const terminal = current > 0 ? [{ date: today, amount: current }] : [];
        itemXirr = xirr([...flows, ...terminal]);
        portfolioFlows.push(...flows);
        portfolioTxnValue += current;
      } else if (Number(inv.invested_amount) > 0) {
        basis = 'invested_amount';
        invested = Number(inv.invested_amount);
      }

      if (basis === 'none') {
        items.push({ investment_id: id, basis, current_value: current });
        continue;
      }
      const gain = current + received - invested;
      summary.invested += invested;
      summary.received += received;
      summary.current_value += current;
      summary.gain += gain;
      items.push({
        investment_id: id,
        basis,
        invested: round2(invested),
        received: round2(received),
        current_value: round2(current),
        gain: round2(gain),
        gain_pct: invested > 0 ? round2((gain / invested) * 100) : null,
        xirr: itemXirr != null ? round2(itemXirr) : null,
        txn_count: flows.length,
        first_txn_date: flows.length ? flows[0].date : null
      });
    }

    const portfolioXirr = portfolioFlows.length
      ? xirr([...portfolioFlows, ...(portfolioTxnValue > 0 ? [{ date: today, amount: portfolioTxnValue }] : [])])
      : null;

    res.json({
      success: true,
      data: {
        as_of: today,
        items,
        summary: {
          invested: round2(summary.invested),
          received: round2(summary.received),
          current_value: round2(summary.current_value),
          gain: round2(summary.gain),
          gain_pct: summary.invested > 0 ? round2((summary.gain / summary.invested) * 100) : null,
          xirr: portfolioXirr != null ? round2(portfolioXirr) : null,
          xirr_value_covered: round2(portfolioTxnValue)
        }
      }
    });
  } catch (error) {
    console.error('Error computing investment returns:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bulk', async (req, res) => {
  const { action, ids, changes = {} } = req.body || {};
  if (!['delete', 'update'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action must be "delete" or "update"' });
  }
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniqueIds.length || uniqueIds.length > BULK_MAX_IDS) {
    return res.status(400).json({ success: false, error: `ids must contain 1-${BULK_MAX_IDS} investment ids` });
  }

  const results = [];
  for (const id of uniqueIds) {
    try {
      if (action === 'delete') {
        const ok = await store.deleteInvestment(id);
        results.push({ id, ok, error: ok ? undefined : 'Investment not found' });
        continue;
      }
      const existing = await store.getInvestmentById(id);
      if (!existing) {
        results.push({ id, ok: false, error: 'Investment not found' });
        continue;
      }
      const patch = {};
      const text = (v) => (typeof v === 'string' ? v.trim() : '');
      if (text(changes.website_app_name)) patch.website_app_name = text(changes.website_app_name);
      if (text(changes.investment_type)) {
        patch.investment_type = text(changes.investment_type);
        if (patch.investment_type !== existing.investment_type) {
          patch.sub_type_name = null;
          patch.sub_type_category = null;
        }
      }
      if (text(changes.sub_type_name)) patch.sub_type_name = text(changes.sub_type_name);
      if (text(changes.sub_type_category)) patch.sub_type_category = text(changes.sub_type_category);
      if (text(changes.notes_append)) {
        patch.notes = existing.notes ? `${existing.notes}\n${text(changes.notes_append)}` : text(changes.notes_append);
      }
      const updated = await store.updateInvestment(id, mergeInvestment(existing, patch));
      results.push({ id, ok: !!updated });
    } catch (error) {
      results.push({ id, ok: false, error: error.message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  res.json({ success: true, data: { succeeded, failed: results.length - succeeded, results } });
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
    const { website_app_name, investment_type, sub_type_name, sub_type_category, amount, units, nav_price, nav_source, avg_buy_price, invested_amount, profit_loss, investment_date, notes, mutual_fund_scheme_code, mutual_fund_scheme_name, interest_rate, maturity_date, maturity_amount, payout_frequency, compounding } = req.body;

    if (!website_app_name || !investment_type || !amount || !investment_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: website_app_name, investment_type, amount, investment_date'
      });
    }

    let resolvedNav = nav_price;
    let resolvedNavSource = nav_source || (nav_price != null ? 'imported' : null);
    if (['Mutual Fund', 'ETF'].includes(investment_type) && mutual_fund_scheme_code) {
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
      interest_rate,
      maturity_date,
      maturity_amount,
      payout_frequency,
      compounding,
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
    const existing = await store.getInvestmentById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }
    // Fields omitted from the body keep their stored value.
    const merged = mergeInvestment(existing, req.body || {});
    const { investment_type, investment_date, nav_price, nav_source, mutual_fund_scheme_code } = merged;
    let resolvedNav = nav_price;
    let resolvedNavSource = nav_source || (nav_price != null ? 'imported' : null);
    const navInputsChanged = String(mutual_fund_scheme_code || '') !== String(existing.mutual_fund_scheme_code || '')
      || String(investment_date || '').slice(0, 10) !== String(existing.investment_date || '').slice(0, 10)
      || req.body?.nav_price !== undefined
      || nav_price == null;
    if (['Mutual Fund', 'ETF'].includes(investment_type) && mutual_fund_scheme_code && navInputsChanged) {
      const resolved = await resolveMutualFundNav(mutual_fund_scheme_code, investment_date, nav_price);
      resolvedNav = resolved.nav;
      resolvedNavSource = resolved.source;
    }
    const updatedInvestment = await store.updateInvestment(req.params.id, {
      ...merged,
      nav_price: resolvedNav,
      nav_source: resolvedNavSource
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
