/**
 * Performance analytics for Mutual Fund / ETF holdings, derived from
 * `mutual_fund_nav_history` snapshots plus the live `investments` rows.
 */

const HOLDING_TYPES = ['Mutual Fund', 'ETF'];
const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'];
const TRADING_DAYS = 252;

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

const toUtc = (isoDate) => new Date(`${isoDate}T00:00:00Z`);
const fromUtc = (date) => date.toISOString().slice(0, 10);

function addDays(isoDate, days) {
  const date = toUtc(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

function addMonths(isoDate, months) {
  const date = toUtc(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return fromUtc(date);
}

function isoWeekOf(isoDate) {
  const date = toUtc(isoDate);
  const dayIndex = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayIndex + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstIndex + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
  return { year: date.getUTCFullYear(), week };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bucket an ISO date into the requested calendar period. */
function bucketOf(isoDate, period) {
  const [year, month, day] = isoDate.split('-');
  const monthIndex = Number(month) - 1;
  switch (period) {
    case 'daily':
      return { key: isoDate, label: `${day} ${MONTH_NAMES[monthIndex]} ${year}` };
    case 'weekly': {
      const { year: weekYear, week } = isoWeekOf(isoDate);
      const padded = String(week).padStart(2, '0');
      return { key: `${weekYear}-W${padded}`, label: `W${padded} ${weekYear}` };
    }
    case 'quarterly': {
      const quarter = Math.floor(monthIndex / 3) + 1;
      return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
    }
    case 'half-yearly': {
      const half = monthIndex < 6 ? 1 : 2;
      return { key: `${year}-H${half}`, label: `H${half} ${year}` };
    }
    case 'yearly':
      return { key: year, label: year };
    case 'monthly':
    default:
      return { key: `${year}-${month}`, label: `${MONTH_NAMES[monthIndex]} ${year}` };
  }
}

function stdDev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return null;
  return ((end - start) / Math.abs(start)) * 100;
}

function annualise(totalPct, startDate, endDate) {
  if (totalPct === null) return null;
  const years = (toUtc(endDate) - toUtc(startDate)) / (365.25 * 86400000);
  if (years < 0.75) return null;
  return ((1 + totalPct / 100) ** (1 / years) - 1) * 100;
}

/** Latest series point on or before `target`. */
function pointAsOf(points, target) {
  let found = null;
  for (const point of points) {
    if (point.date > target) break;
    found = point;
  }
  return found;
}

function fundLabel(investment) {
  return investment.mutual_fund_scheme_name
    || [investment.sub_type_name, investment.sub_type_category].filter(Boolean).join(' - ')
    || investment.website_app_name
    || `Holding #${investment.id}`;
}

const TRAILING_WINDOWS = [
  { id: 'd1', label: '1D', shift: (date) => addDays(date, -1) },
  { id: 'w1', label: '1W', shift: (date) => addDays(date, -7) },
  { id: 'm1', label: '1M', shift: (date) => addMonths(date, -1) },
  { id: 'm3', label: '3M', shift: (date) => addMonths(date, -3) },
  { id: 'm6', label: '6M', shift: (date) => addMonths(date, -6) },
  { id: 'y1', label: '1Y', shift: (date) => addMonths(date, -12) },
  { id: 'y3', label: '3Y', shift: (date) => addMonths(date, -36) },
  { id: 'ytd', label: 'YTD', shift: (date) => `${date.slice(0, 4)}-01-01` },
  { id: 'fy', label: 'FY', shift: (date) => (date.slice(5) >= '04-01' ? `${date.slice(0, 4)}-04-01` : `${Number(date.slice(0, 4)) - 1}-04-01`) }
];

function trailingReturns(points, latestDate) {
  const result = {};
  for (const window of TRAILING_WINDOWS) {
    const base = pointAsOf(points, window.shift(latestDate));
    const latest = points[points.length - 1];
    result[window.id] = base && base.date !== latest.date
      ? round(pctChange(base.nav, latest.nav))
      : null;
  }
  return result;
}

/** Per-fund NAV series keyed by investment id, de-duplicated per snapshot date. */
function buildSeriesByFund(snapshots, allowedIds) {
  const byFund = new Map();
  for (const row of snapshots) {
    const id = Number(row.investment_id);
    if (!allowedIds.has(id)) continue;
    const date = toIsoDate(row.snapshot_date);
    const nav = num(row.nav_price);
    if (!date || nav <= 0) continue;
    if (!byFund.has(id)) byFund.set(id, new Map());
    byFund.get(id).set(date, {
      date,
      nav,
      units: num(row.units),
      value: num(row.value) || num(row.units) * nav,
      source: row.source || null
    });
  }
  const series = new Map();
  for (const [id, points] of byFund) {
    series.set(id, [...points.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return series;
}

/**
 * Portfolio index that neutralises unit additions: each step re-prices the
 * current units at the previous NAV so only price movement is measured.
 */
function buildPortfolioSeries(seriesByFund) {
  const dates = new Set();
  for (const points of seriesByFund.values()) points.forEach((point) => dates.add(point.date));
  const ordered = [...dates].sort();
  if (!ordered.length) return { series: [], dailyReturns: [] };

  const series = [];
  const dailyReturns = [];
  let index = 100;
  let peak = 100;
  let previousDate = null;

  for (const date of ordered) {
    let value = 0;
    let basis = 0;
    let current = 0;
    let holdings = 0;

    for (const points of seriesByFund.values()) {
      const point = pointAsOf(points, date);
      if (!point) continue;
      holdings += 1;
      value += point.units * point.nav;
      if (previousDate) {
        const prior = pointAsOf(points, previousDate);
        if (prior) {
          basis += point.units * prior.nav;
          current += point.units * point.nav;
        }
      }
    }

    const dayReturn = previousDate && basis > 0 ? (current - basis) / basis : 0;
    if (previousDate && basis > 0) dailyReturns.push({ date, ret: dayReturn * 100 });
    index *= 1 + dayReturn;
    peak = Math.max(peak, index);

    series.push({
      date,
      value: round(value),
      index: round(index, 4),
      change_pct: previousDate && basis > 0 ? round(dayReturn * 100, 4) : null,
      drawdown_pct: round(((index - peak) / peak) * 100, 4),
      holdings
    });
    previousDate = date;
  }
  return { series, dailyReturns };
}

function bucketSeries(series, period, valueKey = 'index') {
  const buckets = new Map();
  for (const point of series) {
    const { key, label } = bucketOf(point.date, period);
    if (!buckets.has(key)) buckets.set(key, { key, label, points: [] });
    buckets.get(key).points.push(point);
  }
  return [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => {
      const first = bucket.points[0];
      const last = bucket.points[bucket.points.length - 1];
      return {
        key: bucket.key,
        label: bucket.label,
        start: first.date,
        end: last.date,
        open: first[valueKey],
        close: last[valueKey],
        points: bucket.points
      };
    });
}

function buildPortfolioPeriodRows(portfolioSeries, seriesByFund, meta, period) {
  const buckets = bucketSeries(portfolioSeries, period);
  const rows = [];
  let previousClose = null;
  let previousValue = null;

  for (const bucket of buckets) {
    const base = previousClose ?? bucket.open;
    const changePct = pctChange(base, bucket.close);
    const endValue = bucket.points[bucket.points.length - 1].value;
    const startValue = previousValue ?? bucket.points[0].value;

    const movers = [];
    for (const [id, points] of seriesByFund) {
      const startPoint = pointAsOf(points, addDays(bucket.start, -1)) || pointAsOf(points, bucket.start);
      const endPoint = pointAsOf(points, bucket.end);
      if (!startPoint || !endPoint || startPoint.date === endPoint.date) continue;
      const pct = pctChange(startPoint.nav, endPoint.nav);
      if (pct === null) continue;
      movers.push({ id, name: meta.get(id)?.name || `#${id}`, pct: round(pct) });
    }
    movers.sort((a, b) => b.pct - a.pct);

    rows.push({
      key: bucket.key,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      open_index: bucket.open,
      close_index: bucket.close,
      change_pct: round(changePct),
      start_value: round(startValue),
      end_value: round(endValue),
      value_change: round(endValue - startValue),
      advancers: movers.filter((mover) => mover.pct > 0).length,
      decliners: movers.filter((mover) => mover.pct < 0).length,
      best: movers[0] || null,
      worst: movers.length ? movers[movers.length - 1] : null
    });
    previousClose = bucket.close;
    previousValue = endValue;
  }
  return rows;
}

function buildFundPeriodMatrix(seriesByFund, meta, period, periodKeys) {
  const funds = [];
  for (const [id, points] of seriesByFund) {
    const buckets = bucketSeries(points, period, 'nav');
    const returns = {};
    let previousClose = null;
    for (const bucket of buckets) {
      const base = previousClose ?? bucket.open;
      returns[bucket.key] = round(pctChange(base, bucket.close));
      previousClose = bucket.close;
    }
    const info = meta.get(id) || {};
    funds.push({
      id,
      name: info.name || `#${id}`,
      investment_type: info.investment_type || null,
      platform: info.platform || null,
      category: info.category || null,
      returns: periodKeys.reduce((acc, key) => {
        acc[key] = returns[key] ?? null;
        return acc;
      }, {})
    });
  }
  funds.sort((a, b) => a.name.localeCompare(b.name));
  return funds;
}

function groupTotals(holdings, keyOf) {
  const groups = new Map();
  for (const holding of holdings) {
    const key = keyOf(holding) || 'Unspecified';
    if (!groups.has(key)) groups.set(key, { key, value: 0, invested: 0, count: 0 });
    const group = groups.get(key);
    group.value += holding.current_value || 0;
    group.invested += holding.invested_amount || 0;
    group.count += 1;
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      value: round(group.value),
      invested: round(group.invested),
      gain: round(group.value - group.invested),
      gain_pct: round(pctChange(group.invested, group.value))
    }))
    .sort((a, b) => b.value - a.value);
}

function buildHoldings(investments, seriesByFund, rangeStart) {
  return investments.map((investment) => {
    const id = Number(investment.id);
    const points = seriesByFund.get(id) || [];
    const latest = points[points.length - 1] || null;
    const units = latest ? latest.units : num(investment.units);
    const nav = latest ? latest.nav : num(investment.nav_price);
    const currentValue = latest ? latest.units * latest.nav : num(investment.amount);
    const invested = num(investment.invested_amount) || num(investment.avg_buy_price) * units;

    const rangeStartPoint = points.length
      ? (pointAsOf(points, rangeStart) || points[0])
      : null;
    const rangePct = latest && rangeStartPoint && rangeStartPoint.date !== latest.date
      ? pctChange(rangeStartPoint.nav, latest.nav)
      : null;

    const navReturns = [];
    for (let i = 1; i < points.length; i += 1) {
      const pct = pctChange(points[i - 1].nav, points[i].nav);
      if (pct !== null) navReturns.push({ date: points[i].date, pct });
    }
    const sorted = [...navReturns].sort((a, b) => b.pct - a.pct);
    const volatility = stdDev(navReturns.map((entry) => entry.pct));

    let peakNav = 0;
    let maxDrawdown = 0;
    for (const point of points) {
      peakNav = Math.max(peakNav, point.nav);
      if (peakNav > 0) maxDrawdown = Math.min(maxDrawdown, ((point.nav - peakNav) / peakNav) * 100);
    }

    const inceptionDate = points.length ? points[0].date : toIsoDate(investment.investment_date);
    const inceptionPct = points.length > 1 ? pctChange(points[0].nav, latest.nav) : null;

    return {
      id,
      name: fundLabel(investment),
      investment_type: investment.investment_type,
      platform: investment.website_app_name || null,
      category: investment.sub_type_category || investment.sub_type_name || null,
      sub_type_name: investment.sub_type_name || null,
      scheme_code: investment.mutual_fund_scheme_code || null,
      investment_date: toIsoDate(investment.investment_date),
      units: round(units, 4),
      nav: round(nav, 4),
      nav_date: latest ? latest.date : toIsoDate(investment.nav_date) || null,
      nav_source: latest ? latest.source : investment.nav_source || null,
      current_value: round(currentValue),
      invested_amount: round(invested),
      gain: round(currentValue - invested),
      gain_pct: round(pctChange(invested, currentValue)),
      range_return_pct: round(rangePct),
      range_value_change: rangeStartPoint && latest
        ? round(latest.units * latest.nav - rangeStartPoint.units * rangeStartPoint.nav)
        : null,
      trailing: points.length ? trailingReturns(points, latest.date) : {},
      inception_date: inceptionDate,
      inception_return_pct: round(inceptionPct),
      cagr_pct: inceptionPct !== null && latest ? round(annualise(inceptionPct, points[0].date, latest.date)) : null,
      volatility_pct: volatility !== null ? round(volatility * Math.sqrt(TRADING_DAYS)) : null,
      max_drawdown_pct: round(maxDrawdown),
      best_day: sorted[0] ? { date: sorted[0].date, pct: round(sorted[0].pct) } : null,
      worst_day: sorted.length ? { date: sorted[sorted.length - 1].date, pct: round(sorted[sorted.length - 1].pct) } : null,
      positive_days_pct: navReturns.length
        ? round((navReturns.filter((entry) => entry.pct > 0).length / navReturns.length) * 100)
        : null,
      snapshot_count: points.length,
      first_snapshot: points.length ? points[0].date : null,
      last_snapshot: latest ? latest.date : null,
      has_history: points.length > 1
    };
  });
}

/**
 * @param {object} input
 * @param {object[]} input.investments live investment rows (any type)
 * @param {object[]} input.snapshots   mutual_fund_nav_history rows
 */
function buildFundAnalytics({ investments, snapshots, from, to, period = 'monthly', topN = 10, filters = {} }) {
  const activePeriod = PERIODS.includes(period) ? period : 'monthly';
  const holdingRows = investments.filter((row) => HOLDING_TYPES.includes(row.investment_type));

  const options = {
    types: [...new Set(holdingRows.map((row) => row.investment_type).filter(Boolean))].sort(),
    platforms: [...new Set(holdingRows.map((row) => row.website_app_name).filter(Boolean))].sort(),
    categories: [...new Set(holdingRows
      .map((row) => row.sub_type_category || row.sub_type_name)
      .filter(Boolean))].sort()
  };

  const selected = holdingRows.filter((row) => {
    if (filters.types?.length && !filters.types.includes(row.investment_type)) return false;
    if (filters.platforms?.length && !filters.platforms.includes(row.website_app_name)) return false;
    if (filters.categories?.length
      && !filters.categories.includes(row.sub_type_category || row.sub_type_name)) return false;
    if (filters.ids?.length && !filters.ids.includes(Number(row.id))) return false;
    return true;
  });

  const allowedIds = new Set(selected.map((row) => Number(row.id)));
  const seriesByFund = buildSeriesByFund(snapshots, allowedIds);
  const meta = new Map(selected.map((row) => [Number(row.id), {
    name: fundLabel(row),
    investment_type: row.investment_type,
    platform: row.website_app_name || null,
    category: row.sub_type_category || row.sub_type_name || null
  }]));

  const { series: portfolioSeries, dailyReturns } = buildPortfolioSeries(seriesByFund);
  const firstDate = portfolioSeries.length ? portfolioSeries[0].date : from || null;
  const lastDate = portfolioSeries.length ? portfolioSeries[portfolioSeries.length - 1].date : to || null;

  const holdings = buildHoldings(selected, seriesByFund, from || firstDate || '0000-01-01');
  const withHistory = holdings.filter((holding) => holding.range_return_pct !== null);
  const ranked = [...withHistory].sort((a, b) => b.range_return_pct - a.range_return_pct);

  const periodRows = buildPortfolioPeriodRows(portfolioSeries, seriesByFund, meta, activePeriod);
  const periodKeys = periodRows.map((row) => row.key);
  const fundMatrix = buildFundPeriodMatrix(seriesByFund, meta, activePeriod, periodKeys);

  const currentValue = holdings.reduce((sum, holding) => sum + (holding.current_value || 0), 0);
  const investedAmount = holdings.reduce((sum, holding) => sum + (holding.invested_amount || 0), 0);

  const indexSeries = portfolioSeries.map((point) => point.index);
  const portfolioReturn = indexSeries.length > 1 ? pctChange(indexSeries[0], indexSeries[indexSeries.length - 1]) : null;
  const dailySorted = [...dailyReturns].sort((a, b) => b.ret - a.ret);
  const portfolioVolatility = stdDev(dailyReturns.map((entry) => entry.ret));

  return {
    generated_at: new Date().toISOString(),
    period: activePeriod,
    from: from || firstDate,
    to: to || lastDate,
    options,
    applied_filters: {
      types: filters.types || [],
      platforms: filters.platforms || [],
      categories: filters.categories || [],
      ids: filters.ids || []
    },
    summary: {
      holdings: holdings.length,
      mutual_funds: holdings.filter((holding) => holding.investment_type === 'Mutual Fund').length,
      etfs: holdings.filter((holding) => holding.investment_type === 'ETF').length,
      tracked_with_history: withHistory.length,
      current_value: round(currentValue),
      invested_amount: round(investedAmount),
      gain: round(currentValue - investedAmount),
      gain_pct: round(pctChange(investedAmount, currentValue)),
      first_date: firstDate,
      last_date: lastDate,
      snapshot_days: portfolioSeries.length,
      portfolio_return_pct: round(portfolioReturn),
      portfolio_cagr_pct: portfolioReturn !== null && firstDate && lastDate
        ? round(annualise(portfolioReturn, firstDate, lastDate))
        : null,
      volatility_pct: portfolioVolatility !== null ? round(portfolioVolatility * Math.sqrt(TRADING_DAYS)) : null,
      max_drawdown_pct: portfolioSeries.length
        ? round(Math.min(...portfolioSeries.map((point) => point.drawdown_pct ?? 0)))
        : null,
      best_day: dailySorted[0] ? { date: dailySorted[0].date, pct: round(dailySorted[0].ret) } : null,
      worst_day: dailySorted.length
        ? { date: dailySorted[dailySorted.length - 1].date, pct: round(dailySorted[dailySorted.length - 1].ret) }
        : null,
      positive_days_pct: dailyReturns.length
        ? round((dailyReturns.filter((entry) => entry.ret > 0).length / dailyReturns.length) * 100)
        : null,
      best_holding: ranked[0] || null,
      worst_holding: ranked.length ? ranked[ranked.length - 1] : null
    },
    holdings,
    portfolio_series: portfolioSeries,
    period_rows: periodRows,
    fund_period_matrix: { periods: periodRows.map(({ key, label }) => ({ key, label })), funds: fundMatrix },
    leaders: {
      best: ranked.slice(0, topN),
      worst: ranked.slice(-topN).reverse()
    },
    allocation: {
      by_type: groupTotals(holdings, (holding) => holding.investment_type),
      by_platform: groupTotals(holdings, (holding) => holding.platform),
      by_category: groupTotals(holdings, (holding) => holding.category)
    }
  };
}

module.exports = { buildFundAnalytics, HOLDING_TYPES, PERIODS };
