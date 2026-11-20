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
  const re = /\b(?:from|join)\s+\(*\s*(?:`([^`]+)`|([A-Za-z_][\w]*))(?:\s*\.\s*(?:`([^`]+)`|([A-Za-z_][\w]*)))?/gi;
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
        if (!candidateMatchesRole(key, cols)) continue;
        let score = scoreWritableCandidate(key, viewCols, cols);
        if (wantsLookupTable(key) && candidates[0] && candidate.toLowerCase() === String(candidates[0]).toLowerCase()) {
          score += 200;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { name: candidate, cols };
        }
      }
      if (wantsHoldingTable(key) && (!best || !isHoldingTable(best.cols))) {
        const discovered = await findHoldingTables(query);
        for (const candidate of discovered) {
          if (candidates.some((item) => item.toLowerCase() === candidate.toLowerCase())) continue;
          const cols = await columnSet(query, candidate);
          if (!isHoldingTable(cols)) continue;
          const score = scoreWritableCandidate(key, viewCols, cols);
          if (score > bestScore) {
            bestScore = score;
            best = { name: candidate, cols };
          }
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

function wantsHoldingTable(name) {
  return String(name || '').toLowerCase() === 'investments';
}

function wantsLookupTable(name) {
  const key = String(name || '').toLowerCase();
  return key.includes('sub_type') || key.includes('categor');
}

function isHoldingTable(cols) {
  return cols.has('id')
    && cols.has('amount')
    && cols.has('investment_date')
    && (cols.has('website_app_name') || cols.has('platform_id'));
}

function candidateMatchesRole(viewName, cols) {
  if (wantsHoldingTable(viewName)) return isHoldingTable(cols);
  if (wantsLookupTable(viewName)) return !isHoldingTable(cols);
  if (String(viewName || '').toLowerCase() === 'investment_history' && isHoldingTable(cols)) return false;
  return true;
}

function scoreWritableCandidate(viewName, viewCols, cols) {
  let score = 0;
  for (const field of viewCols) if (cols.has(field)) score += 1;
  if (isHoldingTable(cols) && wantsHoldingTable(viewName)) score += 500;
  if (cols.has('website_app_name')) score += 100;
  if (cols.has('investment_type') || cols.has('investment_type_id')) score += 50;
  if (cols.has('name') && wantsLookupTable(viewName)) score += 80;
  if (cols.has('category') && wantsLookupTable(viewName)) score += 80;
  return score;
}

async function findHoldingTables(query) {
  const [rows] = await query(
    `SELECT c.TABLE_NAME AS table_name
     FROM information_schema.COLUMNS c
     INNER JOIN information_schema.TABLES t
       ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
     WHERE c.TABLE_SCHEMA = DATABASE()
       AND c.COLUMN_NAME IN ('id', 'amount', 'investment_date', 'website_app_name', 'platform_id')
     GROUP BY c.TABLE_NAME
     HAVING SUM(c.COLUMN_NAME IN ('id', 'amount', 'investment_date')) = 3
        AND SUM(c.COLUMN_NAME IN ('website_app_name', 'platform_id')) >= 1`
  );
  return (rows || [])
    .map((row) => row.table_name)
    .filter((name) => !/history|backup|legacy|temp|_log/i.test(String(name)));
}

function mutationColumns(sql) {
  const insert = /insert\s+into\s+`?[A-Za-z_][\w]*`?\s*\(([^)]+)\)/i.exec(sql);
  if (insert) {
    return insert[1].split(',').map((part) => part.replace(/`/g, '').trim()).filter(Boolean);
  }
  const update = /update\s+`?[A-Za-z_][\w]*`?\s+set\s+([\s\S]+?)\s+where\s+/i.exec(sql);
  if (!update) return [];
  return [...update[1].matchAll(/`?([A-Za-z_][\w]*)`?\s*=/g)].map((match) => match[1]);
}

async function rewriteMutationTarget(poolOrQuery, sql) {
  if (typeof sql !== 'string') return sql;
  const match = /^\s*(?:update|insert\s+into|delete\s+from)\s+`?([A-Za-z_][\w]*)`?/i.exec(sql);
  if (!match) return sql;
  const target = await resolveWritableTable(poolOrQuery, match[1]);
  if (target.toLowerCase() === match[1].toLowerCase()) return sql;
  const query = asQuery(poolOrQuery);
  const used = mutationColumns(sql);
  if (used.length) {
    const cols = await columnSet(query, target);
    if (used.some((column) => !cols.has(column))) return sql;
  }
  return retargetMutationSql(sql, match[1], target);
}

const LABEL_COLUMNS = new Set([
  'name', 'label', 'title', 'category', 'type', 'type_name',
  'investment_type', 'sub_type_name', 'sub_type_category',
  'website_app_name', 'platform', 'platform_name',
  'scheme_code', 'scheme_name'
]);

/** View/API names that fill a base-table id column. */
const ID_LABELS = {
  platform_id: ['website_app_name', 'platform', 'platform_name'],
  investment_type_id: ['investment_type'],
  sub_type_id: ['sub_type_name', 'sub_type'],
  sub_type_name_id: ['sub_type_name'],
  category_id: ['sub_type_category', 'category'],
  scheme_id: ['mutual_fund_scheme_code', 'scheme_code', 'mutual_fund_scheme_name', 'scheme_name']
};

const CREATE_MISSING_IDS = new Set(['platform_id', 'sub_type_id', 'sub_type_name_id', 'category_id']);
const ID_ORDER = ['investment_type_id', 'platform_id', 'sub_type_id', 'sub_type_name_id', 'category_id', 'scheme_id'];

function labelForIdColumn(field, values) {
  const keys = ID_LABELS[field] || [String(field).slice(0, -3)];
  for (const key of keys) {
    if (values[key] != null && String(values[key]).trim() !== '') {
      return { key, label: String(values[key]).trim() };
    }
  }
  return null;
}

const lookupIdCache = new Map();
const columnMetaCache = new Map();
let textColumnCache = null;

function quoteIdent(name) {
  const clean = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) {
    throw new Error(`Invalid SQL identifier: ${clean}`);
  }
  return `\`${clean}\``;
}

function isGenerated(extra) {
  return /generated/i.test(String(extra || ''));
}

function isRequiredColumn(col) {
  return String(col.Null).toUpperCase() === 'NO'
    && (col.Default === null || col.Default === undefined)
    && !/auto_increment/i.test(String(col.Extra || ''));
}

async function showColumns(query, table) {
  const key = String(table).toLowerCase();
  if (columnMetaCache.has(key)) return columnMetaCache.get(key);
  const [rows] = await query(`SHOW COLUMNS FROM ${quoteIdent(table)}`);
  const cols = rows || [];
  columnMetaCache.set(key, cols);
  return cols;
}

function rankLookup(table, column, stem) {
  const t = String(table).toLowerCase().replace(/_/g, '');
  const c = String(column).toLowerCase();
  const s = String(stem).toLowerCase().replace(/_/g, '');
  let rank = 0;
  if (t === s || t === `${s}s` || t === `${s}es`) rank += 100;
  else if (s && t.includes(s)) rank += 40;
  if (c === String(stem).toLowerCase()) rank += 30;
  else if (c === 'name' || c === 'label' || c === 'title') rank += 20;
  else if (c === 'category' || c === 'type' || c === 'type_name') rank += 10;
  return rank;
}

async function selectLookupId(query, table, idCol, labelCol, label, investmentType, cols, typeId) {
  const hasTypeId = (cols || []).some((col) => col.Field === 'investment_type_id');
  if (hasTypeId && typeId != null && labelCol !== 'investment_type_id') {
    const [narrow] = await query(
      `SELECT ${quoteIdent(idCol)} AS id FROM ${quoteIdent(table)} WHERE ${quoteIdent(labelCol)} = ? AND investment_type_id = ? LIMIT 3`,
      [label, typeId]
    );
    return (narrow || []).map((row) => row.id);
  }
  const hasType = (cols || []).some((col) => col.Field === 'investment_type');
  if (hasType && investmentType && labelCol !== 'investment_type') {
    const [narrow] = await query(
      `SELECT ${quoteIdent(idCol)} AS id FROM ${quoteIdent(table)} WHERE ${quoteIdent(labelCol)} = ? AND investment_type = ? LIMIT 3`,
      [label, investmentType]
    );
    if (narrow && narrow.length) return narrow.map((row) => row.id);
  }
  const [rows] = await query(
    `SELECT ${quoteIdent(idCol)} AS id FROM ${quoteIdent(table)} WHERE ${quoteIdent(labelCol)} = ? LIMIT 3`,
    [label]
  );
  return (rows || []).map((row) => row.id);
}

function preferredLabelColumn(sourceKey) {
  if (sourceKey === 'mutual_fund_scheme_code' || sourceKey === 'scheme_code') return 'scheme_code';
  if (sourceKey === 'mutual_fund_scheme_name' || sourceKey === 'scheme_name') return 'scheme_name';
  return 'name';
}

async function createLookupRow(query, refTable, labelColumn, label, typeId, cols) {
  const row = { [labelColumn]: label };
  if ((cols || []).some((col) => col.Field === 'investment_type_id') && typeId != null) {
    row.investment_type_id = typeId;
  }
  if ((cols || []).some((col) => col.Field === 'is_listed')) row.is_listed = 1;
  const fields = Object.keys(row).filter((field) => (cols || []).some((col) => col.Field === field));
  try {
    const [result] = await query(
      `INSERT INTO ${quoteIdent(refTable)} (${fields.map(quoteIdent).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      fields.map((field) => row[field])
    );
    return result.insertId;
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      const ids = await selectLookupId(query, refTable, 'id', labelColumn, label, null, cols, typeId);
      if (ids.length >= 1) return ids[0];
    }
    throw error;
  }
}

/** undefined = no foreign key; null = foreign key exists but the label is not in it. */
async function foreignLookup(query, table, column, label, investmentType) {
  let rows;
  try {
    [rows] = await query(
      `SELECT REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL
       LIMIT 1`,
      [table, column]
    );
  } catch (err) {
    return undefined;
  }
  const fk = rows && rows[0];
  if (!fk || !fk.ref_table) return undefined;
  const stem = String(column).replace(/_id$/, '');
  const cols = await showColumns(query, fk.ref_table);
  const textCols = cols
    .filter((col) => /char|text|enum/i.test(String(col.Type || '')) && LABEL_COLUMNS.has(String(col.Field).toLowerCase()))
    .sort((a, b) => rankLookup(fk.ref_table, b.Field, stem) - rankLookup(fk.ref_table, a.Field, stem));
  for (const col of textCols) {
    const found = await selectLookupId(query, fk.ref_table, fk.ref_col || 'id', col.Field, label, investmentType, cols);
    if (found.length === 1) return found[0];
  }
  return null;
}

async function textColumns(query) {
  if (textColumnCache) return textColumnCache;
  const [rows] = await query(
    `SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS c
     INNER JOIN information_schema.COLUMNS i
       ON i.TABLE_SCHEMA = c.TABLE_SCHEMA AND i.TABLE_NAME = c.TABLE_NAME AND i.COLUMN_NAME = 'id'
     INNER JOIN information_schema.TABLES t
       ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
     WHERE c.TABLE_SCHEMA = DATABASE()
       AND c.DATA_TYPE IN ('varchar', 'char', 'enum', 'text', 'tinytext')`
  );
  textColumnCache = rows || [];
  return textColumnCache;
}

async function scanLookup(query, table, stem, label, investmentType) {
  const cols = await textColumns(query);
  const ranked = [];
  for (const col of cols) {
    if (String(col.table_name).toLowerCase() === String(table).toLowerCase()) continue;
    if (!LABEL_COLUMNS.has(String(col.column_name).toLowerCase())) continue;
    const rank = rankLookup(col.table_name, col.column_name, stem);
    if (rank >= 30) ranked.push({ ...col, rank });
  }
  ranked.sort((a, b) => b.rank - a.rank);
  for (const col of ranked) {
    const meta = await showColumns(query, col.table_name);
    const ids = await selectLookupId(query, col.table_name, 'id', col.column_name, label, investmentType, meta);
    if (ids.length === 1) return ids[0];
  }
  return null;
}

/** When the base table uses different column names than the view/API payload. */
const REQUIRED_TEXT_ALIASES = {
  name: ['category', 'sub_type_category', 'sub_type_name', 'mutual_fund_scheme_name', 'website_app_name', 'label', 'title'],
  label: ['name', 'sub_type_category', 'sub_type_name', 'website_app_name'],
  title: ['name', 'sub_type_category', 'sub_type_name', 'website_app_name'],
  scrip_name: ['sub_type_category', 'name', 'mutual_fund_scheme_name'],
  security_name: ['sub_type_category', 'name', 'mutual_fund_scheme_name'],
  instrument_name: ['sub_type_category', 'name', 'mutual_fund_scheme_name']
};

function fillRequiredTextColumns(cols, values, forInsert) {
  if (!forInsert) return values;
  const next = { ...values };
  for (const col of cols) {
    const field = String(col.Field);
    if (field === 'id' || field.endsWith('_id')) continue;
    if (isGenerated(col.Extra) || /auto_increment/i.test(String(col.Extra || ''))) continue;
    if (!isRequiredColumn(col)) continue;
    if (next[field] != null && String(next[field]).trim() !== '') continue;

    const aliases = REQUIRED_TEXT_ALIASES[field.toLowerCase()] || [];
    let filled = false;
    for (const alias of aliases) {
      if (next[alias] != null && String(next[alias]).trim() !== '') {
        next[field] = next[alias];
        filled = true;
        break;
      }
    }
    if (!filled) {
      throw new Error(
        `Cannot save investment: Field '${field}' doesn't have a default value`
      );
    }
  }
  return next;
}

async function lookupOrCreateId(query, ownerTable, idField, source, investmentType, typeId, forInsert) {
  let fkRows;
  try {
    [fkRows] = await query(
      `SELECT REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL
       LIMIT 1`,
      [ownerTable, idField]
    );
  } catch (err) {
    fkRows = [];
  }
  const fk = fkRows && fkRows[0];
  if (fk && fk.ref_table) {
    const refCols = await showColumns(query, fk.ref_table);
    const preferred = preferredLabelColumn(source.key);
    const labelColumn = refCols.some((col) => col.Field === preferred)
      ? preferred
      : (refCols.some((col) => col.Field === 'name') ? 'name' : null);
    if (!labelColumn) return null;
    const ids = await selectLookupId(
      query, fk.ref_table, fk.ref_col || 'id', labelColumn, source.label, investmentType, refCols, typeId
    );
    if (ids.length === 1) return ids[0];
    if (forInsert && CREATE_MISSING_IDS.has(idField)) {
      return createLookupRow(query, fk.ref_table, labelColumn, source.label, typeId, refCols);
    }
    return null;
  }
  return scanLookup(query, ownerTable, String(idField).replace(/_id$/, ''), source.label, investmentType);
}

/**
 * The writable base table behind the investments view stores lookup ids
 * (investment_type_id and similar) that the view exposes as names.
 * Fill those ids from the name fields before INSERT/UPDATE.
 * Also copy display names into required text columns (e.g. `name`).
 */
async function completeLookupIds(poolOrQuery, table, values, forInsert) {
  const query = asQuery(poolOrQuery);
  const cols = await showColumns(query, table);
  const colNames = new Set(cols.map((col) => col.Field));
  let next = { ...values };
  // Lookup tables store the label in `name` while the API calls it `category`.
  if ((next.name == null || next.name === '') && next.category != null && !colNames.has('category') && colNames.has('name')) {
    next.name = next.category;
  }
  const idColumns = cols
    .filter((col) => String(col.Field).endsWith('_id') && !/auto_increment/i.test(String(col.Extra || '')))
    .sort((a, b) => {
      const ai = ID_ORDER.indexOf(a.Field);
      const bi = ID_ORDER.indexOf(b.Field);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  for (const col of idColumns) {
    if (next[col.Field] != null && next[col.Field] !== '') continue;
    const stem = String(col.Field).slice(0, -3);
    const source = labelForIdColumn(col.Field, next);
    const required = isRequiredColumn(col);
    if (!source) {
      if (forInsert && required) {
        throw new Error(`Cannot save investment: ${col.Field} is required`);
      }
      continue;
    }
    const typeId = next.investment_type_id != null ? Number(next.investment_type_id) : null;
    const cacheKey = `${table}\0${col.Field}\0${source.label}\0${typeId || next.investment_type || ''}`;
    let id = lookupIdCache.has(cacheKey) ? lookupIdCache.get(cacheKey) : undefined;
    if (id === undefined) {
      id = await lookupOrCreateId(query, table, col.Field, source, next.investment_type, typeId, forInsert);
      if (id != null) lookupIdCache.set(cacheKey, id);
    }
    if (id == null) {
      if (forInsert && required) {
        throw new Error(`Cannot save investment: no ${stem.replace(/_/g, ' ')} match for "${source.label}"`);
      }
      continue;
    }
    next[col.Field] = id;
  }
  next = fillRequiredTextColumns(cols, next, forInsert);
  for (const col of cols) {
    if (isGenerated(col.Extra)) delete next[col.Field];
  }
  return next;
}

async function findDuplicateId(poolOrQuery, table, prepared, error) {
  if (!error || error.code !== 'ER_DUP_ENTRY') return null;
  const match = /for key '([^']+)'/i.exec(error.message || '');
  if (!match) return null;
  const indexName = match[1].split('.').pop();
  const query = asQuery(poolOrQuery);
  const [stats] = await query(
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     ORDER BY SEQ_IN_INDEX`,
    [table, indexName]
  );
  if (!stats || !stats.length) return null;
  const where = [];
  const params = [];
  for (const col of stats) {
    const field = col.column_name;
    if (prepared[field] === undefined) return null;
    where.push(`${quoteIdent(field)} = ?`);
    params.push(prepared[field]);
  }
  const [rows] = await query(
    `SELECT id FROM ${quoteIdent(table)} WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  return rows && rows[0] ? rows[0].id : null;
}

module.exports = {
  setScopeRegistrar,
  referencedTables,
  retargetMutationSql,
  resolveWritableTable,
  rewriteMutationTarget,
  completeLookupIds,
  findDuplicateId
};
