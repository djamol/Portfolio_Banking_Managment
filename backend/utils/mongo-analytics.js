const { getDb } = require('../config/mongodb');
const {
  parseListParam,
  parseNumberParam,
  buildInvestmentFilterClauses: buildSqlInvestmentFilterClauses
} = require('./snapshot-queries');
const { isIgnoredPlatform } = require('./ignore-platform');

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    // Use local calendar day so IST midnight is not shifted back via toISOString().
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return s.slice(0, 10);
}

function withoutIgnoredPlatforms(investments) {
  return investments.filter((i) => !isIgnoredPlatform(i.website_app_name));
}

function matchesFilters(investment, query) {
  const platforms = parseListParam(query.platform);
  if (platforms.length) {
    if (!platforms.includes(investment.website_app_name)) return false;
  } else if (isIgnoredPlatform(investment.website_app_name)) {
    return false;
  }

  const types = parseListParam(query.type);
  if (types.length && !types.includes(investment.investment_type)) return false;

  const subTypes = parseListParam(query.subType);
  if (subTypes.length && !subTypes.includes(investment.sub_type_name)) return false;

  const categories = parseListParam(query.category);
  if (categories.length && !categories.includes(investment.sub_type_category)) return false;

  const minAmount = parseNumberParam(query.minAmount);
  const maxAmount = parseNumberParam(query.maxAmount);
  const amount = Number(investment.amount) || 0;
  if (minAmount != null && amount < minAmount) return false;
  if (maxAmount != null && amount > maxAmount) return false;

  return true;
}

/**
 * Latest known history amount on/before date.
 * Returns 0 when none — never falls back to live investments.amount
 * (that would project today's holdings onto past snapshot dates).
 */
function amountAsOf(investmentId, asOfDate, historyRows, _investmentsById) {
  return amountAsOfHistoryOnly(investmentId, asOfDate, historyRows);
}

/** Last history amount on/before date; 0 if none (no live-amount fallback). */
function amountAsOfHistoryOnly(investmentId, asOfDate, historyRows) {
  const asOf = toDateString(asOfDate);
  const relevant = historyRows
    .filter((h) => h.investment_id === investmentId && toDateString(h.change_date) <= asOf)
    .sort((a, b) => {
      const dateCmp = toDateString(b.change_date).localeCompare(toDateString(a.change_date));
      if (dateCmp !== 0) return dateCmp;
      return (b.id || 0) - (a.id || 0);
    });
  return relevant.length ? Number(relevant[0].amount) : 0;
}

function groupBy(rows, keyFn, aggFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([key, items]) => aggFn(key, items));
}

async function loadCoreData() {
  const db = getDb();
  const [investments, history, transactions] = await Promise.all([
    db.collection('investments').find({}).toArray(),
    db.collection('investment_history').find({}).toArray(),
    db.collection('investment_transactions').find({}).toArray()
  ]);
  const investmentsById = Object.fromEntries(investments.map((i) => [i.id, i]));
  return { investments, history, transactions, investmentsById };
}

async function getTotal() {
  const { investments } = await loadCoreData();
  const visible = withoutIgnoredPlatforms(investments);
  const total_amount = visible.reduce((sum, i) => sum + Number(i.amount), 0);
  return { total_amount, total_investments: visible.length };
}

async function getByType() {
  const { investments } = await loadCoreData();
  return groupBy(
    withoutIgnoredPlatforms(investments),
    (i) => i.investment_type,
    (type, items) => ({
      investment_type: type,
      count: items.length,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0),
      avg_amount: items.length ? items.reduce((s, i) => s + Number(i.amount), 0) / items.length : 0
    })
  ).sort((a, b) => b.total_amount - a.total_amount);
}

async function getByMonth() {
  const { investments } = await loadCoreData();
  return groupBy(
    withoutIgnoredPlatforms(investments),
    (i) => toDateString(i.investment_date).slice(0, 7),
    (month, items) => ({
      month,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0),
      count: items.length
    })
  ).sort((a, b) => b.month.localeCompare(a.month));
}

async function getByYear() {
  const { investments } = await loadCoreData();
  return groupBy(
    withoutIgnoredPlatforms(investments),
    (i) => Number(toDateString(i.investment_date).slice(0, 4)),
    (year, items) => ({
      year,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0),
      count: items.length
    })
  ).sort((a, b) => b.year - a.year);
}

async function getMonthlyChanges() {
  const { history, investmentsById } = await loadCoreData();
  const visibleHistory = history.filter((h) => {
    const inv = investmentsById[h.investment_id];
    return inv && !isIgnoredPlatform(inv.website_app_name);
  });
  const grouped = groupBy(
    visibleHistory,
    (h) => toDateString(h.change_date).slice(0, 7),
    (month, items) => ({
      month,
      added: items.filter((h) => h.change_type === 'added').reduce((s, h) => s + Number(h.amount), 0),
      removed: items.filter((h) => h.change_type === 'removed').reduce((s, h) => s + Number(h.amount), 0),
      updated: items.filter((h) => h.change_type === 'updated').reduce((s, h) => s + Number(h.amount), 0)
    })
  );
  return grouped.sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
}

async function getYearlyChanges() {
  const { history, investmentsById } = await loadCoreData();
  const visibleHistory = history.filter((h) => {
    const inv = investmentsById[h.investment_id];
    return inv && !isIgnoredPlatform(inv.website_app_name);
  });
  return groupBy(
    visibleHistory,
    (h) => Number(toDateString(h.change_date).slice(0, 4)),
    (year, items) => ({
      year,
      added: items.filter((h) => h.change_type === 'added').reduce((s, h) => s + Number(h.amount), 0),
      removed: items.filter((h) => h.change_type === 'removed').reduce((s, h) => s + Number(h.amount), 0),
      updated: items.filter((h) => h.change_type === 'updated').reduce((s, h) => s + Number(h.amount), 0)
    })
  ).sort((a, b) => b.year - a.year);
}

async function getByPlatform() {
  const { investments } = await loadCoreData();
  return groupBy(
    withoutIgnoredPlatforms(investments),
    (i) => i.website_app_name,
    (platform, items) => ({
      website_app_name: platform,
      count: items.length,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0)
    })
  ).sort((a, b) => b.total_amount - a.total_amount);
}

async function getBySubTypeName() {
  const { investments } = await loadCoreData();
  const filtered = withoutIgnoredPlatforms(investments).filter((i) => i.sub_type_name);
  return groupBy(
    filtered,
    (i) => i.sub_type_name,
    (name, items) => ({
      sub_type_name: name,
      count: items.length,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0)
    })
  ).sort((a, b) => b.total_amount - a.total_amount);
}

async function getBySubTypeCategory() {
  const { investments } = await loadCoreData();
  const filtered = withoutIgnoredPlatforms(investments).filter((i) => i.sub_type_category);
  return groupBy(
    filtered,
    (i) => i.sub_type_category,
    (category, items) => ({
      sub_type_category: category,
      count: items.length,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0)
    })
  ).sort((a, b) => b.total_amount - a.total_amount);
}

async function getGrowth() {
  const { investments } = await loadCoreData();
  const byMonth = groupBy(
    withoutIgnoredPlatforms(investments),
    (i) => toDateString(i.investment_date).slice(0, 7),
    (month, items) => ({
      month,
      total_amount: items.reduce((s, i) => s + Number(i.amount), 0)
    })
  ).sort((a, b) => a.month.localeCompare(b.month));

  let cumulative = 0;
  return byMonth.map((row) => {
    cumulative += row.total_amount;
    return { month: row.month, cumulative_amount: cumulative };
  });
}

async function getCashflowsByMonth() {
  const { transactions } = await loadCoreData();
  return groupBy(
    transactions,
    (t) => toDateString(t.txn_date).slice(0, 7),
    (month, items) => {
      const net = items.reduce((s, t) => s + Number(t.cashflow_amount), 0);
      const outflow = items.filter((t) => Number(t.cashflow_amount) < 0).reduce((s, t) => s + Math.abs(Number(t.cashflow_amount)), 0);
      const inflow = items.filter((t) => Number(t.cashflow_amount) > 0).reduce((s, t) => s + Number(t.cashflow_amount), 0);
      return { month, net_cashflow: net, outflow, inflow };
    }
  ).sort((a, b) => a.month.localeCompare(b.month));
}

async function getInvestmentHistory(investmentId) {
  const db = getDb();
  const rows = await db.collection('investment_history')
    .find({ investment_id: Number(investmentId) })
    .sort({ change_date: -1, id: -1 })
    .toArray();
  return rows.map((r) => ({
    ...r,
    change_date: toDateString(r.change_date),
    amount: Number(r.amount)
  }));
}

async function getSummaryTable() {
  const { investments, history } = await loadCoreData();
  const historyByInvestment = new Map();
  for (const h of history) {
    if (!historyByInvestment.has(h.investment_id)) {
      historyByInvestment.set(h.investment_id, []);
    }
    historyByInvestment.get(h.investment_id).push(h);
  }

  return investments.map((i) => {
    const items = historyByInvestment.get(i.id) || [];
    const latest = items.sort((a, b) => {
      const d = toDateString(b.change_date).localeCompare(toDateString(a.change_date));
      return d !== 0 ? d : (b.id || 0) - (a.id || 0);
    })[0];
    return {
      id: i.id,
      website_app_name: i.website_app_name,
      investment_type: i.investment_type,
      sub_type_name: i.sub_type_name,
      sub_type_category: i.sub_type_category,
      amount: latest ? Number(latest.amount) : Number(i.amount),
      investment_date: toDateString(i.investment_date),
      notes: i.notes,
      history_count: items.length
    };
  }).sort((a, b) => b.amount - a.amount);
}

function resolveSeriesBreakdown(query) {
  const breakdown = query.breakdown;
  if (!breakdown || breakdown === 'none') return null;
  const allowed = ['investment_type', 'website_app_name', 'sub_type_name', 'sub_type_category'];
  if (!allowed.includes(breakdown)) return null;
  return { breakdown, seriesExpr: breakdown };
}

async function getValueSeries(query) {
  const { investments, history, investmentsById } = await loadCoreData();
  const filtered = investments.filter((i) => matchesFilters(i, query));
  const snapshotDates = [...new Set(history.map((h) => toDateString(h.change_date)))].sort();
  const from = query.from ? toDateString(query.from) : null;
  const to = query.to ? toDateString(query.to) : null;
  const dates = snapshotDates.filter((d) => (!from || d >= from) && (!to || d <= to));
  const breakdown = resolveSeriesBreakdown(query);

  const rows = [];
  for (const changeDate of dates) {
    if (breakdown) {
      const seriesMap = new Map();
      for (const inv of filtered) {
        const amount = amountAsOf(inv.id, changeDate, history, investmentsById);
        const minAmount = parseNumberParam(query.minAmount);
        const maxAmount = parseNumberParam(query.maxAmount);
        if (minAmount != null && amount < minAmount) continue;
        if (maxAmount != null && amount > maxAmount) continue;
        const series = inv[breakdown.breakdown] || 'Unknown';
        seriesMap.set(series, (seriesMap.get(series) || 0) + amount);
      }
      for (const [series_name, total_value] of seriesMap) {
        rows.push({ change_date: changeDate, series_name, total_value });
      }
    } else {
      let total = 0;
      for (const inv of filtered) {
        const amount = amountAsOf(inv.id, changeDate, history, investmentsById);
        const minAmount = parseNumberParam(query.minAmount);
        const maxAmount = parseNumberParam(query.maxAmount);
        if (minAmount != null && amount < minAmount) continue;
        if (maxAmount != null && amount > maxAmount) continue;
        total += amount;
      }
      rows.push({ change_date: changeDate, total_value: total });
    }
  }

  if (breakdown) {
    return { mode: 'series', breakdown: breakdown.breakdown, rows };
  }
  return { mode: 'total', breakdown: null, rows };
}

async function getAllocationLatest(query) {
  const { investments } = await loadCoreData();
  const filtered = investments.filter((i) => matchesFilters(i, query));
  const map = new Map();

  for (const inv of filtered) {
    // Live allocation uses current holdings, not history as-of.
    const value = Number(inv.amount) || 0;
    const minAmount = parseNumberParam(query.minAmount);
    const maxAmount = parseNumberParam(query.maxAmount);
    if (minAmount != null && value < minAmount) continue;
    if (maxAmount != null && value > maxAmount) continue;
    map.set(inv.investment_type, (map.get(inv.investment_type) || 0) + value);
  }

  return [...map.entries()]
    .map(([investment_type, value]) => ({ investment_type, value }))
    .sort((a, b) => b.value - a.value);
}

async function getInsights(query) {
  const { investments, history, investmentsById } = await loadCoreData();
  const dates = [...new Set(history.map((h) => toDateString(h.change_date)))].sort();
  const latestDate = dates[dates.length - 1] || null;
  if (!latestDate) {
    return { latestDate: null, daysSinceLatestSnapshot: null, portfolio: null, topHoldings: [] };
  }

  const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
  const filtered = investments.filter((i) => matchesFilters(i, query));

  const portfolioValueAt = (date) => filtered.reduce((sum, inv) => {
    const amount = amountAsOf(inv.id, date, history, investmentsById);
    const minAmount = parseNumberParam(query.minAmount);
    const maxAmount = parseNumberParam(query.maxAmount);
    if (minAmount != null && amount < minAmount) return sum;
    if (maxAmount != null && amount > maxAmount) return sum;
    return sum + amount;
  }, 0);

  const latestValue = portfolioValueAt(latestDate);
  const prevValue = prevDate ? portfolioValueAt(prevDate) : null;
  const changeAbs = prevValue === null ? null : latestValue - prevValue;
  const changePct = prevValue === null || prevValue === 0 ? null : ((latestValue - prevValue) / prevValue) * 100;

  const today = new Date();
  const latest = new Date(latestDate);
  const daysSinceLatestSnapshot = Math.floor((today - latest) / (1000 * 60 * 60 * 24));

  const topHoldings = filtered.map((inv) => ({
    investment_id: inv.id,
    website_app_name: inv.website_app_name,
    investment_type: inv.investment_type,
    sub_type_name: inv.sub_type_name,
    sub_type_category: inv.sub_type_category,
    amount: amountAsOf(inv.id, latestDate, history, investmentsById)
  }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((row) => ({
      ...row,
      pct_of_portfolio: latestValue > 0 ? (row.amount / latestValue) * 100 : 0
    }));

  return {
    latestDate,
    prevDate,
    daysSinceLatestSnapshot,
    portfolio: { latestValue, prevValue, changeAbs, changePct },
    topHoldings
  };
}

async function getDelta(fromDate, toDate) {
  const { investments, history } = await loadCoreData();
  const fromKey = toDateString(fromDate);
  const toKey = toDateString(toDate);

  // Carry forward last known history on/before each date (no live-amount fallback),
  // so new holdings appear as movers and dates align with insights snapshots.
  return withoutIgnoredPlatforms(investments)
    .map((i) => {
      const amount_from = amountAsOfHistoryOnly(i.id, fromKey, history);
      const amount_to = amountAsOfHistoryOnly(i.id, toKey, history);
      return {
        investment_id: i.id,
        website_app_name: i.website_app_name,
        investment_type: i.investment_type,
        sub_type_name: i.sub_type_name,
        sub_type_category: i.sub_type_category,
        amount_to,
        amount_from,
        delta: amount_to - amount_from
      };
    })
    .filter((r) => r.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
}

module.exports = {
  getTotal,
  getByType,
  getByMonth,
  getByYear,
  getMonthlyChanges,
  getYearlyChanges,
  getByPlatform,
  getBySubTypeName,
  getBySubTypeCategory,
  getGrowth,
  getCashflowsByMonth,
  getInvestmentHistory,
  getSummaryTable,
  getValueSeries,
  getAllocationLatest,
  getInsights,
  getDelta
};
