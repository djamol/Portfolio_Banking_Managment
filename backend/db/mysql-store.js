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

  if (oldInvestment[0].amount !== data.amount) {
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
  deleteCategory,
  findInvestmentByKey,
  upsertImportedInvestment
};
