const { isMongoDb, getPool } = require('../config/index');
const mongoStore = require('../db/mongo-store');

const TABLES = [
  'sub_type_names',
  'sub_type_categories',
  'investments',
  'investment_history',
  'investment_transactions',
  'bank_accounts',
  'bank_transactions'
];

function escapeSqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'object' && value.$date) {
    return `'${String(value.$date).slice(0, 19).replace('T', ' ')}'`;
  }
  const str = String(value);
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function normalizeRowForSql(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id') continue;
    if (value instanceof Date) {
      out[key] = value;
    } else if (value && typeof value === 'object' && value.$date) {
      out[key] = new Date(value.$date);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function buildInsertStatement(table, rows) {
  if (!rows.length) {
    return `-- No data for table \`${table}\`\n`;
  }

  const columns = Object.keys(rows[0]);
  const columnList = columns.map((c) => `\`${c}\``).join(', ');
  const valueGroups = rows.map((row) => {
    const values = columns.map((col) => escapeSqlValue(row[col]));
    return `(${values.join(', ')})`;
  });

  const chunks = [];
  const batchSize = 100;
  for (let i = 0; i < valueGroups.length; i += batchSize) {
    const batch = valueGroups.slice(i, i + batchSize);
    chunks.push(`INSERT INTO \`${table}\` (${columnList}) VALUES\n${batch.join(',\n')};`);
  }

  return chunks.join('\n\n') + '\n';
}

async function fetchMysqlRows(pool, table) {
  const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
  return rows;
}

async function fetchMongoRows(table) {
  const rows = await mongoStore.getCollectionData(table);
  return rows.map(normalizeRowForSql);
}

async function exportDatabaseSql(pool) {
  const lines = [];
  const exportedAt = new Date().toISOString();
  const source = isMongoDb() ? 'mongodb' : 'mysql';

  lines.push('-- Portfolio Management SQL Export');
  lines.push(`-- Generated: ${exportedAt}`);
  lines.push(`-- Source: ${source}`);
  lines.push('SET NAMES utf8mb4;');
  lines.push('SET FOREIGN_KEY_CHECKS=0;');
  lines.push('');

  const counts = {};
  const activePool = isMongoDb() ? null : (pool || getPool());

  for (const table of TABLES) {
    const rows = isMongoDb()
      ? await fetchMongoRows(table)
      : await fetchMysqlRows(activePool, table);

    counts[table] = rows.length;
    lines.push(`-- Table: ${table} (${rows.length} rows)`);
    lines.push(`LOCK TABLES \`${table}\` WRITE;`);
    lines.push(buildInsertStatement(table, rows).trimEnd());
    lines.push('UNLOCK TABLES;');
    lines.push('');
  }

  lines.push('SET FOREIGN_KEY_CHECKS=1;');
  lines.push('');

  return {
    sql: lines.join('\n'),
    counts,
    exportedAt,
    source
  };
}

module.exports = {
  TABLES,
  exportDatabaseSql
};
