const { isMongoDb, getPool, getMongoDb } = require('../config/index');
const {
  extractPayee,
  buildFingerprint,
  detectTxnType,
  suggestCategory,
  isTransferCategory
} = require('../utils/bank-parsers/common');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function nextMongoId(collectionName) {
  const db = getMongoDb();
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: collectionName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq || result.value?.seq || 1;
}

function formatDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/* ---------- Category rules ---------- */

async function mysqlGetCategoryRules() {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM bank_category_rules ORDER BY priority ASC, id ASC'
  );
  return rows;
}

async function mysqlCreateCategoryRule(data) {
  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO bank_category_rules (pattern, match_field, category, priority, account_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.pattern,
      data.match_field || 'narration',
      data.category,
      num(data.priority, 100),
      data.account_id || null,
      data.is_active === false || data.is_active === 0 ? 0 : 1
    ]
  );
  const [rows] = await pool.query('SELECT * FROM bank_category_rules WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function mysqlUpdateCategoryRule(id, data) {
  const pool = getPool();
  await pool.query(
    `UPDATE bank_category_rules SET
      pattern = ?, match_field = ?, category = ?, priority = ?, account_id = ?, is_active = ?
     WHERE id = ?`,
    [
      data.pattern,
      data.match_field || 'narration',
      data.category,
      num(data.priority, 100),
      data.account_id || null,
      data.is_active === false || data.is_active === 0 ? 0 : 1,
      id
    ]
  );
  const [rows] = await pool.query('SELECT * FROM bank_category_rules WHERE id = ?', [id]);
  return rows[0] || null;
}

async function mysqlDeleteCategoryRule(id) {
  const pool = getPool();
  const [result] = await pool.query('DELETE FROM bank_category_rules WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function mongoGetCategoryRules() {
  const db = getMongoDb();
  const rows = await db
    .collection('bank_category_rules')
    .find({})
    .sort({ priority: 1, id: 1 })
    .toArray();
  return rows.map(formatDoc);
}

async function mongoCreateCategoryRule(data) {
  const db = getMongoDb();
  const id = await nextMongoId('bank_category_rules');
  const doc = {
    id,
    pattern: data.pattern,
    match_field: data.match_field || 'narration',
    category: data.category,
    priority: num(data.priority, 100),
    account_id: data.account_id || null,
    is_active: data.is_active === false || data.is_active === 0 ? 0 : 1,
    created_at: new Date(),
    updated_at: new Date()
  };
  await db.collection('bank_category_rules').insertOne(doc);
  return formatDoc(doc);
}

async function mongoUpdateCategoryRule(id, data) {
  const db = getMongoDb();
  await db.collection('bank_category_rules').updateOne(
    { id: Number(id) },
    {
      $set: {
        pattern: data.pattern,
        match_field: data.match_field || 'narration',
        category: data.category,
        priority: num(data.priority, 100),
        account_id: data.account_id || null,
        is_active: data.is_active === false || data.is_active === 0 ? 0 : 1,
        updated_at: new Date()
      }
    }
  );
  return formatDoc(await db.collection('bank_category_rules').findOne({ id: Number(id) }));
}

async function mongoDeleteCategoryRule(id) {
  const db = getMongoDb();
  const result = await db.collection('bank_category_rules').deleteOne({ id: Number(id) });
  return result.deletedCount > 0;
}

/* ---------- Bulk delete / undo batch / create txn ---------- */

async function mysqlBulkDelete(ids) {
  const pool = getPool();
  if (!ids?.length) return 0;
  const [result] = await pool.query(
    `DELETE FROM bank_transactions WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids.map(Number)
  );
  return result.affectedRows;
}

async function mongoBulkDelete(ids) {
  const db = getMongoDb();
  if (!ids?.length) return 0;
  const result = await db.collection('bank_transactions').deleteMany({ id: { $in: ids.map(Number) } });
  return result.deletedCount;
}

async function mysqlUndoImportBatch(batchId) {
  const pool = getPool();
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM bank_transactions WHERE import_batch_id = ?',
    [batchId]
  );
  const [result] = await pool.query('DELETE FROM bank_transactions WHERE import_batch_id = ?', [batchId]);
  return { deleted: result.affectedRows, found: countRows[0].total };
}

async function mongoUndoImportBatch(batchId) {
  const db = getMongoDb();
  const found = await db.collection('bank_transactions').countDocuments({ import_batch_id: batchId });
  const result = await db.collection('bank_transactions').deleteMany({ import_batch_id: batchId });
  return { deleted: result.deletedCount, found };
}

async function mysqlCreateTransaction(data) {
  const pool = getPool();
  const accountId = Number(data.account_id);
  const narration = data.narration || 'Manual entry';
  const withdrawal = num(data.withdrawal);
  const deposit = num(data.deposit);
  const txnDate = data.txn_date;
  const valueDate = data.value_date || txnDate;
  const refNo = data.ref_no || null;
  const fingerprint =
    data.fingerprint ||
    buildFingerprint({
      accountId,
      txnDate,
      valueDate,
      withdrawal,
      deposit,
      refNo,
      narration: `${narration}|manual|${Date.now()}`
    });
  const payee = data.payee || extractPayee(narration);
  const category = data.category || suggestCategory(narration, withdrawal, deposit).category;
  const [result] = await pool.query(
    `INSERT INTO bank_transactions
      (account_id, txn_date, value_date, narration, ref_no, withdrawal, deposit, balance,
       category, category_source, payee, txn_type, fingerprint, raw_bank, tags, notes, import_batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      accountId,
      txnDate,
      valueDate,
      narration,
      refNo,
      withdrawal,
      deposit,
      data.balance === null || data.balance === undefined ? null : num(data.balance),
      category,
      data.category_source || 'manual',
      payee,
      data.txn_type || detectTxnType(withdrawal, deposit, narration),
      fingerprint,
      data.raw_bank || 'MANUAL',
      data.tags || null,
      data.notes || null,
      null
    ]
  );
  const [rows] = await pool.query('SELECT * FROM bank_transactions WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function mongoCreateTransaction(data) {
  const db = getMongoDb();
  const accountId = Number(data.account_id);
  const narration = data.narration || 'Manual entry';
  const withdrawal = num(data.withdrawal);
  const deposit = num(data.deposit);
  const txnDate = data.txn_date;
  const valueDate = data.value_date || txnDate;
  const refNo = data.ref_no || null;
  const fingerprint =
    data.fingerprint ||
    buildFingerprint({
      accountId,
      txnDate,
      valueDate,
      withdrawal,
      deposit,
      refNo,
      narration: `${narration}|manual|${Date.now()}`
    });
  const id = await nextMongoId('bank_transactions');
  const suggested = suggestCategory(narration, withdrawal, deposit);
  const doc = {
    id,
    account_id: accountId,
    txn_date: txnDate,
    value_date: valueDate,
    narration,
    ref_no: refNo,
    withdrawal,
    deposit,
    balance: data.balance === null || data.balance === undefined ? null : num(data.balance),
    category: data.category || suggested.category,
    category_source: data.category_source || 'manual',
    payee: data.payee || extractPayee(narration),
    txn_type: data.txn_type || detectTxnType(withdrawal, deposit, narration),
    fingerprint,
    raw_bank: data.raw_bank || 'MANUAL',
    tags: data.tags || null,
    notes: data.notes || null,
    import_batch_id: null,
    linked_transfer_id: null,
    created_at: new Date(),
    updated_at: new Date()
  };
  await db.collection('bank_transactions').insertOne(doc);
  return formatDoc(doc);
}

/* ---------- Reconciliation ---------- */

async function mysqlBalanceContinuity(accountId) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, txn_date, withdrawal, deposit, balance, narration
     FROM bank_transactions
     WHERE account_id = ? AND balance IS NOT NULL
     ORDER BY txn_date ASC, id ASC`,
    [Number(accountId)]
  );
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const expected = num(prev.balance) - num(cur.withdrawal) + num(cur.deposit);
    if (Math.abs(expected - num(cur.balance)) > 0.05) {
      gaps.push({
        txn_id: cur.id,
        txn_date: cur.txn_date,
        expected_balance: Math.round(expected * 100) / 100,
        actual_balance: num(cur.balance),
        diff: Math.round((num(cur.balance) - expected) * 100) / 100,
        narration: cur.narration
      });
    }
  }
  return { account_id: Number(accountId), checked: rows.length, gaps: gaps.slice(0, 100) };
}

async function mongoBalanceContinuity(accountId) {
  const db = getMongoDb();
  const rows = await db
    .collection('bank_transactions')
    .find({ account_id: Number(accountId), balance: { $ne: null } })
    .sort({ txn_date: 1, id: 1 })
    .toArray();
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const expected = num(prev.balance) - num(cur.withdrawal) + num(cur.deposit);
    if (Math.abs(expected - num(cur.balance)) > 0.05) {
      gaps.push({
        txn_id: cur.id,
        txn_date: cur.txn_date,
        expected_balance: Math.round(expected * 100) / 100,
        actual_balance: num(cur.balance),
        diff: Math.round((num(cur.balance) - expected) * 100) / 100,
        narration: cur.narration
      });
    }
  }
  return { account_id: Number(accountId), checked: rows.length, gaps: gaps.slice(0, 100) };
}

/* ---------- Budgets ---------- */

async function mysqlGetBudgets(periodMonth) {
  const pool = getPool();
  if (periodMonth) {
    const [rows] = await pool.query(
      'SELECT * FROM bank_budgets WHERE period_month = ? OR period_month IS NULL ORDER BY category',
      [periodMonth]
    );
    return rows;
  }
  const [rows] = await pool.query('SELECT * FROM bank_budgets ORDER BY period_month DESC, category');
  return rows;
}

async function mysqlUpsertBudget(data) {
  const pool = getPool();
  if (data.id) {
    await pool.query(
      `UPDATE bank_budgets SET category = ?, amount = ?, period_month = ?, account_id = ?, notes = ? WHERE id = ?`,
      [data.category, num(data.amount), data.period_month || null, data.account_id || null, data.notes || null, data.id]
    );
    const [rows] = await pool.query('SELECT * FROM bank_budgets WHERE id = ?', [data.id]);
    return rows[0];
  }
  const [result] = await pool.query(
    `INSERT INTO bank_budgets (category, amount, period_month, account_id, notes) VALUES (?, ?, ?, ?, ?)`,
    [data.category, num(data.amount), data.period_month || null, data.account_id || null, data.notes || null]
  );
  const [rows] = await pool.query('SELECT * FROM bank_budgets WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function mysqlDeleteBudget(id) {
  const pool = getPool();
  const [result] = await pool.query('DELETE FROM bank_budgets WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function mongoGetBudgets(periodMonth) {
  const db = getMongoDb();
  const q = periodMonth ? { $or: [{ period_month: periodMonth }, { period_month: null }] } : {};
  return (await db.collection('bank_budgets').find(q).sort({ category: 1 }).toArray()).map(formatDoc);
}

async function mongoUpsertBudget(data) {
  const db = getMongoDb();
  if (data.id) {
    await db.collection('bank_budgets').updateOne(
      { id: Number(data.id) },
      {
        $set: {
          category: data.category,
          amount: num(data.amount),
          period_month: data.period_month || null,
          account_id: data.account_id || null,
          notes: data.notes || null,
          updated_at: new Date()
        }
      }
    );
    return formatDoc(await db.collection('bank_budgets').findOne({ id: Number(data.id) }));
  }
  const id = await nextMongoId('bank_budgets');
  const doc = {
    id,
    category: data.category,
    amount: num(data.amount),
    period_month: data.period_month || null,
    account_id: data.account_id || null,
    notes: data.notes || null,
    created_at: new Date(),
    updated_at: new Date()
  };
  await db.collection('bank_budgets').insertOne(doc);
  return formatDoc(doc);
}

async function mongoDeleteBudget(id) {
  const db = getMongoDb();
  const result = await db.collection('bank_budgets').deleteOne({ id: Number(id) });
  return result.deletedCount > 0;
}

function wantsExcludeTransfers(opts = {}) {
  const v = opts.exclude_transfers;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function isTransferTxn(r) {
  return isTransferCategory(r.category) || (r.linked_transfer_id !== null && r.linked_transfer_id !== undefined);
}

function spentForBudget(spentRows, budget) {
  const cat = budget.category;
  const accountId = budget.account_id != null ? Number(budget.account_id) : null;
  return spentRows
    .filter((r) => (r.category || 'Uncategorized') === cat)
    .filter((r) => (accountId == null ? true : Number(r.account_id) === accountId))
    .reduce((s, r) => s + num(r.spent), 0);
}

async function mysqlBudgetStatus(periodMonth, opts = {}) {
  const pool = getPool();
  const month = periodMonth || new Date().toISOString().slice(0, 7);
  const budgets = await mysqlGetBudgets(month);
  let transferClause = '';
  if (wantsExcludeTransfers(opts)) {
    transferClause =
      ` AND NOT (category IN ('Transfer In','Transfer Out') OR category LIKE 'Transfer\\_%' OR linked_transfer_id IS NOT NULL)`;
  }
  const [spentRows] = await pool.query(
    `SELECT category, account_id, COALESCE(SUM(withdrawal),0) AS spent
     FROM bank_transactions
     WHERE DATE_FORMAT(txn_date, '%Y-%m') = ? AND withdrawal > 0${transferClause}
     GROUP BY category, account_id`,
    [month]
  );
  return budgets.map((b) => {
    const spent = spentForBudget(spentRows, b);
    return {
      ...b,
      period_month: b.period_month || month,
      spent,
      remaining: num(b.amount) - spent,
      pct: num(b.amount) > 0 ? Math.round((spent / num(b.amount)) * 1000) / 10 : 0
    };
  });
}

async function mongoBudgetStatus(periodMonth, opts = {}) {
  const db = getMongoDb();
  const month = periodMonth || new Date().toISOString().slice(0, 7);
  const budgets = await mongoGetBudgets(month);
  const query = {
    txn_date: { $gte: `${month}-01`, $lte: `${month}-31` },
    withdrawal: { $gt: 0 }
  };
  let rows = await db.collection('bank_transactions').find(query).toArray();
  if (wantsExcludeTransfers(opts)) {
    rows = rows.filter((r) => !isTransferTxn(r));
  }
  const spentMap = {};
  for (const r of rows) {
    const c = r.category || 'Uncategorized';
    const key = `${c}::${r.account_id}`;
    spentMap[key] = (spentMap[key] || 0) + num(r.withdrawal);
  }
  const spentRows = Object.entries(spentMap).map(([key, spent]) => {
    const [category, account_id] = key.split('::');
    return { category, account_id: Number(account_id), spent };
  });
  return budgets.map((b) => {
    const spent = spentForBudget(spentRows, b);
    return {
      ...b,
      period_month: b.period_month || month,
      spent,
      remaining: num(b.amount) - spent,
      pct: num(b.amount) > 0 ? Math.round((spent / num(b.amount)) * 1000) / 10 : 0
    };
  });
}

/* ---------- Recurring / transfers / forecast ---------- */

function daysBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.abs((d2 - d1) / 86400000);
}

async function detectRecurring(rows) {
  const groups = {};
  for (const r of rows) {
    const payee = r.payee || extractPayee(r.narration) || 'Unknown';
    const amt = Math.max(num(r.withdrawal), num(r.deposit));
    if (amt < 1) continue;
    const bucket = Math.round(amt);
    const key = `${payee.toLowerCase()}|${bucket}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const recurring = [];
  for (const [key, list] of Object.entries(groups)) {
    if (list.length < 3) continue;
    list.sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)));
    const gaps = [];
    for (let i = 1; i < list.length; i++) {
      gaps.push(daysBetween(list[i - 1].txn_date, list[i].txn_date));
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avgGap < 20 || avgGap > 45) continue;
    const [payee, amountStr] = key.split('|');
    const last = list[list.length - 1];
    const nextDate = new Date(last.txn_date);
    nextDate.setDate(nextDate.getDate() + Math.round(avgGap));
    recurring.push({
      payee,
      amount: Number(amountStr),
      occurrences: list.length,
      avg_gap_days: Math.round(avgGap),
      last_date: last.txn_date,
      next_expected: nextDate.toISOString().slice(0, 10),
      category: last.category || null,
      is_debit: num(last.withdrawal) > 0
    });
  }
  return recurring.sort((a, b) => b.occurrences - a.occurrences).slice(0, 40);
}

async function mysqlGetRecurring(accountId) {
  const pool = getPool();
  const params = [];
  let sql = 'SELECT * FROM bank_transactions WHERE txn_date >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)';
  if (accountId) {
    sql += ' AND account_id = ?';
    params.push(Number(accountId));
  }
  const [rows] = await pool.query(sql, params);
  return detectRecurring(rows);
}

async function mongoGetRecurring(accountId) {
  const db = getMongoDb();
  const since = new Date();
  since.setMonth(since.getMonth() - 18);
  const q = { txn_date: { $gte: since.toISOString().slice(0, 10) } };
  if (accountId) q.account_id = Number(accountId);
  const rows = await db.collection('bank_transactions').find(q).toArray();
  return detectRecurring(rows);
}

async function mysqlMatchTransfers({ windowDays = 2 } = {}) {
  const pool = getPool();
  const [debits] = await pool.query(
    `SELECT * FROM bank_transactions
     WHERE withdrawal > 0 AND (linked_transfer_id IS NULL)
       AND (category IN ('Transfer Out','Transfer_Other_Out','Expense / Debit','Expense_Other_Debit','Uncategorized','UPI','Expense_Peer_UPI')
            OR category LIKE 'Transfer\\_%')
     ORDER BY txn_date DESC LIMIT 2000`
  );
  const [credits] = await pool.query(
    `SELECT * FROM bank_transactions
     WHERE deposit > 0 AND (linked_transfer_id IS NULL)
     ORDER BY txn_date DESC LIMIT 2000`
  );
  let matched = 0;
  const usedCredits = new Set();
  for (const d of debits) {
    const amt = num(d.withdrawal);
    const cand = credits.find((c) => {
      if (usedCredits.has(c.id)) return false;
      if (Number(c.account_id) === Number(d.account_id)) return false;
      if (Math.abs(num(c.deposit) - amt) > 0.05) return false;
      return daysBetween(d.txn_date, c.txn_date) <= windowDays;
    });
    if (!cand) continue;
    usedCredits.add(cand.id);
    await pool.query(
      `UPDATE bank_transactions SET linked_transfer_id = ?, category = 'Transfer_Other_Out', category_source = IF(category_source='manual', category_source, 'rule') WHERE id = ?`,
      [cand.id, d.id]
    );
    await pool.query(
      `UPDATE bank_transactions SET linked_transfer_id = ?, category = 'Transfer_Other_In', category_source = IF(category_source='manual', category_source, 'rule') WHERE id = ?`,
      [d.id, cand.id]
    );
    matched += 1;
  }
  return { matched };
}

async function mongoMatchTransfers({ windowDays = 2 } = {}) {
  const db = getMongoDb();
  const debits = await db
    .collection('bank_transactions')
    .find({
      withdrawal: { $gt: 0 },
      $or: [{ linked_transfer_id: null }, { linked_transfer_id: { $exists: false } }]
    })
    .sort({ txn_date: -1 })
    .limit(2000)
    .toArray();
  const credits = await db
    .collection('bank_transactions')
    .find({
      deposit: { $gt: 0 },
      $or: [{ linked_transfer_id: null }, { linked_transfer_id: { $exists: false } }]
    })
    .sort({ txn_date: -1 })
    .limit(2000)
    .toArray();
  let matched = 0;
  const usedCredits = new Set();
  for (const d of debits) {
    const amt = num(d.withdrawal);
    const cand = credits.find((c) => {
      if (usedCredits.has(c.id)) return false;
      if (Number(c.account_id) === Number(d.account_id)) return false;
      if (Math.abs(num(c.deposit) - amt) > 0.05) return false;
      return daysBetween(d.txn_date, c.txn_date) <= windowDays;
    });
    if (!cand) continue;
    usedCredits.add(cand.id);
    const dSource = d.category_source === 'manual' ? 'manual' : 'rule';
    const cSource = cand.category_source === 'manual' ? 'manual' : 'rule';
    await db.collection('bank_transactions').updateOne(
      { id: d.id },
      { $set: { linked_transfer_id: cand.id, category: 'Transfer_Other_Out', category_source: dSource } }
    );
    await db.collection('bank_transactions').updateOne(
      { id: cand.id },
      { $set: { linked_transfer_id: d.id, category: 'Transfer_Other_In', category_source: cSource } }
    );
    matched += 1;
  }
  return { matched };
}

async function mysqlGetForecast(accountId) {
  const pool = getPool();
  const params = [];
  let sql = `
    SELECT DATE_FORMAT(txn_date, '%Y-%m') AS month,
      COALESCE(SUM(withdrawal),0) AS total_debit,
      COALESCE(SUM(deposit),0) AS total_credit
    FROM bank_transactions
    WHERE txn_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`;
  if (accountId) {
    sql += ' AND account_id = ?';
    params.push(Number(accountId));
  }
  sql += ' GROUP BY DATE_FORMAT(txn_date, \'%Y-%m\') ORDER BY month';
  const [rows] = await pool.query(sql, params);
  const months = rows.length || 1;
  const avgDebit = rows.reduce((s, r) => s + num(r.total_debit), 0) / months;
  const avgCredit = rows.reduce((s, r) => s + num(r.total_credit), 0) / months;
  const recurring = await mysqlGetRecurring(accountId);
  const upcomingOutflows = recurring
    .filter((r) => r.is_debit)
    .slice(0, 10)
    .map((r) => ({
      payee: r.payee,
      amount: r.amount,
      next_expected: r.next_expected,
      category: r.category
    }));
  const interestRows = await pool.query(
    `SELECT DATE_FORMAT(txn_date, '%Y-%m') AS month, COALESCE(SUM(deposit),0) AS interest
     FROM bank_transactions
     WHERE (category IN ('Interest Income','Income_Interest_Bank','Income_Interest_Bond')
            OR category LIKE 'Income\\_Interest\\_%' OR txn_type = 'interest')
       AND txn_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
     ${accountId ? 'AND account_id = ?' : ''}
     GROUP BY DATE_FORMAT(txn_date, '%Y-%m')
     ORDER BY month DESC LIMIT 6`,
    accountId ? [Number(accountId)] : []
  );
  const interestHistory = interestRows[0];
  const avgInterest =
    interestHistory.length > 0
      ? interestHistory.reduce((s, r) => s + num(r.interest), 0) / interestHistory.length
      : 0;
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return {
    history: rows,
    projected_next_month: {
      month: nextMonth.toISOString().slice(0, 7),
      avg_debit: Math.round(avgDebit * 100) / 100,
      avg_credit: Math.round(avgCredit * 100) / 100,
      net: Math.round((avgCredit - avgDebit) * 100) / 100,
      projected_interest: Math.round(avgInterest * 100) / 100
    },
    upcoming_outflows: upcomingOutflows
  };
}

async function mongoGetForecast(accountId) {
  const db = getMongoDb();
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const q = { txn_date: { $gte: since.toISOString().slice(0, 10) } };
  if (accountId) q.account_id = Number(accountId);
  const rows = await db.collection('bank_transactions').find(q).toArray();
  const monthMap = {};
  for (const r of rows) {
    const m = String(r.txn_date).slice(0, 7);
    if (!monthMap[m]) monthMap[m] = { month: m, total_debit: 0, total_credit: 0 };
    monthMap[m].total_debit += num(r.withdrawal);
    monthMap[m].total_credit += num(r.deposit);
  }
  const history = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  const months = history.length || 1;
  const avgDebit = history.reduce((s, r) => s + num(r.total_debit), 0) / months;
  const avgCredit = history.reduce((s, r) => s + num(r.total_credit), 0) / months;
  const recurring = await mongoGetRecurring(accountId);
  const upcomingOutflows = recurring
    .filter((r) => r.is_debit)
    .slice(0, 10)
    .map((r) => ({
      payee: r.payee,
      amount: r.amount,
      next_expected: r.next_expected,
      category: r.category
    }));
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return {
    history,
    projected_next_month: {
      month: nextMonth.toISOString().slice(0, 7),
      avg_debit: Math.round(avgDebit * 100) / 100,
      avg_credit: Math.round(avgCredit * 100) / 100,
      net: Math.round((avgCredit - avgDebit) * 100) / 100,
      projected_interest: 0
    },
    upcoming_outflows: upcomingOutflows
  };
}

const impl = () => (isMongoDb() ? 'mongo' : 'mysql');

module.exports = {
  getCategoryRules: (...a) => (impl() === 'mongo' ? mongoGetCategoryRules(...a) : mysqlGetCategoryRules(...a)),
  createCategoryRule: (...a) =>
    impl() === 'mongo' ? mongoCreateCategoryRule(...a) : mysqlCreateCategoryRule(...a),
  updateCategoryRule: (...a) =>
    impl() === 'mongo' ? mongoUpdateCategoryRule(...a) : mysqlUpdateCategoryRule(...a),
  deleteCategoryRule: (...a) =>
    impl() === 'mongo' ? mongoDeleteCategoryRule(...a) : mysqlDeleteCategoryRule(...a),
  bulkDelete: (...a) => (impl() === 'mongo' ? mongoBulkDelete(...a) : mysqlBulkDelete(...a)),
  undoImportBatch: (...a) => (impl() === 'mongo' ? mongoUndoImportBatch(...a) : mysqlUndoImportBatch(...a)),
  createTransaction: (...a) =>
    impl() === 'mongo' ? mongoCreateTransaction(...a) : mysqlCreateTransaction(...a),
  balanceContinuity: (...a) =>
    impl() === 'mongo' ? mongoBalanceContinuity(...a) : mysqlBalanceContinuity(...a),
  getBudgets: (...a) => (impl() === 'mongo' ? mongoGetBudgets(...a) : mysqlGetBudgets(...a)),
  upsertBudget: (...a) => (impl() === 'mongo' ? mongoUpsertBudget(...a) : mysqlUpsertBudget(...a)),
  deleteBudget: (...a) => (impl() === 'mongo' ? mongoDeleteBudget(...a) : mysqlDeleteBudget(...a)),
  budgetStatus: (...a) => (impl() === 'mongo' ? mongoBudgetStatus(...a) : mysqlBudgetStatus(...a)),
  getRecurring: (...a) => (impl() === 'mongo' ? mongoGetRecurring(...a) : mysqlGetRecurring(...a)),
  matchTransfers: (...a) => (impl() === 'mongo' ? mongoMatchTransfers(...a) : mysqlMatchTransfers(...a)),
  getForecast: (...a) => (impl() === 'mongo' ? mongoGetForecast(...a) : mysqlGetForecast(...a))
};
