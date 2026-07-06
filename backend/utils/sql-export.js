const TABLES = [
  'sub_type_names',
  'sub_type_categories',
  'investments',
  'investment_history',
  'investment_transactions'
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
  const str = String(value);
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
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

async function exportDatabaseSql(pool) {
  const lines = [];
  const exportedAt = new Date().toISOString();

  lines.push('-- Portfolio Management SQL Export');
  lines.push(`-- Generated: ${exportedAt}`);
  lines.push('SET NAMES utf8mb4;');
  lines.push('SET FOREIGN_KEY_CHECKS=0;');
  lines.push('');

  const counts = {};

  for (const table of TABLES) {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
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
    exportedAt
  };
}

module.exports = {
  TABLES,
  exportDatabaseSql
};
