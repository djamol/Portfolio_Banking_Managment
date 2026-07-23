const { getPool } = require('../config/database');

async function getAllInvestments() {
  const pool = getPool();
  const [rows] = await pool.query(`
    SELECT * FROM investments
    ORDER BY investment_date DESC, created_at DESC
  `);
  return rows;
}

async function searchInvestments(criteria) {
  const pool = getPool();
  let query = 'SELECT * FROM investments WHERE 1=1';
  const params = [];

  if (criteria.website_app_name) {
    query += ' AND website_app_name = ?';
    params.push(criteria.website_app_name);
  }
  if (criteria.sub_type_name) {
    query += ' AND sub_type_name = ?';
    params.push(criteria.sub_type_name);
  }
  if (criteria.sub_type_category) {
    query += ' AND sub_type_category = ?';
    params.push(criteria.sub_type_category);
  }

  query += ' ORDER BY investment_date DESC, created_at DESC';
  const [rows] = await pool.query(query, params);
  return rows;
}

async function getInvestmentById(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM investments WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createInvestment(data) {
  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO investments (website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.website_app_name,
      data.investment_type,
      data.sub_type_name || null,
      data.sub_type_category || null,
      data.amount,
      data.investment_date,
      data.notes || null
    ]
  );

  await pool.query(
    `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
     VALUES (?, ?, ?, 'added', ?)`,
    [result.insertId, data.amount, data.investment_date, data.notes || null]
  );

  return getInvestmentById(result.insertId);
}

async function updateInvestment(id, data) {
  const pool = getPool();
  const [oldInvestment] = await pool.query('SELECT amount FROM investments WHERE id = ?', [id]);
  if (!oldInvestment.length) return null;

  await pool.query(
    `UPDATE investments
     SET website_app_name = ?, investment_type = ?, sub_type_name = ?,
         sub_type_category = ?, amount = ?, investment_date = ?, notes = ?
     WHERE id = ?`,
    [
      data.website_app_name,
      data.investment_type,
      data.sub_type_name || null,
      data.sub_type_category || null,
      data.amount,
      data.investment_date,
      data.notes || null,
      id
    ]
  );

  if (Number(oldInvestment[0].amount) !== Number(data.amount)) {
    await pool.query(
      `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
       VALUES (?, ?, ?, 'updated', ?)`,
      [id, data.amount, data.investment_date || new Date().toISOString().split('T')[0], data.notes || null]
    );
  }

  return getInvestmentById(id);
}

async function deleteInvestment(id) {
  const pool = getPool();
  const [investment] = await pool.query('SELECT * FROM investments WHERE id = ?', [id]);
  if (!investment.length) return false;

  await pool.query(
    `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
     VALUES (?, ?, ?, 'removed', ?)`,
    [id, investment[0].amount, new Date().toISOString().split('T')[0], investment[0].notes || null]
  );

  await pool.query('DELETE FROM investments WHERE id = ?', [id]);
  return true;
}

async function getAllSubTypeNames() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM sub_type_names ORDER BY investment_type, name ASC');
  return rows;
}

async function getSubTypeNamesByType(investmentType) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM sub_type_names WHERE investment_type = ? ORDER BY name ASC',
    [investmentType]
  );
  return rows;
}

async function createSubTypeName(data) {
  const pool = getPool();
  const [result] = await pool.query(
    'INSERT INTO sub_type_names (name, investment_type) VALUES (?, ?)',
    [data.name, data.investment_type]
  );
  const [rows] = await pool.query('SELECT * FROM sub_type_names WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function deleteSubTypeName(id) {
  const pool = getPool();
  await pool.query('DELETE FROM sub_type_names WHERE id = ?', [id]);
}

async function getCategories(investmentType, subTypeNameId) {
  const pool = getPool();
  let query = `
    SELECT c.*, s.name as sub_type_name
    FROM sub_type_categories c
    LEFT JOIN sub_type_names s ON c.sub_type_name_id = s.id
    WHERE c.investment_type = ?
  `;
  const params = [investmentType];

  if (subTypeNameId && subTypeNameId !== 'null') {
    query += ' AND (c.sub_type_name_id = ? OR c.sub_type_name_id IS NULL)';
    params.push(subTypeNameId);
  }

  query += ' ORDER BY c.category ASC';
  const [rows] = await pool.query(query, params);
  return rows;
}

async function createCategory(data) {
  const pool = getPool();
  const [result] = await pool.query(
    'INSERT INTO sub_type_categories (category, sub_type_name_id, investment_type) VALUES (?, ?, ?)',
    [data.category, data.sub_type_name_id || null, data.investment_type]
  );
  const [rows] = await pool.query(
    'SELECT c.*, s.name as sub_type_name FROM sub_type_categories c LEFT JOIN sub_type_names s ON c.sub_type_name_id = s.id WHERE c.id = ?',
    [result.insertId]
  );
  return rows[0];
}

async function getAllCategories() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT c.*, s.name as sub_type_name
     FROM sub_type_categories c
     LEFT JOIN sub_type_names s ON c.sub_type_name_id = s.id
     ORDER BY c.investment_type, c.category ASC`
  );
  return rows;
}

async function deleteCategory(id) {
  const pool = getPool();
  await pool.query('DELETE FROM sub_type_categories WHERE id = ?', [id]);
}

async function findInvestmentByKey(key) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id FROM investments
     WHERE website_app_name = ? AND investment_type = ? AND sub_type_name = ? AND sub_type_category = ?
     LIMIT 1`,
    [key.website_app_name, key.investment_type, key.sub_type_name || null, key.sub_type_category || null]
  );
  return rows[0] || null;
}

async function upsertImportedInvestment(investment) {
  const pool = getPool();
  const existing = await findInvestmentByKey(investment);

  if (existing) {
    await pool.query(
      `UPDATE investments
       SET amount = ?, investment_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [investment.amount, investment.investment_date, investment.notes || null, existing.id]
    );
    await pool.query(
      `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
       VALUES (?, ?, ?, 'updated', ?)`,
      [existing.id, investment.amount, investment.investment_date, investment.notes || null]
    );
    return { action: 'updated', id: existing.id };
  }

  const [result] = await pool.query(
    `INSERT INTO investments (website_app_name, investment_type, sub_type_name, sub_type_category, amount, investment_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      investment.website_app_name,
      investment.investment_type,
      investment.sub_type_name || null,
      investment.sub_type_category || null,
      investment.amount,
      investment.investment_date,
      investment.notes || null
    ]
  );
  await pool.query(
    `INSERT INTO investment_history (investment_id, amount, change_date, change_type, notes)
     VALUES (?, ?, ?, 'added', ?)`,
    [result.insertId, investment.amount, investment.investment_date, investment.notes || null]
  );
  return { action: 'imported', id: result.insertId };
}

const TXN_INFLOW_TYPES = new Set(['dividend', 'interest', 'sell', 'withdrawal', 'transfer_out']);
const TXN_OUTFLOW_TYPES = new Set(['buy', 'fee', 'deposit', 'transfer_in']);
const VALID_TXN_TYPES = new Set([...TXN_INFLOW_TYPES, ...TXN_OUTFLOW_TYPES]);

function normalizeCashflowAmount(txnType, amount) {
  const abs = Math.abs(Number(amount));
  if (!Number.isFinite(abs)) {
    throw new Error('cashflow_amount must be a valid number');
  }
  if (TXN_OUTFLOW_TYPES.has(txnType)) return -abs;
  if (TXN_INFLOW_TYPES.has(txnType)) return abs;
  throw new Error(`Invalid txn_type: ${txnType}`);
}

function parseTxnFilters(filters = {}) {
  const where = ['1=1'];
  const params = [];

  if (filters.investment_id) {
    where.push('t.investment_id = ?');
    params.push(Number(filters.investment_id));
  }
  if (filters.from) {
    where.push('t.txn_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('t.txn_date <= ?');
    params.push(filters.to);
  }
  if (filters.txn_type) {
    where.push('t.txn_type = ?');
    params.push(filters.txn_type);
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  return { where: where.join(' AND '), params, limit, offset };
}

async function listTransactions(filters = {}) {
  const pool = getPool();
  const { where, params, limit, offset } = parseTxnFilters(filters);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM investment_transactions t WHERE ${where}`,
    params
  );
  const [sumRows] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN t.cashflow_amount > 0 THEN t.cashflow_amount ELSE 0 END), 0) AS total_inflow,
       COALESCE(SUM(CASE WHEN t.cashflow_amount < 0 THEN -t.cashflow_amount ELSE 0 END), 0) AS total_outflow,
       COALESCE(SUM(t.cashflow_amount), 0) AS net_cashflow
     FROM investment_transactions t
     WHERE ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT
       t.*,
       i.website_app_name,
       i.investment_type,
       i.sub_type_name,
       i.sub_type_category
     FROM investment_transactions t
     LEFT JOIN investments i ON i.id = t.investment_id
     WHERE ${where}
     ORDER BY t.txn_date DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totals = sumRows[0] || { total_inflow: 0, total_outflow: 0, net_cashflow: 0 };
  return {
    rows,
    meta: {
      total: Number(countRows[0]?.total || 0),
      limit,
      offset,
      total_inflow: Number(totals.total_inflow || 0),
      total_outflow: Number(totals.total_outflow || 0),
      net_cashflow: Number(totals.net_cashflow || 0)
    }
  };
}

async function getTransactionById(id) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT
       t.*,
       i.website_app_name,
       i.investment_type,
       i.sub_type_name,
       i.sub_type_category
     FROM investment_transactions t
     LEFT JOIN investments i ON i.id = t.investment_id
     WHERE t.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function createTransaction(data) {
  const pool = getPool();
  const investmentId = Number(data.investment_id);
  if (!investmentId) throw new Error('investment_id is required');
  if (!data.txn_date) throw new Error('txn_date is required');
  if (!VALID_TXN_TYPES.has(data.txn_type)) {
    throw new Error(`Invalid txn_type: ${data.txn_type}`);
  }

  const investment = await getInvestmentById(investmentId);
  if (!investment) throw new Error('Investment not found');

  const cashflowAmount = normalizeCashflowAmount(data.txn_type, data.cashflow_amount);
  const [result] = await pool.query(
    `INSERT INTO investment_transactions
       (investment_id, txn_date, txn_type, units, price, cashflow_amount, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      investmentId,
      data.txn_date,
      data.txn_type,
      data.units != null && data.units !== '' ? Number(data.units) : null,
      data.price != null && data.price !== '' ? Number(data.price) : null,
      cashflowAmount,
      data.notes || null
    ]
  );
  return getTransactionById(result.insertId);
}

async function updateTransaction(id, data) {
  const pool = getPool();
  const existing = await getTransactionById(id);
  if (!existing) return null;

  const investmentId = data.investment_id != null ? Number(data.investment_id) : Number(existing.investment_id);
  const txnType = data.txn_type || existing.txn_type;
  const txnDate = data.txn_date || existing.txn_date;
  const amountInput = data.cashflow_amount != null ? data.cashflow_amount : existing.cashflow_amount;

  if (!VALID_TXN_TYPES.has(txnType)) {
    throw new Error(`Invalid txn_type: ${txnType}`);
  }

  const investment = await getInvestmentById(investmentId);
  if (!investment) throw new Error('Investment not found');

  const cashflowAmount = normalizeCashflowAmount(txnType, amountInput);
  const units = data.units !== undefined
    ? (data.units != null && data.units !== '' ? Number(data.units) : null)
    : existing.units;
  const price = data.price !== undefined
    ? (data.price != null && data.price !== '' ? Number(data.price) : null)
    : existing.price;
  const notes = data.notes !== undefined ? (data.notes || null) : existing.notes;

  await pool.query(
    `UPDATE investment_transactions
     SET investment_id = ?, txn_date = ?, txn_type = ?, units = ?, price = ?,
         cashflow_amount = ?, notes = ?
     WHERE id = ?`,
    [investmentId, txnDate, txnType, units, price, cashflowAmount, notes, id]
  );
  return getTransactionById(id);
}

async function deleteTransaction(id) {
  const pool = getPool();
  const [result] = await pool.query('DELETE FROM investment_transactions WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = {
  getAllInvestments,
  searchInvestments,
  getInvestmentById,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  getAllSubTypeNames,
  getSubTypeNamesByType,
  createSubTypeName,
  deleteSubTypeName,
  getCategories,
  createCategory,
  getAllCategories,
  deleteCategory,
  findInvestmentByKey,
  upsertImportedInvestment,
  listTransactions,
  getTransactionById,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  VALID_TXN_TYPES
};
