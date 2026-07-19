const { TABLES } = require('./sql-export');
const { ensureTablesExist } = require('../config/database');

const DESTRUCTIVE_PATTERNS = [
  /^\s*DROP\s+TABLE/i,
  /^\s*CREATE\s+TABLE/i,
  /^\s*TRUNCATE\s+TABLE/i,
  /^\s*DELETE\s+FROM/i,
  /^\s*ALTER\s+TABLE/i
];

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    // MySQL string escape: '' inside a single-quoted string is a literal quote
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && sql[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function filterMergeStatements(statements) {
  return statements.filter((statement) => {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }
    if (/^SET\s+NAMES/i.test(normalized)) return true;
    if (/^SET\s+FOREIGN_KEY_CHECKS/i.test(normalized)) return true;
    // Skip LOCK/UNLOCK — not needed for restore and can leave the session locked
    if (/^LOCK\s+TABLES/i.test(normalized)) return false;
    if (/^UNLOCK\s+TABLES/i.test(normalized)) return false;
    if (/^INSERT\s+INTO/i.test(normalized)) return true;
    return false;
  });
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Number(row.total) > 0;
}

async function clearAllTables(connection) {
  await connection.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of TABLES) {
    if (await tableExists(connection, table)) {
      await connection.query(`TRUNCATE TABLE \`${table}\``);
    }
  }
  await connection.query('SET FOREIGN_KEY_CHECKS=1');
}

async function importDatabaseSql(pool, sqlText, { freshInstall = false } = {}) {
  if (!sqlText || !String(sqlText).trim()) {
    throw new Error('SQL content is empty');
  }

  const cleaned = stripSqlComments(String(sqlText));
  let statements = splitSqlStatements(cleaned);

  if (!freshInstall) {
    statements = filterMergeStatements(statements);
  }

  if (!statements.length) {
    throw new Error('No executable SQL statements found in file');
  }

  await ensureTablesExist();

  const connection = await pool.getConnection();
  const errors = [];
  let executed = 0;
  let skipped = 0;

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');

    if (freshInstall) {
      await clearAllTables(connection);
    }

    for (const statement of statements) {
      const normalized = statement.replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      // Always ignore session lock statements from dumps
      if (/^LOCK\s+TABLES/i.test(normalized) || /^UNLOCK\s+TABLES/i.test(normalized)) {
        continue;
      }

      try {
        await connection.query(statement);
        executed++;
      } catch (error) {
        if (!freshInstall && /Duplicate entry/i.test(error.message)) {
          skipped++;
          continue;
        }
        errors.push(error.message);
      }
    }

    await connection.query('UNLOCK TABLES').catch(() => {});
    await connection.query('SET FOREIGN_KEY_CHECKS=1');

    const counts = {};
    for (const table of TABLES) {
      if (!(await tableExists(connection, table))) {
        counts[table] = 0;
        continue;
      }
      const [[{ total }]] = await connection.query(
        `SELECT COUNT(*) AS total FROM \`${table}\``
      );
      counts[table] = total;
    }

    return {
      freshInstall,
      executed,
      skipped,
      errors,
      tableCounts: counts
    };
  } finally {
    try {
      await connection.query('UNLOCK TABLES');
      await connection.query('SET FOREIGN_KEY_CHECKS=1');
    } catch (_) {
      // ignore cleanup errors
    }
    connection.release();
  }
}

module.exports = {
  clearAllTables,
  importDatabaseSql
};
