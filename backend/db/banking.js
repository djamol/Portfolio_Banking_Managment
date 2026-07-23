const { isMongoDb, getPool, getMongoDb } = require('../config/index');
const {
  suggestCategory,
  extractPayee,
  buildFingerprint,
  detectTxnType
} = require('../utils/bank-parsers/common');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function categoryResult(narration, withdrawal, deposit, customRules, accountId, payee) {
  const result = suggestCategory(narration, withdrawal, deposit, customRules, accountId, payee);
  if (typeof result === 'string') return { category: result, source: 'auto' };
  return result;
}

/* ===================== MySQL ===================== */

async function mysqlGetAccounts() {
  const pool = getPool();
  const [rows] = await pool.query(`
    SELECT a.*,
      (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id) AS txn_count,
      (SELECT t.balance FROM bank_transactions t
        WHERE t.account_id = a.id AND t.balance IS NOT NULL
        ORDER BY t.txn_date DESC, t.id DESC LIMIT 1) AS latest_balance
    FROM bank_accounts a
    ORDER BY a.bank_name, a.account_name
  `);
  return rows;
}

async function mysqlGetAccountById(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM bank_accounts WHERE id = ?', [id]);
  return rows[0] || null;
}

async function mysqlCreateAccount(data) {
  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO bank_accounts
      (bank_name, account_name, account_number, ifsc, account_type, currency, opening_balance, notes, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.bank_name,
      data.account_name,
      data.account_number || null,
      data.ifsc || null,
      data.account_type || 'Savings',
      data.currency || 'INR',
      num(data.opening_balance),
      data.notes || null,
      data.is_active === false || data.is_active === 0 ? 0 : 1
    ]
  );
  return mysqlGetAccountById(result.insertId);
}

async function mysqlUpdateAccount(id, data) {
  const pool = getPool();
  await pool.query(
    `UPDATE bank_accounts SET
      bank_name = ?, account_name = ?, account_number = ?, ifsc = ?,
      account_type = ?, currency = ?, opening_balance = ?, notes = ?, is_active = ?
     WHERE id = ?`,
    [
      data.bank_name,
      data.account_name,
      data.account_number || null,
      data.ifsc || null,
      data.account_type || 'Savings',
      data.currency || 'INR',
      num(data.opening_balance),
      data.notes || null,
      data.is_active === false || data.is_active === 0 ? 0 : 1,
      id
    ]
  );
  return mysqlGetAccountById(id);
}

async function mysqlDeleteAccount(id) {
  const pool = getPool();
  const [result] = await pool.query('DELETE FROM bank_accounts WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function mysqlImportTransactions(accountId, transactions, importBatchId) {
  const pool = getPool();
  let inserted = 0;
  let skipped = 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const txn of transactions) {
      try {
        const [result] = await conn.query(
          `INSERT IGNORE INTO bank_transactions
            (account_id, txn_date, value_date, narration, ref_no, withdrawal, deposit, balance,
             category, category_source, payee, txn_type, fingerprint, raw_bank, tags, notes, import_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            accountId,
            txn.txn_date,
            txn.value_date || txn.txn_date,
            txn.narration || null,
            txn.ref_no || null,
            num(txn.withdrawal),
            num(txn.deposit),
            txn.balance === null || txn.balance === undefined ? null : num(txn.balance),
            txn.category || null,
            txn.category_source || 'auto',
            txn.payee || null,
            txn.txn_type || null,
            txn.fingerprint,
            txn.raw_bank || null,
            txn.tags || null,
            txn.notes || null,
            importBatchId || null
          ]
        );
        if (result.affectedRows > 0) inserted += 1;
        else skipped += 1;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') skipped += 1;
        else throw err;
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { inserted, skipped, total: transactions.length, import_batch_id: importBatchId };
}

function buildTxnWhere(filters = {}, table = 'bank_transactions') {
  const col = (name) => `${table}.${name}`;
  const where = ['1=1'];
  const params = [];
  // Qualify columns: list query JOINs bank_accounts which also has notes
  if (filters.account_id) {
    where.push(`${col('account_id')} = ?`);
    params.push(Number(filters.account_id));
  }
  if (filters.from) {
    where.push(`${col('txn_date')} >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`${col('txn_date')} <= ?`);
    params.push(filters.to);
  }
  if (filters.category) {
    where.push(`${col('category')} = ?`);
    params.push(filters.category);
  }
  if (filters.txn_type) {
    where.push(`${col('txn_type')} = ?`);
    params.push(filters.txn_type);
  }
  if (filters.q) {
    where.push(
      `(${col('narration')} LIKE ? OR ${col('ref_no')} LIKE ? OR ${col('notes')} LIKE ? OR ${col('payee')} LIKE ? OR ${col('tags')} LIKE ?)`
    );
    const like = `%${filters.q}%`;
    params.push(like, like, like, like, like);
  }
  if (filters.payee) {
    where.push(`${col('payee')} LIKE ?`);
    params.push(`%${filters.payee}%`);
  }
  if (filters.min_amount) {
    where.push(`(${col('withdrawal')} >= ? OR ${col('deposit')} >= ?)`);
    params.push(num(filters.min_amount), num(filters.min_amount));
  }
  if (filters.flow === 'debit') where.push(`${col('withdrawal')} > 0`);
  if (filters.flow === 'credit') where.push(`${col('deposit')} > 0`);
  if (wantsExcludeTransfers(filters)) {
    where.push(
      `NOT (${col('category')} IN ('Transfer In','Transfer Out') OR ${col('linked_transfer_id')} IS NOT NULL)`
    );
  }
  return { whereSql: where.join(' AND '), params };
}

function wantsExcludeTransfers(filters = {}) {
  const v = filters.exclude_transfers;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function buildCashSummaryFromAccounts(accounts) {
  const list = (accounts || []).map((a) => {
    const isActive = !(a.is_active === 0 || a.is_active === false);
    const latest =
      a.latest_balance !== null && a.latest_balance !== undefined
        ? num(a.latest_balance)
        : num(a.opening_balance);
    return {
      id: a.id,
      bank_name: a.bank_name,
      account_name: a.account_name,
      currency: a.currency || 'INR',
      latest_balance: latest,
      is_active: isActive ? 1 : 0
    };
  });
  const totals = {};
  let active_count = 0;
  let inactive_count = 0;
  for (const a of list) {
    if (a.is_active) {
      active_count += 1;
      const c = a.currency || 'INR';
      totals[c] = (totals[c] || 0) + num(a.latest_balance);
    } else {
      inactive_count += 1;
    }
  }
  return {
    accounts: list,
    totals_by_currency: Object.entries(totals).map(([currency, total]) => ({ currency, total })),
    active_count,
    inactive_count
  };
}

async function mysqlGetCashSummary() {
  return buildCashSummaryFromAccounts(await mysqlGetAccounts());
}

async function mysqlGetAnalyticsByPayee(filters = {}) {
  const pool = getPool();
  const { whereSql, params } = buildTxnWhere(filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 15, 1), 100);
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(payee), ''), 'Unknown') AS payee,
            COUNT(*) AS txn_count,
            COALESCE(SUM(withdrawal),0) AS total_debit,
            COALESCE(SUM(deposit),0) AS total_credit
     FROM bank_transactions
     WHERE ${whereSql}
     GROUP BY COALESCE(NULLIF(TRIM(payee), ''), 'Unknown')
     ORDER BY total_debit DESC, total_credit DESC
     LIMIT ?`,
    [...params, limit]
  );
  return rows;
}

async function mysqlGetTransactions(filters = {}) {
  const pool = getPool();
  const { whereSql, params } = buildTxnWhere(filters, 't');
  const limit = Math.min(Number(filters.limit) || 100, 5000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sort = String(filters.sort || 'date_desc');
  const orderMap = {
    date_desc: 't.txn_date DESC, t.id DESC',
    date_asc: 't.txn_date ASC, t.id ASC',
    account_asc: 'a.bank_name ASC, a.account_name ASC, t.txn_date DESC',
    account_desc: 'a.bank_name DESC, a.account_name DESC, t.txn_date DESC',
    narration_asc: 't.narration ASC, t.txn_date DESC',
    narration_desc: 't.narration DESC, t.txn_date DESC',
    debit_asc: 't.withdrawal ASC, t.txn_date DESC',
    debit_desc: 't.withdrawal DESC, t.txn_date DESC',
    credit_asc: 't.deposit ASC, t.txn_date DESC',
    credit_desc: 't.deposit DESC, t.txn_date DESC',
    balance_asc: 't.balance ASC, t.txn_date DESC',
    balance_desc: 't.balance DESC, t.txn_date DESC',
    category_asc: 't.category ASC, t.txn_date DESC',
    category_desc: 't.category DESC, t.txn_date DESC',
    amount_asc: 'GREATEST(t.withdrawal, t.deposit) ASC, t.txn_date DESC',
    amount_desc: 'GREATEST(t.withdrawal, t.deposit) DESC, t.txn_date DESC'
  };
  const orderBy = orderMap[sort] || orderMap.date_desc;

  const [rows] = await pool.query(
    `SELECT t.*, a.bank_name, a.account_name, a.account_number
     FROM bank_transactions t
     JOIN bank_accounts a ON a.id = t.account_id
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [countRows] = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COALESCE(SUM(t.withdrawal),0) AS total_debit,
      COALESCE(SUM(t.deposit),0) AS total_credit,
      COALESCE(SUM(t.deposit) - SUM(t.withdrawal),0) AS net_cashflow
     FROM bank_transactions t WHERE ${whereSql}`,
    params
  );
  const totals = countRows[0];
  return {
    rows,
    total: totals.total,
    total_debit: totals.total_debit,
    total_credit: totals.total_credit,
    net_cashflow: totals.net_cashflow,
    limit,
    offset
  };
}

async function mysqlUpdateTransaction(id, data) {
  const pool = getPool();
  const fields = [];
  const params = [];
  for (const key of ['category', 'tags', 'notes', 'txn_type', 'payee', 'category_source']) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  // Manual edits lock category
  if (data.category !== undefined && data.category_source === undefined) {
    fields.push('category_source = ?');
    params.push('manual');
  }
  if (!fields.length) {
    const [rows] = await pool.query('SELECT * FROM bank_transactions WHERE id = ?', [id]);
    return rows[0] || null;
  }
  params.push(id);
  await pool.query(`UPDATE bank_transactions SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await pool.query('SELECT * FROM bank_transactions WHERE id = ?', [id]);
  return rows[0] || null;
}

async function mysqlDeleteTransaction(id) {
  const pool = getPool();
  const [result] = await pool.query('DELETE FROM bank_transactions WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function mysqlBulkCategorize(ids, category) {
  const pool = getPool();
  if (!ids?.length) return 0;
  const [result] = await pool.query(
    `UPDATE bank_transactions SET category = ?, category_source = 'manual'
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    [category, ...ids]
  );
  return result.affectedRows;
}

async function mysqlRecategorizeAll(accountId, { mode = 'auto_only', customRules = [] } = {}) {
  const pool = getPool();
  const params = [];
  let sql = 'SELECT id, account_id, narration, payee, withdrawal, deposit, category, category_source FROM bank_transactions';
  const where = [];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }
  if (mode === 'uncategorized') {
    where.push(`(category IS NULL OR category = '' OR category IN ('Uncategorized','Expense / Debit','Income / Credit'))`);
  } else if (mode !== 'all') {
    // auto_only (default): never overwrite manual
    where.push(`(category_source IS NULL OR category_source <> 'manual')`);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  const [rows] = await pool.query(sql, params);
  let updated = 0;
  for (const row of rows) {
    if (mode !== 'all' && row.category_source === 'manual') continue;
    const suggested = categoryResult(
      row.narration,
      row.withdrawal,
      row.deposit,
      customRules,
      row.account_id,
      row.payee
    );
    const payee = row.payee || extractPayee(row.narration);
    const [result] = await pool.query(
      'UPDATE bank_transactions SET category = ?, category_source = ?, payee = COALESCE(payee, ?) WHERE id = ?',
      [suggested.category, suggested.source, payee, row.id]
    );
    updated += result.affectedRows;
  }
  return updated;
}

async function mysqlGetAnalytics(filters = {}) {
  const pool = getPool();
  const { whereSql, params } = buildTxnWhere(filters);

  const [summaryRows] = await pool.query(
    `SELECT
      COUNT(*) AS txn_count,
      COALESCE(SUM(withdrawal),0) AS total_debit,
      COALESCE(SUM(deposit),0) AS total_credit,
      COALESCE(SUM(deposit) - SUM(withdrawal),0) AS net_cashflow
     FROM bank_transactions WHERE ${whereSql}`,
    params
  );

  const [byCategory] = await pool.query(
    `SELECT COALESCE(category,'Uncategorized') AS category,
            COUNT(*) AS txn_count,
            COALESCE(SUM(withdrawal),0) AS total_debit,
            COALESCE(SUM(deposit),0) AS total_credit
     FROM bank_transactions
     WHERE ${whereSql}
     GROUP BY COALESCE(category,'Uncategorized')
     ORDER BY (COALESCE(SUM(withdrawal),0) + COALESCE(SUM(deposit),0)) DESC`,
    params
  );

  const [byMonth] = await pool.query(
    `SELECT DATE_FORMAT(txn_date, '%Y-%m') AS month,
            COUNT(*) AS txn_count,
            COALESCE(SUM(withdrawal),0) AS total_debit,
            COALESCE(SUM(deposit),0) AS total_credit,
            COALESCE(SUM(deposit) - SUM(withdrawal),0) AS net
     FROM bank_transactions
     WHERE ${whereSql}
     GROUP BY DATE_FORMAT(txn_date, '%Y-%m')
     ORDER BY month ASC`,
    params
  );

  const [byCategoryMonth] = await pool.query(
    `SELECT DATE_FORMAT(txn_date, '%Y-%m') AS month,
            COALESCE(category,'Uncategorized') AS category,
            COUNT(*) AS txn_count,
            COALESCE(SUM(withdrawal),0) AS total_debit,
            COALESCE(SUM(deposit),0) AS total_credit
     FROM bank_transactions
     WHERE ${whereSql}
     GROUP BY DATE_FORMAT(txn_date, '%Y-%m'), COALESCE(category,'Uncategorized')
     ORDER BY month ASC, total_debit DESC`,
    params
  );

  const [interestByMonth] = await pool.query(
    `SELECT DATE_FORMAT(txn_date, '%Y-%m') AS month,
            COALESCE(SUM(CASE WHEN category = 'Interest Income' OR txn_type = 'interest' THEN deposit ELSE 0 END),0) AS interest,
            COALESCE(SUM(CASE WHEN category = 'TDS / Tax' OR txn_type = 'tax' THEN withdrawal ELSE 0 END),0) AS tax,
            COALESCE(SUM(CASE WHEN category = 'Fixed Deposit' OR txn_type = 'fd_book' THEN withdrawal ELSE 0 END),0) AS fd_booked
     FROM bank_transactions
     WHERE ${whereSql}
     GROUP BY DATE_FORMAT(txn_date, '%Y-%m')
     HAVING interest > 0 OR tax > 0 OR fd_booked > 0
     ORDER BY month ASC`,
    params
  );

  const [topExpenses] = await pool.query(
    `SELECT id, txn_date, narration, withdrawal, deposit, category, account_id
     FROM bank_transactions
     WHERE ${whereSql} AND withdrawal > 0
     ORDER BY withdrawal DESC
     LIMIT 15`,
    params
  );

  const [topCredits] = await pool.query(
    `SELECT id, txn_date, narration, withdrawal, deposit, category, account_id
     FROM bank_transactions
     WHERE ${whereSql} AND deposit > 0
     ORDER BY deposit DESC
     LIMIT 15`,
    params
  );

  const [uncatRows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM bank_transactions
     WHERE ${whereSql} AND (category IS NULL OR category = '' OR category = 'Uncategorized'
       OR category IN ('Expense / Debit', 'Income / Credit'))`,
    params
  );

  const [interestTax] = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN category = 'Interest Income' OR txn_type = 'interest' THEN deposit ELSE 0 END),0) AS interest_earned,
      COALESCE(SUM(CASE WHEN category = 'TDS / Tax' OR txn_type = 'tax' THEN withdrawal ELSE 0 END),0) AS tax_deducted,
      COALESCE(SUM(CASE WHEN category = 'Fixed Deposit' OR txn_type = 'fd_book' THEN withdrawal ELSE 0 END),0) AS fd_booked,
      COALESCE(SUM(CASE WHEN txn_type = 'fd_maturity' THEN deposit ELSE 0 END),0) AS fd_matured
     FROM bank_transactions
     WHERE ${whereSql}`,
    params
  );

  const [balanceSeries] = await pool.query(
    `SELECT txn_date AS date, balance, account_id
     FROM bank_transactions
     WHERE ${whereSql} AND balance IS NOT NULL
     ORDER BY txn_date ASC, id ASC`,
    params
  );

  const accountParams = [];
  let accountFilter = '';
  if (filters.account_id) {
    accountFilter += ' AND a.id = ?';
    accountParams.push(Number(filters.account_id));
  }
  if (filters.from) {
    accountFilter += ' AND (t.txn_date IS NULL OR t.txn_date >= ?)';
    accountParams.push(filters.from);
  }
  if (filters.to) {
    accountFilter += ' AND (t.txn_date IS NULL OR t.txn_date <= ?)';
    accountParams.push(filters.to);
  }

  const [byAccount] = await pool.query(
    `SELECT a.id, a.bank_name, a.account_name, a.account_number,
            COUNT(t.id) AS txn_count,
            COALESCE(SUM(t.withdrawal),0) AS total_debit,
            COALESCE(SUM(t.deposit),0) AS total_credit
     FROM bank_accounts a
     LEFT JOIN bank_transactions t ON t.account_id = a.id
     WHERE 1=1 ${accountFilter}
     GROUP BY a.id
     ORDER BY a.bank_name, a.account_name`,
    accountParams
  );

  const [categories] = await pool.query(
    `SELECT DISTINCT category FROM bank_transactions WHERE category IS NOT NULL AND category <> '' ORDER BY category`
  );

  const summary = summaryRows[0];
  const extras = buildAnalyticsExtras(summary, byMonth, byCategory, uncatRows[0]?.cnt || 0);

  return {
    summary: { ...summary, ...extras.summaryExtras },
    byCategory,
    expenseByCategory: extras.expenseByCategory,
    byMonth,
    byCategoryMonth,
    interestByMonth,
    topExpenses,
    topCredits,
    interestTax: interestTax[0],
    balanceSeries,
    byAccount,
    insights: extras.insights,
    mom: extras.mom,
    categories: categories.map((c) => c.category)
  };
}

function buildAnalyticsExtras(summary, byMonth, byCategory, uncategorizedCount) {
  const totalDebit = num(summary?.total_debit);
  const totalCredit = num(summary?.total_credit);
  const net = num(summary?.net_cashflow);
  const txnCount = num(summary?.txn_count);
  const months = Array.isArray(byMonth) ? byMonth : [];
  const monthCount = Math.max(months.length, 1);
  const avgMonthlyDebit = totalDebit / monthCount;
  const avgMonthlyCredit = totalCredit / monthCount;
  const savingsRate = totalCredit > 0 ? (net / totalCredit) * 100 : 0;

  const expenseByCategory = (byCategory || [])
    .map((c) => ({
      category: c.category,
      txn_count: c.txn_count,
      total_debit: num(c.total_debit),
      total_credit: num(c.total_credit)
    }))
    .filter((c) => c.total_debit > 0)
    .sort((a, b) => b.total_debit - a.total_debit);

  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const mom = last
    ? {
        current_month: last.month,
        current_debit: num(last.total_debit),
        current_credit: num(last.total_credit),
        current_net: num(last.net),
        previous_month: prev?.month || null,
        previous_debit: prev ? num(prev.total_debit) : null,
        previous_credit: prev ? num(prev.total_credit) : null,
        previous_net: prev ? num(prev.net) : null,
        debit_change_pct:
          prev && num(prev.total_debit) > 0
            ? ((num(last.total_debit) - num(prev.total_debit)) / num(prev.total_debit)) * 100
            : null,
        credit_change_pct:
          prev && num(prev.total_credit) > 0
            ? ((num(last.total_credit) - num(prev.total_credit)) / num(prev.total_credit)) * 100
            : null
      }
    : null;

  const insights = [];
  if (txnCount > 0) {
    insights.push(`${txnCount.toLocaleString('en-IN')} transactions in selected range`);
  }
  if (totalCredit > 0) {
    insights.push(`Savings rate ${savingsRate.toFixed(1)}% (net ÷ credits)`);
  }
  if (months.length) {
    insights.push(
      `Avg monthly spend ₹${avgMonthlyDebit.toLocaleString('en-IN', { maximumFractionDigits: 0 })} · avg credit ₹${avgMonthlyCredit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    );
  }
  if (mom?.debit_change_pct != null) {
    const dir = mom.debit_change_pct >= 0 ? 'up' : 'down';
    insights.push(
      `Debits ${dir} ${Math.abs(mom.debit_change_pct).toFixed(1)}% vs ${mom.previous_month}`
    );
  }
  if (uncategorizedCount > 0) {
    insights.push(`${uncategorizedCount.toLocaleString('en-IN')} transactions need better categorization`);
  }
  if (expenseByCategory[0]) {
    insights.push(
      `Top spend category: ${expenseByCategory[0].category} (₹${expenseByCategory[0].total_debit.toLocaleString('en-IN', { maximumFractionDigits: 0 })})`
    );
  }

  return {
    summaryExtras: {
      avg_monthly_debit: avgMonthlyDebit,
      avg_monthly_credit: avgMonthlyCredit,
      savings_rate: savingsRate,
      uncategorized_count: uncategorizedCount,
      month_count: months.length
    },
    expenseByCategory,
    mom,
    insights
  };
}

async function mysqlGetCategories() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT DISTINCT category FROM bank_transactions
     WHERE category IS NOT NULL AND category <> ''
     ORDER BY category`
  );
  return rows.map((r) => r.category);
}

async function mysqlFindExistingFingerprints(accountId, fingerprints) {
  if (!accountId || !fingerprints?.length) return new Set();
  const pool = getPool();
  const existing = new Set();
  const chunkSize = 500;
  for (let i = 0; i < fingerprints.length; i += chunkSize) {
    const chunk = fingerprints.slice(i, i + chunkSize);
    const [rows] = await pool.query(
      `SELECT fingerprint FROM bank_transactions
       WHERE account_id = ? AND fingerprint IN (${chunk.map(() => '?').join(',')})`,
      [Number(accountId), ...chunk]
    );
    rows.forEach((r) => existing.add(r.fingerprint));
  }
  return existing;
}

/* ===================== Mongo ===================== */

async function nextMongoId(collectionName) {
  const db = getMongoDb();
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: collectionName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq || result.value?.seq || 1;
}

function formatBankDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function mongoGetAccounts() {
  const db = getMongoDb();
  const accounts = await db.collection('bank_accounts').find({}).sort({ bank_name: 1, account_name: 1 }).toArray();
  const result = [];
  for (const a of accounts) {
    const txn_count = await db.collection('bank_transactions').countDocuments({ account_id: a.id });
    const latest = await db
      .collection('bank_transactions')
      .find({ account_id: a.id, balance: { $ne: null } })
      .sort({ txn_date: -1, id: -1 })
      .limit(1)
      .toArray();
    result.push({
      ...formatBankDoc(a),
      txn_count,
      latest_balance: latest[0]?.balance ?? null
    });
  }
  return result;
}

async function mongoGetAccountById(id) {
  const db = getMongoDb();
  const doc = await db.collection('bank_accounts').findOne({ id: Number(id) });
  return formatBankDoc(doc);
}

async function mongoCreateAccount(data) {
  const db = getMongoDb();
  const id = await nextMongoId('bank_accounts');
  const doc = {
    id,
    bank_name: data.bank_name,
    account_name: data.account_name,
    account_number: data.account_number || null,
    ifsc: data.ifsc || null,
    account_type: data.account_type || 'Savings',
    currency: data.currency || 'INR',
    opening_balance: num(data.opening_balance),
    notes: data.notes || null,
    is_active: data.is_active === false || data.is_active === 0 ? 0 : 1,
    created_at: new Date(),
    updated_at: new Date()
  };
  await db.collection('bank_accounts').insertOne(doc);
  return formatBankDoc(doc);
}

async function mongoUpdateAccount(id, data) {
  const db = getMongoDb();
  await db.collection('bank_accounts').updateOne(
    { id: Number(id) },
    {
      $set: {
        bank_name: data.bank_name,
        account_name: data.account_name,
        account_number: data.account_number || null,
        ifsc: data.ifsc || null,
        account_type: data.account_type || 'Savings',
        currency: data.currency || 'INR',
        opening_balance: num(data.opening_balance),
        notes: data.notes || null,
        is_active: data.is_active === false || data.is_active === 0 ? 0 : 1,
        updated_at: new Date()
      }
    }
  );
  return mongoGetAccountById(id);
}

async function mongoDeleteAccount(id) {
  const db = getMongoDb();
  await db.collection('bank_transactions').deleteMany({ account_id: Number(id) });
  const result = await db.collection('bank_accounts').deleteOne({ id: Number(id) });
  return result.deletedCount > 0;
}

async function mongoImportTransactions(accountId, transactions, importBatchId) {
  const db = getMongoDb();
  let inserted = 0;
  let skipped = 0;
  for (const txn of transactions) {
    const exists = await db.collection('bank_transactions').findOne({
      account_id: Number(accountId),
      fingerprint: txn.fingerprint
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    const id = await nextMongoId('bank_transactions');
    await db.collection('bank_transactions').insertOne({
      id,
      account_id: Number(accountId),
      txn_date: txn.txn_date,
      value_date: txn.value_date || txn.txn_date,
      narration: txn.narration || null,
      ref_no: txn.ref_no || null,
      withdrawal: num(txn.withdrawal),
      deposit: num(txn.deposit),
      balance: txn.balance === null || txn.balance === undefined ? null : num(txn.balance),
      category: txn.category || null,
      category_source: txn.category_source || 'auto',
      payee: txn.payee || null,
      txn_type: txn.txn_type || null,
      fingerprint: txn.fingerprint,
      raw_bank: txn.raw_bank || null,
      tags: txn.tags || null,
      notes: txn.notes || null,
      import_batch_id: importBatchId || null,
      linked_transfer_id: null,
      created_at: new Date(),
      updated_at: new Date()
    });
    inserted += 1;
  }
  return { inserted, skipped, total: transactions.length, import_batch_id: importBatchId };
}

function mongoTxnQuery(filters = {}) {
  const q = {};
  if (filters.account_id) q.account_id = Number(filters.account_id);
  if (filters.from || filters.to) {
    q.txn_date = {};
    if (filters.from) q.txn_date.$gte = filters.from;
    if (filters.to) q.txn_date.$lte = filters.to;
  }
  if (filters.category) q.category = filters.category;
  if (filters.txn_type) q.txn_type = filters.txn_type;
  if (filters.payee) {
    q.payee = new RegExp(String(filters.payee).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  if (filters.flow === 'debit') q.withdrawal = { $gt: 0 };
  if (filters.flow === 'credit') q.deposit = { $gt: 0 };
  if (filters.min_amount) {
    q.$or = [{ withdrawal: { $gte: num(filters.min_amount) } }, { deposit: { $gte: num(filters.min_amount) } }];
  }
  if (filters.q) {
    const re = new RegExp(String(filters.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ narration: re }, { ref_no: re }, { notes: re }];
  }
  if (wantsExcludeTransfers(filters)) {
    q.$and = [
      ...(q.$and || []),
      { category: { $nin: ['Transfer In', 'Transfer Out'] } },
      {
        $or: [{ linked_transfer_id: null }, { linked_transfer_id: { $exists: false } }]
      }
    ];
  }
  return q;
}

async function mongoGetCashSummary() {
  return buildCashSummaryFromAccounts(await mongoGetAccounts());
}

async function mongoGetAnalyticsByPayee(filters = {}) {
  const db = getMongoDb();
  const query = mongoTxnQuery(filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 15, 1), 100);
  const rows = await db.collection('bank_transactions').find(query).toArray();
  const map = {};
  for (const r of rows) {
    const payee = String(r.payee || '').trim() || 'Unknown';
    if (!map[payee]) {
      map[payee] = { payee, txn_count: 0, total_debit: 0, total_credit: 0 };
    }
    map[payee].txn_count += 1;
    map[payee].total_debit += num(r.withdrawal);
    map[payee].total_credit += num(r.deposit);
  }
  return Object.values(map)
    .sort((a, b) => b.total_debit - a.total_debit || b.total_credit - a.total_credit)
    .slice(0, limit);
}

async function mongoGetTransactions(filters = {}) {
  const db = getMongoDb();
  const query = mongoTxnQuery(filters);
  const limit = Math.min(Number(filters.limit) || 100, 5000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sort = String(filters.sort || 'date_desc');
  const sortMap = {
    date_desc: { txn_date: -1, id: -1 },
    date_asc: { txn_date: 1, id: 1 },
    account_asc: { account_id: 1, txn_date: -1 },
    account_desc: { account_id: -1, txn_date: -1 },
    narration_asc: { narration: 1, txn_date: -1 },
    narration_desc: { narration: -1, txn_date: -1 },
    debit_asc: { withdrawal: 1, txn_date: -1 },
    debit_desc: { withdrawal: -1, txn_date: -1 },
    credit_asc: { deposit: 1, txn_date: -1 },
    credit_desc: { deposit: -1, txn_date: -1 },
    balance_asc: { balance: 1, txn_date: -1 },
    balance_desc: { balance: -1, txn_date: -1 },
    category_asc: { category: 1, txn_date: -1 },
    category_desc: { category: -1, txn_date: -1 },
    amount_asc: { withdrawal: 1, deposit: 1, txn_date: -1 },
    amount_desc: { withdrawal: -1, deposit: -1, txn_date: -1 }
  };
  const sortSpec = sortMap[sort] || sortMap.date_desc;

  const allForTotals = await db
    .collection('bank_transactions')
    .aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          total_debit: { $sum: '$withdrawal' },
          total_credit: { $sum: '$deposit' }
        }
      }
    ])
    .toArray();
  const totals = allForTotals[0] || { total: 0, total_debit: 0, total_credit: 0 };

  const rows = await db
    .collection('bank_transactions')
    .find(query)
    .sort(sortSpec)
    .skip(offset)
    .limit(limit)
    .toArray();

  const accountIds = [...new Set(rows.map((r) => r.account_id))];
  const accounts = await db
    .collection('bank_accounts')
    .find({ id: { $in: accountIds } })
    .toArray();
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  return {
    rows: rows.map((r) => ({
      ...formatBankDoc(r),
      bank_name: accountMap[r.account_id]?.bank_name,
      account_name: accountMap[r.account_id]?.account_name,
      account_number: accountMap[r.account_id]?.account_number
    })),
    total: totals.total,
    total_debit: totals.total_debit,
    total_credit: totals.total_credit,
    net_cashflow: num(totals.total_credit) - num(totals.total_debit),
    limit,
    offset
  };
}

async function mongoUpdateTransaction(id, data) {
  const db = getMongoDb();
  const $set = { updated_at: new Date() };
  for (const key of ['category', 'tags', 'notes', 'txn_type', 'payee', 'category_source']) {
    if (data[key] !== undefined) $set[key] = data[key];
  }
  if (data.category !== undefined && data.category_source === undefined) {
    $set.category_source = 'manual';
  }
  await db.collection('bank_transactions').updateOne({ id: Number(id) }, { $set });
  const doc = await db.collection('bank_transactions').findOne({ id: Number(id) });
  return formatBankDoc(doc);
}

async function mongoDeleteTransaction(id) {
  const db = getMongoDb();
  const result = await db.collection('bank_transactions').deleteOne({ id: Number(id) });
  return result.deletedCount > 0;
}

async function mongoBulkCategorize(ids, category) {
  const db = getMongoDb();
  if (!ids?.length) return 0;
  const result = await db.collection('bank_transactions').updateMany(
    { id: { $in: ids.map(Number) } },
    { $set: { category, category_source: 'manual', updated_at: new Date() } }
  );
  return result.modifiedCount;
}

async function mongoRecategorizeAll(accountId, { mode = 'auto_only', customRules = [] } = {}) {
  const db = getMongoDb();
  const query = {};
  if (accountId) query.account_id = Number(accountId);
  if (mode === 'uncategorized') {
    query.$or = [
      { category: null },
      { category: '' },
      { category: { $in: ['Uncategorized', 'Expense / Debit', 'Income / Credit'] } }
    ];
  } else if (mode !== 'all') {
    query.category_source = { $ne: 'manual' };
  }
  const rows = await db.collection('bank_transactions').find(query).toArray();
  let updated = 0;
  for (const row of rows) {
    if (mode !== 'all' && row.category_source === 'manual') continue;
    const suggested = categoryResult(
      row.narration,
      row.withdrawal,
      row.deposit,
      customRules,
      row.account_id,
      row.payee
    );
    const payee = row.payee || extractPayee(row.narration);
    await db.collection('bank_transactions').updateOne(
      { id: row.id },
      {
        $set: {
          category: suggested.category,
          category_source: suggested.source,
          payee: row.payee || payee,
          updated_at: new Date()
        }
      }
    );
    updated += 1;
  }
  return updated;
}

async function mongoGetAnalytics(filters = {}) {
  const db = getMongoDb();
  const query = mongoTxnQuery(filters);
  const rows = await db.collection('bank_transactions').find(query).toArray();

  const summary = {
    txn_count: rows.length,
    total_debit: 0,
    total_credit: 0,
    net_cashflow: 0
  };
  const catMap = {};
  const monthMap = {};
  const catMonthMap = {};
  for (const r of rows) {
    summary.total_debit += num(r.withdrawal);
    summary.total_credit += num(r.deposit);
    const cat = r.category || 'Uncategorized';
    if (!catMap[cat]) catMap[cat] = { category: cat, txn_count: 0, total_debit: 0, total_credit: 0 };
    catMap[cat].txn_count += 1;
    catMap[cat].total_debit += num(r.withdrawal);
    catMap[cat].total_credit += num(r.deposit);
    const month = String(r.txn_date).slice(0, 7);
    if (!monthMap[month]) monthMap[month] = { month, txn_count: 0, total_debit: 0, total_credit: 0, net: 0 };
    monthMap[month].txn_count += 1;
    monthMap[month].total_debit += num(r.withdrawal);
    monthMap[month].total_credit += num(r.deposit);
    monthMap[month].net += num(r.deposit) - num(r.withdrawal);
    const cmKey = `${month}::${cat}`;
    if (!catMonthMap[cmKey]) {
      catMonthMap[cmKey] = {
        month,
        category: cat,
        txn_count: 0,
        total_debit: 0,
        total_credit: 0
      };
    }
    catMonthMap[cmKey].txn_count += 1;
    catMonthMap[cmKey].total_debit += num(r.withdrawal);
    catMonthMap[cmKey].total_credit += num(r.deposit);
  }
  summary.net_cashflow = summary.total_credit - summary.total_debit;

  const topExpenses = [...rows]
    .filter((r) => num(r.withdrawal) > 0)
    .sort((a, b) => num(b.withdrawal) - num(a.withdrawal))
    .slice(0, 15)
    .map(formatBankDoc);

  const topCredits = [...rows]
    .filter((r) => num(r.deposit) > 0)
    .sort((a, b) => num(b.deposit) - num(a.deposit))
    .slice(0, 15)
    .map(formatBankDoc);

  const interestTax = {
    interest_earned: rows
      .filter((r) => r.category === 'Interest Income' || r.txn_type === 'interest')
      .reduce((s, r) => s + num(r.deposit), 0),
    tax_deducted: rows
      .filter((r) => r.category === 'TDS / Tax' || r.txn_type === 'tax')
      .reduce((s, r) => s + num(r.withdrawal), 0),
    fd_booked: rows
      .filter((r) => r.category === 'Fixed Deposit' || r.txn_type === 'fd_book')
      .reduce((s, r) => s + num(r.withdrawal), 0),
    fd_matured: rows
      .filter((r) => r.txn_type === 'fd_maturity')
      .reduce((s, r) => s + num(r.deposit), 0)
  };

  const balanceSeries = rows
    .filter((r) => r.balance !== null && r.balance !== undefined)
    .sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)) || a.id - b.id)
    .map((r) => ({ date: r.txn_date, balance: r.balance, account_id: r.account_id }));

  const accounts = await mongoGetAccounts();
  const byAccount = accounts.map((a) => {
    const txns = rows.filter((r) => r.account_id === a.id);
    return {
      id: a.id,
      bank_name: a.bank_name,
      account_name: a.account_name,
      account_number: a.account_number,
      txn_count: txns.length,
      total_debit: txns.reduce((s, r) => s + num(r.withdrawal), 0),
      total_credit: txns.reduce((s, r) => s + num(r.deposit), 0)
    };
  });

  const byCategory = Object.values(catMap).sort(
    (a, b) => b.total_debit + b.total_credit - (a.total_debit + a.total_credit)
  );
  const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  const byCategoryMonth = Object.values(catMonthMap).sort(
    (a, b) => a.month.localeCompare(b.month) || b.total_debit - a.total_debit
  );

  const interestMonthMap = {};
  for (const r of rows) {
    const month = String(r.txn_date).slice(0, 7);
    if (!interestMonthMap[month]) {
      interestMonthMap[month] = { month, interest: 0, tax: 0, fd_booked: 0 };
    }
    if (r.category === 'Interest Income' || r.txn_type === 'interest') {
      interestMonthMap[month].interest += num(r.deposit);
    }
    if (r.category === 'TDS / Tax' || r.txn_type === 'tax') {
      interestMonthMap[month].tax += num(r.withdrawal);
    }
    if (r.category === 'Fixed Deposit' || r.txn_type === 'fd_book') {
      interestMonthMap[month].fd_booked += num(r.withdrawal);
    }
  }
  const interestByMonth = Object.values(interestMonthMap)
    .filter((r) => r.interest > 0 || r.tax > 0 || r.fd_booked > 0)
    .sort((a, b) => a.month.localeCompare(b.month));

  const uncategorizedCount = rows.filter((r) => {
    const c = r.category || 'Uncategorized';
    return !r.category || c === 'Uncategorized' || c === 'Expense / Debit' || c === 'Income / Credit';
  }).length;
  const extras = buildAnalyticsExtras(summary, byMonth, byCategory, uncategorizedCount);
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();

  return {
    summary: { ...summary, ...extras.summaryExtras },
    byCategory,
    expenseByCategory: extras.expenseByCategory,
    byMonth,
    byCategoryMonth,
    interestByMonth,
    topExpenses,
    topCredits,
    interestTax,
    balanceSeries,
    byAccount,
    insights: extras.insights,
    mom: extras.mom,
    categories
  };
}

async function mongoGetCategories() {
  const db = getMongoDb();
  return (await db.collection('bank_transactions').distinct('category')).filter(Boolean).sort();
}

async function mongoFindExistingFingerprints(accountId, fingerprints) {
  if (!accountId || !fingerprints?.length) return new Set();
  const db = getMongoDb();
  const existing = new Set();
  const chunkSize = 500;
  for (let i = 0; i < fingerprints.length; i += chunkSize) {
    const chunk = fingerprints.slice(i, i + chunkSize);
    const rows = await db
      .collection('bank_transactions')
      .find({ account_id: Number(accountId), fingerprint: { $in: chunk } }, { projection: { fingerprint: 1 } })
      .toArray();
    rows.forEach((r) => existing.add(r.fingerprint));
  }
  return existing;
}

/* ===================== Public API ===================== */

const advanced = require('./banking-advanced');

const impl = () => (isMongoDb() ? 'mongo' : 'mysql');

module.exports = {
  getAccounts: (...a) => (impl() === 'mongo' ? mongoGetAccounts(...a) : mysqlGetAccounts(...a)),
  getAccountById: (...a) => (impl() === 'mongo' ? mongoGetAccountById(...a) : mysqlGetAccountById(...a)),
  createAccount: (...a) => (impl() === 'mongo' ? mongoCreateAccount(...a) : mysqlCreateAccount(...a)),
  updateAccount: (...a) => (impl() === 'mongo' ? mongoUpdateAccount(...a) : mysqlUpdateAccount(...a)),
  deleteAccount: (...a) => (impl() === 'mongo' ? mongoDeleteAccount(...a) : mysqlDeleteAccount(...a)),
  importTransactions: (...a) =>
    impl() === 'mongo' ? mongoImportTransactions(...a) : mysqlImportTransactions(...a),
  getTransactions: (...a) => (impl() === 'mongo' ? mongoGetTransactions(...a) : mysqlGetTransactions(...a)),
  updateTransaction: (...a) =>
    impl() === 'mongo' ? mongoUpdateTransaction(...a) : mysqlUpdateTransaction(...a),
  deleteTransaction: (...a) =>
    impl() === 'mongo' ? mongoDeleteTransaction(...a) : mysqlDeleteTransaction(...a),
  bulkCategorize: (...a) => (impl() === 'mongo' ? mongoBulkCategorize(...a) : mysqlBulkCategorize(...a)),
  recategorizeAll: (...a) => (impl() === 'mongo' ? mongoRecategorizeAll(...a) : mysqlRecategorizeAll(...a)),
  getAnalytics: (...a) => (impl() === 'mongo' ? mongoGetAnalytics(...a) : mysqlGetAnalytics(...a)),
  getAnalyticsByPayee: (...a) =>
    impl() === 'mongo' ? mongoGetAnalyticsByPayee(...a) : mysqlGetAnalyticsByPayee(...a),
  getCashSummary: (...a) => (impl() === 'mongo' ? mongoGetCashSummary(...a) : mysqlGetCashSummary(...a)),
  getCategories: (...a) => (impl() === 'mongo' ? mongoGetCategories(...a) : mysqlGetCategories(...a)),
  findExistingFingerprints: (...a) =>
    impl() === 'mongo' ? mongoFindExistingFingerprints(...a) : mysqlFindExistingFingerprints(...a),
  ...advanced
};
