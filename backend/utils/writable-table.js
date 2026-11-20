/**
 * Production databases sometimes expose `investments` as a join view.
 * MariaDB/MySQL reject INSERT, UPDATE, and DELETE on that view
 * ("Can not modify more than one base table through a join view").
 * Writes are sent to the single base table that owns the row.
 */

const cache = new Map();
let scopeRegistrar = null;

function setScopeRegistrar(fn) {
  scopeRegistrar = typeof fn === 'function' ? fn : null;
}

function asQuery(poolOrQuery) {
  if (typeof poolOrQuery === 'function') return poolOrQuery;
  return (sql, params) => poolOrQuery.query(sql, params);
}

function referencedTables(definition) {
  const names = [];
  const re = /\b(?:from|join)\s+\(?\s*(?:`([^`]+)`|([A-Za-z_][\w]*))(?:\s*\.\s*(?:`([^`]+)`|([A-Za-z_][\w]*)))?/gi;
  let match = re.exec(definition);
  while (match) {
    const raw = match[3] || match[4] || match[1] || match[2];
    if (raw && !/^(select|where|on|left|right|inner|outer|cross|join)$/i.test(raw) && !names.includes(raw)) {
      names.push(raw);
    }
    match = re.exec(definition);
  }
  return names;
}

/** Replace only the mutation target. Reads stay on the view. */
function retargetMutationSql(sql, fromTable, toTable) {
  if (!sql || !fromTable || !toTable || fromTable.toLowerCase() === toTable.toLowerCase()) return sql;
  return sql.replace(
    new RegExp(`^(\\s*(?:update|insert\\s+into|delete\\s+from)\\s+)\`?${fromTable}\`?`, 'i'),
    `$1\`${toTable}\``
  );
}

async function viewDefinition(query, table) {
  try {
    const [rows] = await query(`SHOW CREATE VIEW \`${table}\``);
    const row = rows && rows[0];
    if (!row) return '';
    const definition = row['Create View'] || row['CREATE VIEW'] || '';
    if (definition) return definition;
  } catch (err) {
    /* SHOW CREATE can be denied; information_schema is the fallback. */
  }
  try {
    const [rows] = await query(
      `SELECT VIEW_DEFINITION AS def
       FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    return rows && rows[0] ? String(rows[0].def || '') : '';
  } catch (err) {
    return '';
  }
}

async function tableType(query, table) {
  const [rows] = await query(
    `SELECT TABLE_TYPE AS table_type
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows && rows[0] ? String(rows[0].table_type || '').toUpperCase() : '';
}

async function columnSet(query, table) {
  const [rows] = await query(`SHOW COLUMNS FROM \`${table}\``);
  return new Set((rows || []).map((row) => row.Field));
}

async function resolveWritableTable(poolOrQuery, table) {
  const name = String(table || '').replace(/`/g, '');
  if (!name) return table;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key).target;

  const query = asQuery(poolOrQuery);
  let target = name;
  try {
    const type = await tableType(query, name);
    if (type === 'VIEW') {
      const definition = await viewDefinition(query, name);
      const candidates = referencedTables(definition).filter((item) => item.toLowerCase() !== key);
      const viewCols = await columnSet(query, name);
      let best = null;
      let bestScore = -1;
      for (const candidate of candidates) {
        const candidateType = await tableType(query, candidate);
        if (candidateType !== 'BASE TABLE') continue;
        const cols = await columnSet(query, candidate);
        if (!cols.has('id')) continue;
        let score = 0;
        for (const field of viewCols) if (cols.has(field)) score += 1;
        if (cols.has('website_app_name')) score += 100;
        if (cols.has('investment_type')) score += 50;
        if (score > bestScore) {
          bestScore = score;
          best = { name: candidate, cols };
        }
      }
      if (best) {
        target = best.name;
        if (best.cols.has('portfolio_id') && scopeRegistrar) scopeRegistrar(target);
      }
    }
  } catch (err) {
    target = name;
  }

  cache.set(key, { target });
  if (target.toLowerCase() !== key) cache.set(target.toLowerCase(), { target });
  return target;
}

async function rewriteMutationTarget(poolOrQuery, sql) {
  if (typeof sql !== 'string') return sql;
  const match = /^\s*(?:update|insert\s+into|delete\s+from)\s+`?([A-Za-z_][\w]*)`?/i.exec(sql);
  if (!match) return sql;
  const target = await resolveWritableTable(poolOrQuery, match[1]);
  return retargetMutationSql(sql, match[1], target);
}

module.exports = {
  setScopeRegistrar,
  referencedTables,
  retargetMutationSql,
  resolveWritableTable,
  rewriteMutationTarget
};
