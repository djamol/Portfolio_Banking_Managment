/**
 * Request-scoped portfolio filter.
 * MySQL queries are rewritten so every read/update of portfolio-owned tables
 * stays inside the portfolios the signed-in user is allowed to see.
 * Mongo collections get the same filter on find/update/delete.
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const MARK = '/*pf-scoped*/';

const SCOPED = new Set([
  'investments',
  'investment_history',
  'investment_transactions',
  'mutual_fund_nav_history',
  'bank_accounts',
  'bank_transactions',
  'bank_category_rules',
  'bank_budgets'
]);

const CHILD_PARENT = {
  investment_history: { field: 'investment_id', parent: 'investments' },
  investment_transactions: { field: 'investment_id', parent: 'investments' },
  mutual_fund_nav_history: { field: 'investment_id', parent: 'investments' },
  bank_transactions: { field: 'account_id', parent: 'bank_accounts' }
};

/** Child rows stay on their own indexes and are limited through the parent id. */
const INDEXED_CHILD = {
  investment_history: { parent: 'investments', key: 'investment_id' },
  investment_transactions: { parent: 'investments', key: 'investment_id' },
  mutual_fund_nav_history: { parent: 'investments', key: 'investment_id' },
  bank_transactions: { parent: 'bank_accounts', key: 'account_id' }
};

const NOT_ALIAS = new Set([
  'where', 'left', 'right', 'inner', 'outer', 'cross', 'join', 'straight_join',
  'on', 'set', 'order', 'group', 'limit', 'having', 'union', 'window', 'natural',
  'using', 'force', 'use', 'ignore', 'for', 'partition', 'select', 'from',
  'and', 'or', 'as'
]);

function getScope() {
  return als.getStore() || null;
}

function runWithPortfolio(scope, fn) {
  return als.run(scope, fn);
}

function runUnrestricted(fn) {
  const prev = getScope() || {};
  return als.run({
    unrestricted: true,
    userId: prev.userId,
    role: prev.role,
    username: prev.username,
    defaultPortfolioId: prev.defaultPortfolioId
  }, fn);
}

function getWritePortfolioId() {
  const scope = getScope();
  if (!scope) return null;
  if (scope.mode === 'one' && Array.isArray(scope.ids) && scope.ids.length === 1) {
    return Number(scope.ids[0]);
  }
  if (scope.defaultPortfolioId) return Number(scope.defaultPortfolioId);
  if (Array.isArray(scope.ids) && scope.ids.length === 1) return Number(scope.ids[0]);
  return null;
}

function resolveWritablePortfolioId(explicit) {
  const scope = getScope();
  if (explicit == null || explicit === '') {
    if (!scope) return null;
    const fallback = getWritePortfolioId();
    if (!fallback) {
      const err = new Error('Create a portfolio before adding records');
      err.status = 400;
      throw err;
    }
    return fallback;
  }
  const id = Number(explicit);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Invalid portfolio');
    err.status = 400;
    throw err;
  }
  if (scope && !scope.unrestricted && Array.isArray(scope.ids) && !scope.ids.includes(id)) {
    const err = new Error('You do not have access to that portfolio');
    err.status = 400;
    throw err;
  }
  return id;
}

function countPlaceholders(sql) {
  let n = 0;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql[i] === '?') n += 1;
  }
  return n;
}

function readAlias(sql, fromIndex) {
  const match = /^\s+(?:as\s+)?`?([a-zA-Z_][\w]*)`?/i.exec(sql.slice(fromIndex));
  if (!match) return null;
  if (NOT_ALIAS.has(match[1].toLowerCase())) return null;
  return { alias: match[1], length: match[0].length };
}

function scopePredicate(table, ids) {
  if (!ids.length) return { sql: '1=0', params: [] };
  return {
    sql: `\`${table}\`.portfolio_id IN (${ids.map(() => '?').join(',')})`,
    params: ids
  };
}

function scopeMutation(sql, params, ids) {
  const match = /^\s*(?:update|delete\s+from)\s+`?([a-zA-Z_][\w]*)`?/i.exec(sql);
  if (!match || !SCOPED.has(match[1].toLowerCase())) return { sql, params };
  const pred = scopePredicate(match[1], ids);
  const where = /\bwhere\b/i.exec(sql);
  if (!where) {
    return { sql: `${sql} WHERE ${pred.sql}`, params: params.concat(pred.params) };
  }
  const at = where.index + where[0].length;
  const before = sql.slice(0, at);
  const nextParams = params.slice();
  nextParams.splice(countPlaceholders(before), 0, ...pred.params);
  return { sql: `${before} ${pred.sql} AND${sql.slice(at)}`, params: nextParams };
}

function scopeSelect(sql, params, ids) {
  const re = /\b(from|join)\s+`?([a-zA-Z_][\w]*)`?/gi;
  let out = '';
  let cursor = 0;
  let paramCursor = 0;
  const list = params.slice();
  let match = re.exec(sql);
  while (match) {
    const table = match[2];
    const tableEnd = match.index + match[0].length;
    if (!SCOPED.has(table.toLowerCase())) {
      match = re.exec(sql);
      continue;
    }
    const alias = readAlias(sql, tableEnd);
    const before = sql.slice(cursor, match.index);
    out += before;
    paramCursor += countPlaceholders(before);
    const useAlias = alias ? alias.alias : table;
    const child = INDEXED_CHILD[table.toLowerCase()];
    let replacement;
    let extraParams;
    if (child) {
      const pred = scopePredicate(child.parent, ids);
      const parentWhere = pred.sql.replace(`\`${child.parent}\`.portfolio_id`, 'portfolio_id');
      const joinAlias = `pf${match.index}`;
      replacement = `${match[1]} \`${table}\` ${useAlias} INNER JOIN (SELECT id AS pf_id FROM \`${child.parent}\` WHERE ${parentWhere}) ${joinAlias} ON ${joinAlias}.pf_id = ${useAlias}.${child.key}`;
      extraParams = pred.params;
    } else {
      const pred = scopePredicate(table, ids);
      const sub = `(SELECT * FROM \`${table}\` WHERE ${pred.sql.replace(`\`${table}\`.portfolio_id`, 'portfolio_id')})`;
      replacement = `${match[1]} ${sub} ${useAlias}`;
      extraParams = pred.params;
    }
    out += replacement;
    list.splice(paramCursor, 0, ...extraParams);
    paramCursor += extraParams.length;
    cursor = tableEnd + (alias ? alias.length : 0);
    match = re.exec(sql);
  }
  out += sql.slice(cursor);
  return { sql: out, params: list };
}

function applyPortfolioSql(sql, params, scope = getScope()) {
  if (typeof sql !== 'string') return { sql, params };
  if (sql.includes(MARK)) return { sql, params };
  if (params != null && !Array.isArray(params)) return { sql, params };
  const list = Array.isArray(params) ? params : [];
  if (!scope || scope.unrestricted) return { sql, params: list };
  const ids = (Array.isArray(scope.ids) ? scope.ids : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const head = sql.trim().slice(0, 24).toLowerCase();
  let result;
  if (head.startsWith('update') || head.startsWith('delete')) {
    result = scopeMutation(sql, list, ids);
  } else if (head.startsWith('select') || head.startsWith('with') || head.startsWith('(')) {
    result = scopeSelect(sql, list, ids);
  } else {
    return { sql, params: list };
  }
  if (result.sql !== sql) result.sql = `${MARK} ${result.sql}`;
  return result;
}

function wrapQueryFn(obj, method) {
  if (!obj || typeof obj[method] !== 'function' || obj[`__pf_${method}`]) return;
  const orig = obj[method].bind(obj);
  obj[method] = function portfolioScopedQuery(sql, values, cb) {
    if (sql && typeof sql === 'object' && typeof sql.sql === 'string') {
      const scoped = applyPortfolioSql(sql.sql, sql.values);
      return orig({ ...sql, sql: scoped.sql, values: scoped.params });
    }
    if (typeof values === 'function') {
      const scoped = applyPortfolioSql(sql, []);
      return orig(scoped.sql, scoped.params, values);
    }
    const scoped = applyPortfolioSql(sql, values);
    if (typeof cb === 'function') return orig(scoped.sql, scoped.params, cb);
    return orig(scoped.sql, scoped.params);
  };
  obj[`__pf_${method}`] = true;
}

function installMysqlPortfolioScope(pool) {
  if (!pool || pool.__pfInstalled) return pool;
  wrapQueryFn(pool, 'query');
  wrapQueryFn(pool, 'execute');
  if (typeof pool.getConnection === 'function') {
    const origGet = pool.getConnection.bind(pool);
    pool.getConnection = function getConnectionScoped(...args) {
      const result = origGet(...args);
      if (result && typeof result.then === 'function') {
        return result.then((conn) => {
          wrapQueryFn(conn, 'query');
          wrapQueryFn(conn, 'execute');
          return conn;
        });
      }
      return result;
    };
  }
  pool.__pfInstalled = true;
  return pool;
}

function mergeFilter(filter) {
  const scope = getScope();
  if (!scope || scope.unrestricted) return filter || {};
  const ids = (scope.ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  const clause = { portfolio_id: { $in: ids } };
  if (!filter || typeof filter !== 'object' || !Object.keys(filter).length) return clause;
  return { $and: [filter, clause] };
}

async function tagDoc(doc, name, getRaw) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  if (doc.portfolio_id != null && doc.portfolio_id !== '') return doc;
  const parent = CHILD_PARENT[name];
  if (parent && doc[parent.field] != null) {
    const parentCol = getRaw(parent.parent);
    const finder = parentCol.__pfFindOne || parentCol.findOne.bind(parentCol);
    const row = await finder({ id: Number(doc[parent.field]) });
    if (row && row.portfolio_id != null) {
      doc.portfolio_id = row.portfolio_id;
      return doc;
    }
  }
  const writeId = getWritePortfolioId();
  if (writeId) doc.portfolio_id = writeId;
  return doc;
}

function wrapMongoCollection(col, name, getRaw) {
  if (!col || col.__pfWrapped) return col;
  const orig = {
    find: col.find.bind(col),
    findOne: col.findOne.bind(col),
    aggregate: col.aggregate.bind(col),
    countDocuments: col.countDocuments.bind(col),
    updateOne: col.updateOne.bind(col),
    updateMany: col.updateMany.bind(col),
    deleteOne: col.deleteOne.bind(col),
    deleteMany: col.deleteMany.bind(col),
    distinct: col.distinct.bind(col),
    insertOne: col.insertOne.bind(col)
  };
  col.__pfFindOne = orig.findOne;
  col.find = (filter, options) => orig.find(mergeFilter(filter), options);
  col.findOne = (filter, options) => orig.findOne(mergeFilter(filter), options);
  col.countDocuments = (filter, options) => orig.countDocuments(mergeFilter(filter), options);
  col.distinct = (field, filter, options) => orig.distinct(field, mergeFilter(filter), options);
  col.updateOne = (filter, update, options) => orig.updateOne(mergeFilter(filter), update, options);
  col.updateMany = (filter, update, options) => orig.updateMany(mergeFilter(filter), update, options);
  col.deleteOne = (filter, options) => orig.deleteOne(mergeFilter(filter), options);
  col.deleteMany = (filter, options) => orig.deleteMany(mergeFilter(filter), options);
  col.aggregate = (pipeline, options) => {
    const scope = getScope();
    const steps = Array.isArray(pipeline) ? pipeline.slice() : pipeline;
    if (!scope || scope.unrestricted || !Array.isArray(steps)) return orig.aggregate(pipeline, options);
    const ids = (scope.ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    steps.unshift({ $match: { portfolio_id: { $in: ids } } });
    return orig.aggregate(steps, options);
  };
  col.insertOne = async (doc, options) => {
    await tagDoc(doc, name, getRaw);
    return orig.insertOne(doc, options);
  };
  col.__pfWrapped = true;
  return col;
}

function installMongoPortfolioScope(database) {
  if (!database || database.__pfInstalled) return database;
  const orig = database.collection.bind(database);
  database.collection = function portfolioCollection(name, options) {
    const col = orig(name, options);
    if (!SCOPED.has(String(name))) return col;
    return wrapMongoCollection(col, String(name), orig);
  };
  database.__pfInstalled = true;
  return database;
}

module.exports = {
  SCOPED,
  MARK,
  getScope,
  runWithPortfolio,
  runUnrestricted,
  getWritePortfolioId,
  resolveWritablePortfolioId,
  applyPortfolioSql,
  installMysqlPortfolioScope,
  installMongoPortfolioScope
};
