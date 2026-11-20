const { appendIgnorePlatformClause } = require('./ignore-platform');

function parseListParam(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseNumberParam(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBoolParam(value) {
  return value === true || value === 'true' || value === '1';
}

/**
 * Latest known amount for an investment on or before a snapshot date.
 * Returns 0 when no history exists on/before that date.
 *
 * Do NOT fall back to live investments.amount — that projects today's
 * holdings onto past snapshot dates and invents false peaks/growth.
 */
function amountAsOfSubquery(investmentAlias, asOfDateExpr) {
  return `COALESCE(
    (
      SELECT ih.amount
      FROM investment_history ih
      WHERE ih.investment_id = ${investmentAlias}.id
        AND ih.change_date <= ${asOfDateExpr}
      ORDER BY ih.change_date DESC, ih.id DESC
      LIMIT 1
    ),
    0
  )`;
}

/** History-only as-of amount (0 when no row on/before the date). Used by /delta. */
function amountAsOfHistorySubquery(investmentAlias, asOfDateExpr) {
  return `COALESCE(
    (
      SELECT ih.amount
      FROM investment_history ih
      WHERE ih.investment_id = ${investmentAlias}.id
        AND ih.change_date <= ${asOfDateExpr}
      ORDER BY ih.change_date DESC, ih.id DESC
      LIMIT 1
    ),
    0
  )`;
}

/**
 * Current portfolio amount = latest history row, else investments.amount.
 * Use for live totals (Dashboard / Analytics) so they match Investment Summary.
 */
function currentAmountSubquery(investmentAlias = 'i') {
  return `COALESCE(
    (
      SELECT ih.amount
      FROM investment_history ih
      WHERE ih.investment_id = ${investmentAlias}.id
      ORDER BY ih.change_date DESC, ih.id DESC
      LIMIT 1
    ),
    ${investmentAlias}.amount
  )`;
}

function wantsIncludeIgnored(query = {}) {
  return parseBoolParam(query.includeIgnored) || parseBoolParam(query.include_ignored);
}

/**
 * Holdings imported as replacements for a same-day zeroed aggregate
 * (e.g. "Import FD all fd added separately") must not contribute their
 * backdated history before created_at — that double-counts the old lumped row.
 */
function splitReplacementJoin(investmentAlias = 'i', replacementAlias = 'rep') {
  return `
    LEFT JOIN (
      SELECT DISTINCT child.id AS id
      FROM investments child
      INNER JOIN investment_history zh
        ON zh.amount = 0
       AND DATE(zh.change_date) = DATE(child.created_at)
       AND (
         zh.notes LIKE '%separat%'
         OR zh.notes LIKE '%added separately%'
         OR zh.notes LIKE '%all fd added%'
       )
      INNER JOIN investments parent
        ON parent.id = zh.investment_id
       AND parent.id <> child.id
       AND parent.website_app_name = child.website_app_name
    ) ${replacementAlias} ON ${replacementAlias}.id = ${investmentAlias}.id
  `;
}

function historyEffectiveDateExpr(investmentAlias = 'i', historyAlias = 'ih', replacementAlias = 'rep') {
  return `CASE
    WHEN ${replacementAlias}.id IS NOT NULL
    THEN GREATEST(${historyAlias}.change_date, DATE(${investmentAlias}.created_at))
    ELSE ${historyAlias}.change_date
  END`;
}

function buildInvestmentFilterClauses(query, params, alias = 'i') {
  const clauses = [];

  const platforms = parseListParam(query.platform);
  if (platforms.length === 1) {
    // Explicit selection wins (including platforms listed in IGNORE_PLATFORM)
    clauses.push(`${alias}.website_app_name = ?`);
    params.push(platforms[0]);
  } else if (platforms.length > 1) {
    clauses.push(`${alias}.website_app_name IN (${platforms.map(() => '?').join(', ')})`);
    params.push(...platforms);
  } else if (!wantsIncludeIgnored(query)) {
    // Default: exclude IGNORE_PLATFORM when user has not selected platforms
    appendIgnorePlatformClause(clauses, params, `${alias}.website_app_name`);
  }

  const types = parseListParam(query.type);
  if (types.length === 1) {
    clauses.push(`${alias}.investment_type = ?`);
    params.push(types[0]);
  } else if (types.length > 1) {
    clauses.push(`${alias}.investment_type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }

  const subTypes = parseListParam(query.subType);
  if (subTypes.length === 1) {
    clauses.push(`${alias}.sub_type_name = ?`);
    params.push(subTypes[0]);
  } else if (subTypes.length > 1) {
    clauses.push(`${alias}.sub_type_name IN (${subTypes.map(() => '?').join(', ')})`);
    params.push(...subTypes);
  }

  const categories = parseListParam(query.category);
  if (categories.length === 1) {
    clauses.push(`${alias}.sub_type_category = ?`);
    params.push(categories[0]);
  } else if (categories.length > 1) {
    clauses.push(`${alias}.sub_type_category IN (${categories.map(() => '?').join(', ')})`);
    params.push(...categories);
  }

  return clauses;
}

function buildAmountFilterClauses(query, params, amountExpr) {
  const clauses = [];
  const minAmount = parseNumberParam(query.minAmount);
  const maxAmount = parseNumberParam(query.maxAmount);

  if (minAmount !== null) {
    clauses.push(`${amountExpr} >= ?`);
    params.push(minAmount);
  }
  if (maxAmount !== null) {
    clauses.push(`${amountExpr} <= ?`);
    params.push(maxAmount);
  }
  if (parseBoolParam(query.ignoreZero)) {
    clauses.push(`${amountExpr} <> 0`);
  }

  return clauses;
}

function parseAnalyticsFilters(query) {
  return {
    from: query.from || null,
    to: query.to || null,
    platforms: parseListParam(query.platform),
    types: parseListParam(query.type),
    subTypes: parseListParam(query.subType),
    categories: parseListParam(query.category),
    minAmount: parseNumberParam(query.minAmount),
    maxAmount: parseNumberParam(query.maxAmount),
    ignoreZero: parseBoolParam(query.ignoreZero)
  };
}

function resolveSeriesBreakdown(query) {
  const raw = query && query.breakdown != null ? String(query.breakdown).trim() : '';
  // Asset tracker asks for a single portfolio total even when platforms are filtered.
  if (raw === 'none' || raw === 'false' || raw === '0') return null;

  const explicit = {
    platform: { breakdown: 'platform', seriesExpr: 'i.website_app_name' },
    type: { breakdown: 'type', seriesExpr: 'i.investment_type' },
    subType: { breakdown: 'subType', seriesExpr: 'i.sub_type_name' },
    category: { breakdown: 'category', seriesExpr: 'i.sub_type_category' },
    website_app_name: { breakdown: 'platform', seriesExpr: 'i.website_app_name' },
    investment_type: { breakdown: 'type', seriesExpr: 'i.investment_type' },
    sub_type_name: { breakdown: 'subType', seriesExpr: 'i.sub_type_name' },
    sub_type_category: { breakdown: 'category', seriesExpr: 'i.sub_type_category' }
  };
  if (raw && explicit[raw]) return explicit[raw];

  const platforms = parseListParam(query.platform);
  const types = parseListParam(query.type);
  const subTypes = parseListParam(query.subType);
  const categories = parseListParam(query.category);

  const candidates = [];
  if (types.length) {
    candidates.push({ breakdown: 'type', seriesExpr: 'i.investment_type' });
  }
  if (subTypes.length) {
    candidates.push({ breakdown: 'subType', seriesExpr: 'i.sub_type_name' });
  }
  if (categories.length) {
    candidates.push({ breakdown: 'category', seriesExpr: 'i.sub_type_category' });
  }
  if (platforms.length) {
    candidates.push({ breakdown: 'platform', seriesExpr: 'i.website_app_name' });
  }

  return candidates.length === 1 ? candidates[0] : null;
}

module.exports = {
  parseListParam,
  parseNumberParam,
  parseBoolParam,
  parseAnalyticsFilters,
  resolveSeriesBreakdown,
  amountAsOfSubquery,
  amountAsOfHistorySubquery,
  currentAmountSubquery,
  buildInvestmentFilterClauses,
  buildAmountFilterClauses,
  wantsIncludeIgnored,
  splitReplacementJoin,
  historyEffectiveDateExpr
};
