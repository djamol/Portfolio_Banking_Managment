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
    ${investmentAlias}.amount
  )`;
}

function buildInvestmentFilterClauses(query, params, alias = 'i') {
  const clauses = [];

  const platforms = parseListParam(query.platform);
  if (platforms.length === 1) {
    clauses.push(`${alias}.website_app_name = ?`);
    params.push(platforms[0]);
  } else if (platforms.length > 1) {
    clauses.push(`${alias}.website_app_name IN (${platforms.map(() => '?').join(', ')})`);
    params.push(...platforms);
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
  buildInvestmentFilterClauses,
  buildAmountFilterClauses
};
