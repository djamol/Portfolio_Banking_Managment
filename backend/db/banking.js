const { isMongoDb, getPool, getMongoDb } = require('../config/index');
const { suggestCategory } = require('../utils/bank-parsers/common');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
             category, txn_type, fingerprint, raw_bank, tags, notes, import_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

function buildTxnWhere(filters = {}) {
  const where = ['1=1'];
  const params = [];
  if (filters.account_id) {
    where.push('account_id = ?');
    params.push(Number(filters.account_id));
  }
  if (filters.from) {
    where.push('txn_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('txn_date <= ?');
    params.push(filters.to);
  }
  if (filters.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters.txn_type) {
    where.push('txn_type = ?');
    params.push(filters.txn_type);
  }
  if (filters.q) {
    where.push('(narration LIKE ? OR ref_no LIKE ? OR notes LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  if (filters.min_amount) {
    where.push('(withdrawal >= ? OR deposit >= ?)');
    params.push(num(filters.min_amount), num(filters.min_amount));
  }
  if (filters.flow === 'debit') where.push('withdrawal > 0');
  if (filters.flow === 'credit') where.push('deposit > 0');
  return { whereSql: where.join(' AND '), params };
}

async function mysqlGetTransactions(filters = {}) {
  const pool = getPool();
  const { whereSql, params } = buildTxnWhere(filters);
  const limit = Math.min(Number(filters.limit) || 200, 2000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const [rows] = await pool.query(
    `SELECT t.*, a.bank_name, a.account_name, a.account_number
     FROM bank_transactions t
     JOIN bank_accounts a ON a.id = t.account_id
     WHERE ${whereSql}
     ORDER BY t.txn_date DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM bank_transactions WHERE ${whereSql}`,
    params
  );
  return { rows, total: countRows[0].total, limit, offset };
}

async function mysqlUpdateTransaction(id, data) {
  const pool = getPool();
  const fields = [];
  const params = [];
  for (const key of ['category', 'tags', 'notes', 'txn_type']) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
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
    `UPDATE bank_transactions SET category = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    [category, ...ids]
  );
  return result.affectedRows;
}

async function mysqlRecategorizeAll(accountId) {
  const pool = getPool();
  const params = [];
  let sql = 'SELECT id, narration, withdrawal, deposit FROM bank_transactions';
  if (accountId) {
    sql += ' WHERE account_id = ?';
    params.push(accountId);
  }
  const [rows] = await pool.query(sql, params);
  let updated = 0;
  for (const row of rows) {
    const category = suggestCategory(row.narration, row.withdrawal, row.deposit);
    const [result] = await pool.query('UPDATE bank_transactions SET category = ? WHERE id = ?', [
      category,
      row.id
    ]);
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

  const [topExpenses] = await pool.query(
    `SELECT id, txn_date, narration, withdrawal, deposit, category, account_id
     FROM bank_transactions
     WHERE ${whereSql} AND withdrawal > 0
     ORDER BY withdrawal DESC
     LIMIT 15`,
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

  return {
    summary: summaryRows[0],
    byCategory,
    byMonth,
    topExpenses,
    interestTax: interestTax[0],
    balanceSeries,
    byAccount,
    categories: categories.map((c) => c.category)
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
      txn_type: txn.txn_type || null,
      fingerprint: txn.fingerprint,
      raw_bank: txn.raw_bank || null,
      tags: txn.tags || null,
      notes: txn.notes || null,
      import_batch_id: importBatchId || null,
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
  if (filters.flow === 'debit') q.withdrawal = { $gt: 0 };
  if (filters.flow === 'credit') q.deposit = { $gt: 0 };
  if (filters.min_amount) {
    q.$or = [{ withdrawal: { $gte: num(filters.min_amount) } }, { deposit: { $gte: num(filters.min_amount) } }];
  }
  if (filters.q) {
    const re = new RegExp(String(filters.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ narration: re }, { ref_no: re }, { notes: re }];
  }
  return q;
}

async function mongoGetTransactions(filters = {}) {
  const db = getMongoDb();
  const query = mongoTxnQuery(filters);
  const limit = Math.min(Number(filters.limit) || 200, 2000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = await db.collection('bank_transactions').countDocuments(query);
  const rows = await db
    .collection('bank_transactions')
    .find(query)
    .sort({ txn_date: -1, id: -1 })
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
    total,
    limit,
    offset
  };
}

async function mongoUpdateTransaction(id, data) {
  const db = getMongoDb();
  const $set = { updated_at: new Date() };
  for (const key of ['category', 'tags', 'notes', 'txn_type']) {
    if (data[key] !== undefined) $set[key] = data[key];
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
    { $set: { category, updated_at: new Date() } }
  );
  return result.modifiedCount;
}

async function mongoRecategorizeAll(accountId) {
  const db = getMongoDb();
  const query = accountId ? { account_id: Number(accountId) } : {};
  const rows = await db.collection('bank_transactions').find(query).toArray();
  let updated = 0;
  for (const row of rows) {
    const category = suggestCategory(row.narration, row.withdrawal, row.deposit);
    await db.collection('bank_transactions').updateOne(
      { id: row.id },
      { $set: { category, updated_at: new Date() } }
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
  }
  summary.net_cashflow = summary.total_credit - summary.total_debit;

  const topExpenses = [...rows]
    .filter((r) => num(r.withdrawal) > 0)
    .sort((a, b) => num(b.withdrawal) - num(a.withdrawal))
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

  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();

  return {
    summary,
    byCategory: Object.values(catMap).sort(
      (a, b) => b.total_debit + b.total_credit - (a.total_debit + a.total_credit)
    ),
    byMonth: Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)),
    topExpenses,
    interestTax,
    balanceSeries,
    byAccount,
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
  getCategories: (...a) => (impl() === 'mongo' ? mongoGetCategories(...a) : mysqlGetCategories(...a)),
  findExistingFingerprints: (...a) =>
    impl() === 'mongo' ? mongoFindExistingFingerprints(...a) : mysqlFindExistingFingerprints(...a)
};
