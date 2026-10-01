/**
 * Performance analytics for Mutual Fund / ETF holdings, derived from
 * `mutual_fund_nav_history` snapshots, `investment_transactions` cashflows and
 * the live `investments` rows.
 */

const HOLDING_TYPES = ['Mutual Fund', 'ETF'];
const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'];
const DEFAULT_RISK_FREE_PCT = 6;
const DAY_MS = 86400000;
const STALE_NAV_DAYS = 7;

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
const daysBetween = (startIso, endIso) => (toUtc(endIso) - toUtc(startIso)) / DAY_MS;
const yearsBetween = (startIso, endIso) => daysBetween(startIso, endIso) / 365.25;

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
  const week = 1 + Math.round((date - firstThursday) / (7 * DAY_MS));
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

function financialYearOf(isoDate) {
  const year = Number(isoDate.slice(0, 4));
  const startYear = isoDate.slice(5) >= '04-01' ? year : year - 1;
  return {
    key: String(startYear),
    label: `FY ${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`,
    start: `${startYear}-04-01`
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return null;
  return ((end - start) / Math.abs(start)) * 100;
}

function annualise(totalPct, startDate, endDate) {
  if (totalPct === null) return null;
  const years = yearsBetween(startDate, endDate);
  if (years < 0.75) return null;
  return ((1 + totalPct / 100) ** (1 / years) - 1) * 100;
}

/** XIRR (% p.a.) via bisection; flows carry negative amounts for money invested. */
function xirr(flows) {
  if (!flows || flows.length < 2) return null;
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const origin = Math.min(...flows.map((flow) => Date.parse(flow.date)));
  const points = flows.map((flow) => ({
    t: (Date.parse(flow.date) - origin) / (365 * DAY_MS),
    amount: flow.amount
  }));
  if (points.every((point) => point.t < 30 / 365)) return null;

  const npv = (rate) => points.reduce((sum, point) => sum + point.amount / (1 + rate) ** point.t, 0);
  let low = -0.99;
  let high = 10;
  let npvLow = npv(low);
  if (npvLow * npv(high) > 0) return null;

  let mid = 0;
  for (let i = 0; i < 200; i += 1) {
    mid = (low + high) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < 1e-4) break;
    if (npvLow * npvMid < 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }
  return mid * 100;
}

/** Latest series point on or before `target` (binary search; series must be date-sorted). */
function pointAsOf(points, target) {
  let low = 0;
  let high = points.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].date <= target) {
      found = points[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
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
  { id: 'y3', label: '3Y', shift: (date) => addMonths(date, -36), annualise: true },
  { id: 'y5', label: '5Y', shift: (date) => addMonths(date, -60), annualise: true },
  { id: 'ytd', label: 'YTD', shift: (date) => `${date.slice(0, 4)}-01-01` },
  { id: 'fy', label: 'FY', shift: (date) => financialYearOf(date).start }
];

/** Trailing window returns; multi-year windows are annualised. */
function trailingReturns(points, latestDate) {
  const latest = points[points.length - 1];
  const result = {};
  for (const window of TRAILING_WINDOWS) {
    const base = pointAsOf(points, window.shift(latestDate));
    if (!base || base.date === latest.date) {
      result[window.id] = null;
      continue;
    }
    const total = pctChange(base.nav, latest.nav);
    const value = window.annualise ? (annualise(total, base.date, latest.date) ?? total) : total;
    result[window.id] = round(value);
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

/** Step returns between consecutive observations of a NAV series. */
function navReturnsOf(points) {
  const returns = [];
  for (let i = 1; i < points.length; i += 1) {
    const pct = pctChange(points[i - 1].nav, points[i].nav);
    if (pct !== null) returns.push({ date: points[i].date, pct });
  }
  return returns;
}

/** Observation frequency per year, so sparse series are annualised honestly. */
function periodsPerYear(points) {
  if (points.length < 3) return 252;
  const years = yearsBetween(points[0].date, points[points.length - 1].date);
  if (years <= 0) return 252;
  return Math.min(Math.max((points.length - 1) / years, 4), 365);
}

function riskStats(returns, points, totalPct, riskFreePct) {
  const values = returns.map((entry) => entry.pct);
  const deviation = stdDev(values);
  if (deviation === null || points.length < 2) {
    return { volatility_pct: null, downside_pct: null, sharpe: null, sortino: null, annual_return_pct: null };
  }

  const ppy = periodsPerYear(points);
  const volatility = deviation * Math.sqrt(ppy);
  const downsideValues = values.filter((value) => value < 0);
  const downside = downsideValues.length > 1
    ? Math.sqrt(downsideValues.reduce((sum, value) => sum + value ** 2, 0) / downsideValues.length) * Math.sqrt(ppy)
    : null;

  const years = yearsBetween(points[0].date, points[points.length - 1].date);
  const annualReturn = totalPct === null
    ? null
    : (years >= 0.25 ? ((1 + totalPct / 100) ** (1 / years) - 1) * 100 : totalPct);
  const excess = annualReturn === null ? null : annualReturn - riskFreePct;

  return {
    volatility_pct: round(volatility),
    downside_pct: round(downside),
    sharpe: excess !== null && volatility > 0 ? round(excess / volatility, 2) : null,
    sortino: excess !== null && downside > 0 ? round(excess / downside, 2) : null,
    annual_return_pct: round(annualReturn)
  };
}

/** Beta / correlation of a return series against a reference series, aligned by date. */
function betaCorrelation(returns, referenceByDate) {
  const pairs = [];
  for (const entry of returns) {
    const reference = referenceByDate.get(entry.date);
    if (reference === undefined) continue;
    pairs.push([entry.pct, reference]);
  }
  if (pairs.length < 10) return { beta: null, correlation: null };

  const fundMean = mean(pairs.map((pair) => pair[0]));
  const refMean = mean(pairs.map((pair) => pair[1]));
  let covariance = 0;
  let refVariance = 0;
  let fundVariance = 0;
  for (const [fundValue, refValue] of pairs) {
    covariance += (fundValue - fundMean) * (refValue - refMean);
    refVariance += (refValue - refMean) ** 2;
    fundVariance += (fundValue - fundMean) ** 2;
  }
  if (refVariance === 0 || fundVariance === 0) return { beta: null, correlation: null };
  return {
    beta: round(covariance / refVariance, 2),
    correlation: round(covariance / Math.sqrt(refVariance * fundVariance), 2)
  };
}

function currentStreak(returns) {
  if (!returns.length || returns[returns.length - 1].pct === 0) return null;
  const direction = returns[returns.length - 1].pct > 0 ? 'up' : 'down';
  let sessions = 0;
  let compounded = 1;
  for (let i = returns.length - 1; i >= 0; i -= 1) {
    const isUp = returns[i].pct > 0;
    if (returns[i].pct === 0 || isUp !== (direction === 'up')) break;
    sessions += 1;
    compounded *= 1 + returns[i].pct / 100;
  }
  return { direction, sessions, pct: round((compounded - 1) * 100) };
}

function maxDrawdownOf(points, key = 'nav') {
  let peak = -Infinity;
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point[key]);
    if (peak > 0) worst = Math.min(worst, ((point[key] - peak) / peak) * 100);
  }
  return worst;
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

  const cursors = new Map([...seriesByFund.keys()].map((id) => [id, -1]));
  const series = [];
  const dailyReturns = [];
  let index = 100;
  let peak = 100;
  let hasPrevious = false;

  for (const date of ordered) {
    let value = 0;
    let basis = 0;
    let current = 0;
    let holdings = 0;

    for (const [id, points] of seriesByFund) {
      let cursor = cursors.get(id);
      const prior = cursor >= 0 ? points[cursor] : null;
      while (cursor + 1 < points.length && points[cursor + 1].date <= date) cursor += 1;
      cursors.set(id, cursor);

      const point = cursor >= 0 ? points[cursor] : null;
      if (!point) continue;
      holdings += 1;
      value += point.units * point.nav;
      if (prior) {
        basis += point.units * prior.nav;
        current += point.units * point.nav;
      }
    }

    const stepReturn = hasPrevious && basis > 0 ? (current - basis) / basis : 0;
    if (hasPrevious && basis > 0) dailyReturns.push({ date, pct: stepReturn * 100 });
    index *= 1 + stepReturn;
    peak = Math.max(peak, index);

    series.push({
      date,
      value: round(value),
      index: round(index, 4),
      change_pct: hasPrevious && basis > 0 ? round(stepReturn * 100, 4) : null,
      drawdown_pct: round(((index - peak) / peak) * 100, 4),
      holdings
    });
    hasPrevious = true;
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

/** Close-to-close bucket returns for one NAV series, keyed by bucket id. */
function bucketReturnsOf(points, period) {
  const result = new Map();
  let previousClose = null;
  for (const bucket of bucketSeries(points, period, 'nav')) {
    result.set(bucket.key, round(pctChange(previousClose ?? bucket.open, bucket.close)));
    previousClose = bucket.close;
  }
  return result;
}

function buildPortfolioPeriodRows(portfolioSeries, bucketReturnsByFund, meta, period) {
  const rows = [];
  let previousClose = null;
  let previousValue = null;

  for (const bucket of bucketSeries(portfolioSeries, period)) {
    const endValue = bucket.points[bucket.points.length - 1].value;
    const startValue = previousValue ?? bucket.points[0].value;

    const movers = [];
    for (const [id, returns] of bucketReturnsByFund) {
      const pct = returns.get(bucket.key);
      if (pct === undefined || pct === null) continue;
      movers.push({ id, name: meta.get(id)?.name || `#${id}`, pct });
    }
    movers.sort((a, b) => b.pct - a.pct);

    rows.push({
      key: bucket.key,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      open_index: bucket.open,
      close_index: bucket.close,
      change_pct: round(pctChange(previousClose ?? bucket.open, bucket.close)),
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

/** Calendar-year and financial-year NAV returns for a single fund. */
function calendarReturnsOf(points) {
  const group = (keyOf) => {
    const buckets = new Map();
    for (const point of points) {
      const { key, label } = keyOf(point.date);
      if (!buckets.has(key)) buckets.set(key, { key, label, first: point, last: point });
      buckets.get(key).last = point;
    }
    let previousClose = null;
    return [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((bucket) => {
        const row = {
          key: bucket.key,
          label: bucket.label,
          pct: round(pctChange(previousClose ?? bucket.first.nav, bucket.last.nav))
        };
        previousClose = bucket.last.nav;
        return row;
      });
  };

  return {
    calendar: group((date) => ({ key: date.slice(0, 4), label: date.slice(0, 4) })),
    financial: group(financialYearOf)
  };
}

/** Rolling look-back returns on the portfolio index. */
function rollingReturns(series, windows) {
  return windows
    .map((window) => ({
      id: window.id,
      label: window.label,
      points: series
        .map((point) => {
          const base = pointAsOf(series, addDays(point.date, -window.days));
          if (!base || base.date === point.date) return { date: point.date, pct: null };
          const total = pctChange(base.index, point.index);
          const pct = window.days >= 365 ? (annualise(total, base.date, point.date) ?? total) : total;
          return { date: point.date, pct: round(pct) };
        })
        .filter((point) => point.pct !== null)
    }))
    .filter((window) => window.points.length > 1);
}

/** Peak-to-trough drawdown episodes with recovery info, deepest first. */
function drawdownEpisodes(series, limit = 5) {
  const episodes = [];
  let peak = null;
  let active = null;

  for (const point of series) {
    if (!peak || point.index >= peak.index) {
      if (active) {
        active.recovery_date = point.date;
        active.duration_days = Math.round(daysBetween(active.peak_date, point.date));
        active.recovery_days = Math.round(daysBetween(active.trough_date, point.date));
        episodes.push(active);
        active = null;
      }
      peak = point;
      continue;
    }
    const depth = ((point.index - peak.index) / peak.index) * 100;
    if (!active) {
      active = {
        peak_date: peak.date,
        trough_date: point.date,
        depth_pct: round(depth),
        recovery_date: null,
        recovery_days: null,
        duration_days: null
      };
    } else if (depth < active.depth_pct) {
      active.trough_date = point.date;
      active.depth_pct = round(depth);
    }
  }
  if (active) {
    active.duration_days = Math.round(daysBetween(active.peak_date, series[series.length - 1].date));
    episodes.push(active);
  }
  return episodes.sort((a, b) => a.depth_pct - b.depth_pct).slice(0, limit);
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
  const total = [...groups.values()].reduce((sum, group) => sum + group.value, 0);
  return [...groups.values()]
    .map((group) => ({
      ...group,
      value: round(group.value),
      invested: round(group.invested),
      gain: round(group.value - group.invested),
      gain_pct: round(pctChange(group.invested, group.value)),
      weight_pct: total > 0 ? round((group.value / total) * 100) : null
    }))
    .sort((a, b) => b.value - a.value);
}

function buildHoldings(investments, seriesByFund, context) {
  const { rangeStart, asOf, flowsById, portfolioReturnsByDate, riskFreePct } = context;

  return investments.map((investment) => {
    const id = Number(investment.id);
    const points = seriesByFund.get(id) || [];
    const latest = points[points.length - 1] || null;
    const units = latest ? latest.units : num(investment.units);
    const nav = latest ? latest.nav : num(investment.nav_price);
    const currentValue = latest ? latest.units * latest.nav : num(investment.amount);
    const invested = num(investment.invested_amount) || num(investment.avg_buy_price) * units;

    const rangeStartPoint = points.length ? (pointAsOf(points, rangeStart) || points[0]) : null;
    const rangePct = latest && rangeStartPoint && rangeStartPoint.date !== latest.date
      ? pctChange(rangeStartPoint.nav, latest.nav)
      : null;

    const returns = navReturnsOf(points);
    const sorted = [...returns].sort((a, b) => b.pct - a.pct);
    const inceptionPct = points.length > 1 ? pctChange(points[0].nav, latest.nav) : null;
    const risk = riskStats(returns, points, inceptionPct, riskFreePct);
    const { beta, correlation } = betaCorrelation(returns, portfolioReturnsByDate);

    const flows = flowsById.get(id) || [];
    const terminalDate = latest ? latest.date : asOf;
    const investmentDate = toIsoDate(investment.investment_date);
    let xirrFlows = [];
    if (flows.length) {
      xirrFlows = [...flows, ...(currentValue > 0 ? [{ date: terminalDate, amount: currentValue }] : [])];
    } else if (invested > 0 && investmentDate && currentValue > 0) {
      xirrFlows = [
        { date: investmentDate, amount: -invested },
        { date: terminalDate, amount: currentValue }
      ];
    }
    const moneyWeighted = xirr(xirrFlows);
    const calendar = points.length > 1 ? calendarReturnsOf(points) : { calendar: [], financial: [] };

    return {
      id,
      name: fundLabel(investment),
      investment_type: investment.investment_type,
      platform: investment.website_app_name || null,
      category: investment.sub_type_category || investment.sub_type_name || null,
      sub_type_name: investment.sub_type_name || null,
      scheme_code: investment.mutual_fund_scheme_code || null,
      investment_date: investmentDate,
      units: round(units, 4),
      nav: round(nav, 4),
      nav_date: latest ? latest.date : null,
      nav_source: latest ? latest.source : investment.nav_source || null,
      stale_days: latest ? Math.round(daysBetween(latest.date, asOf)) : null,
      current_value: round(currentValue),
      invested_amount: round(invested),
      weight_pct: null,
      gain: round(currentValue - invested),
      gain_pct: round(pctChange(invested, currentValue)),
      xirr_pct: moneyWeighted !== null ? round(moneyWeighted) : null,
      xirr_basis: flows.length ? 'transactions' : (xirrFlows.length ? 'invested_amount' : 'none'),
      range_return_pct: round(rangePct),
      range_value_change: rangeStartPoint && latest
        ? round(latest.units * latest.nav - rangeStartPoint.units * rangeStartPoint.nav)
        : null,
      trailing: points.length ? trailingReturns(points, latest.date) : {},
      inception_date: points.length ? points[0].date : investmentDate,
      inception_return_pct: round(inceptionPct),
      cagr_pct: inceptionPct !== null ? round(annualise(inceptionPct, points[0].date, latest.date)) : null,
      volatility_pct: risk.volatility_pct,
      downside_pct: risk.downside_pct,
      sharpe: risk.sharpe,
      sortino: risk.sortino,
      beta,
      correlation,
      max_drawdown_pct: round(maxDrawdownOf(points)),
      best_day: sorted[0] ? { date: sorted[0].date, pct: round(sorted[0].pct) } : null,
      worst_day: sorted.length
        ? { date: sorted[sorted.length - 1].date, pct: round(sorted[sorted.length - 1].pct) }
        : null,
      streak: currentStreak(returns),
      positive_days_pct: returns.length
        ? round((returns.filter((entry) => entry.pct > 0).length / returns.length) * 100)
        : null,
      calendar_returns: calendar.calendar,
      financial_year_returns: calendar.financial,
      snapshot_count: points.length,
      first_snapshot: points.length ? points[0].date : null,
      last_snapshot: latest ? latest.date : null,
      has_history: points.length > 1
    };
  });
}

/** Rebase one holding's NAV series onto the portfolio timeline for comparison. */
function buildBenchmark(benchmarkId, seriesByFund, meta, portfolioSeries, portfolioReturns) {
  const points = seriesByFund.get(benchmarkId);
  if (!points || points.length < 2 || portfolioSeries.length < 2) return null;

  const base = pointAsOf(points, portfolioSeries[0].date) || points[0];
  const series = portfolioSeries.map((point) => {
    const match = pointAsOf(points, point.date) || base;
    return { date: point.date, index: round((match.nav / base.nav) * 100, 4) };
  });

  const benchmarkByDate = new Map();
  for (let i = 1; i < series.length; i += 1) {
    const pct = pctChange(series[i - 1].index, series[i].index);
    if (pct !== null) benchmarkByDate.set(series[i].date, pct);
  }
  const { beta, correlation } = betaCorrelation(portfolioReturns, benchmarkByDate);
  const benchmarkReturn = pctChange(series[0].index, series[series.length - 1].index);
  const portfolioReturn = pctChange(
    portfolioSeries[0].index,
    portfolioSeries[portfolioSeries.length - 1].index
  );

  return {
    id: benchmarkId,
    name: meta.get(benchmarkId)?.name || `#${benchmarkId}`,
    series,
    return_pct: round(benchmarkReturn),
    portfolio_return_pct: round(portfolioReturn),
    excess_pct: round((portfolioReturn ?? 0) - (benchmarkReturn ?? 0)),
    beta,
    correlation
  };
}

/**
 * @param {object} input
 * @param {object[]} input.investments  live investment rows (any type)
 * @param {object[]} input.snapshots    mutual_fund_nav_history rows
 * @param {object[]} [input.transactions] investment_transactions rows, used for XIRR
 */
function buildFundAnalytics({
  investments,
  snapshots,
  transactions = [],
  from,
  to,
  period = 'monthly',
  topN = 10,
  riskFreePct = DEFAULT_RISK_FREE_PCT,
  benchmarkId = null,
  filters = {}
}) {
  const activePeriod = PERIODS.includes(period) ? period : 'monthly';
  const holdingRows = investments.filter((row) => HOLDING_TYPES.includes(row.investment_type));

  const options = {
    types: [...new Set(holdingRows.map((row) => row.investment_type).filter(Boolean))].sort(),
    platforms: [...new Set(holdingRows.map((row) => row.website_app_name).filter(Boolean))].sort(),
    categories: [...new Set(holdingRows
      .map((row) => row.sub_type_category || row.sub_type_name)
      .filter(Boolean))].sort(),
    funds: holdingRows
      .map((row) => ({ id: Number(row.id), name: fundLabel(row) }))
      .sort((a, b) => a.name.localeCompare(b.name))
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

  const flowsById = new Map();
  for (const txn of transactions) {
    const id = Number(txn.investment_id);
    if (!allowedIds.has(id)) continue;
    const date = toIsoDate(txn.txn_date);
    if (!date) continue;
    if (!flowsById.has(id)) flowsById.set(id, []);
    flowsById.get(id).push({ date, amount: num(txn.cashflow_amount) });
  }
  for (const flows of flowsById.values()) flows.sort((a, b) => a.date.localeCompare(b.date));

  const { series: portfolioSeries, dailyReturns } = buildPortfolioSeries(seriesByFund);
  const firstDate = portfolioSeries.length ? portfolioSeries[0].date : from || null;
  const lastDate = portfolioSeries.length ? portfolioSeries[portfolioSeries.length - 1].date : to || null;
  const asOf = to || lastDate || fromUtc(new Date());
  const portfolioReturnsByDate = new Map(dailyReturns.map((entry) => [entry.date, entry.pct]));

  const holdings = buildHoldings(selected, seriesByFund, {
    rangeStart: from || firstDate || '0000-01-01',
    asOf,
    flowsById,
    portfolioReturnsByDate,
    riskFreePct
  });

  const currentValue = holdings.reduce((sum, holding) => sum + (holding.current_value || 0), 0);
  const investedAmount = holdings.reduce((sum, holding) => sum + (holding.invested_amount || 0), 0);
  for (const holding of holdings) {
    holding.weight_pct = currentValue > 0 ? round(((holding.current_value || 0) / currentValue) * 100) : null;
  }

  const withHistory = holdings.filter((holding) => holding.range_return_pct !== null);
  const ranked = [...withHistory].sort((a, b) => b.range_return_pct - a.range_return_pct);

  const bucketReturnsByFund = new Map(
    [...seriesByFund.entries()].map(([id, points]) => [id, bucketReturnsOf(points, activePeriod)])
  );
  const periodRows = buildPortfolioPeriodRows(portfolioSeries, bucketReturnsByFund, meta, activePeriod);
  const periodKeys = periodRows.map((row) => row.key);
  const fundMatrix = [...bucketReturnsByFund.entries()]
    .map(([id, returns]) => {
      const info = meta.get(id) || {};
      return {
        id,
        name: info.name || `#${id}`,
        investment_type: info.investment_type || null,
        platform: info.platform || null,
        category: info.category || null,
        returns: periodKeys.reduce((acc, key) => {
          acc[key] = returns.get(key) ?? null;
          return acc;
        }, {})
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const portfolioPoints = portfolioSeries.map((point) => ({ date: point.date, nav: point.index }));
  const portfolioReturn = portfolioSeries.length > 1
    ? pctChange(portfolioSeries[0].index, portfolioSeries[portfolioSeries.length - 1].index)
    : null;
  const portfolioRisk = riskStats(dailyReturns, portfolioPoints, portfolioReturn, riskFreePct);
  const dailySorted = [...dailyReturns].sort((a, b) => b.pct - a.pct);
  const periodPcts = periodRows.map((row) => row.change_pct).filter((pct) => pct !== null);

  const latestMovers = holdings
    .filter((holding) => holding.last_snapshot === lastDate
      && holding.trailing?.d1 !== null && holding.trailing?.d1 !== undefined)
    .map((holding) => ({
      id: holding.id,
      name: holding.name,
      pct: holding.trailing.d1,
      value: holding.current_value
    }))
    .sort((a, b) => b.pct - a.pct);

  const weights = holdings.map((holding) => holding.weight_pct || 0).sort((a, b) => b - a);
  const portfolioFlows = [...flowsById.values()].flat();

  return {
    generated_at: new Date().toISOString(),
    period: activePeriod,
    from: from || firstDate,
    to: to || lastDate,
    as_of: asOf,
    risk_free_pct: riskFreePct,
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
      xirr_pct: round(xirr([
        ...portfolioFlows,
        ...(currentValue > 0 ? [{ date: asOf, amount: currentValue }] : [])
      ])),
      first_date: firstDate,
      last_date: lastDate,
      snapshot_days: portfolioSeries.length,
      portfolio_return_pct: round(portfolioReturn),
      portfolio_cagr_pct: portfolioReturn !== null && firstDate && lastDate
        ? round(annualise(portfolioReturn, firstDate, lastDate))
        : null,
      volatility_pct: portfolioRisk.volatility_pct,
      downside_pct: portfolioRisk.downside_pct,
      sharpe: portfolioRisk.sharpe,
      sortino: portfolioRisk.sortino,
      max_drawdown_pct: portfolioSeries.length
        ? round(Math.min(...portfolioSeries.map((point) => point.drawdown_pct ?? 0)))
        : null,
      best_day: dailySorted[0] ? { date: dailySorted[0].date, pct: round(dailySorted[0].pct) } : null,
      worst_day: dailySorted.length
        ? { date: dailySorted[dailySorted.length - 1].date, pct: round(dailySorted[dailySorted.length - 1].pct) }
        : null,
      positive_days_pct: dailyReturns.length
        ? round((dailyReturns.filter((entry) => entry.pct > 0).length / dailyReturns.length) * 100)
        : null,
      positive_periods_pct: periodPcts.length
        ? round((periodPcts.filter((pct) => pct > 0).length / periodPcts.length) * 100)
        : null,
      best_period: periodRows.length
        ? periodRows.reduce((best, row) => ((row.change_pct ?? -Infinity) > (best.change_pct ?? -Infinity) ? row : best))
        : null,
      worst_period: periodRows.length
        ? periodRows.reduce((worst, row) => ((row.change_pct ?? Infinity) < (worst.change_pct ?? Infinity) ? row : worst))
        : null,
      best_holding: ranked[0] || null,
      worst_holding: ranked.length ? ranked[ranked.length - 1] : null,
      concentration: {
        top_weight_pct: weights.length ? round(weights[0]) : null,
        top5_weight_pct: round(weights.slice(0, 5).reduce((sum, weight) => sum + weight, 0)),
        hhi: round(weights.reduce((sum, weight) => sum + (weight / 100) ** 2, 0), 4)
      }
    },
    holdings,
    portfolio_series: portfolioSeries,
    rolling_returns: rollingReturns(portfolioSeries, [
      { id: 'r1m', label: 'Rolling 1M', days: 30 },
      { id: 'r3m', label: 'Rolling 3M', days: 91 },
      { id: 'r1y', label: 'Rolling 1Y (ann.)', days: 365 }
    ]),
    drawdowns: drawdownEpisodes(portfolioSeries),
    period_rows: periodRows,
    fund_period_matrix: { periods: periodRows.map(({ key, label }) => ({ key, label })), funds: fundMatrix },
    leaders: {
      best: ranked.slice(0, topN),
      worst: ranked.slice(-topN).reverse()
    },
    movers: {
      date: lastDate,
      gainers: latestMovers.filter((mover) => mover.pct > 0).slice(0, topN),
      losers: latestMovers.filter((mover) => mover.pct < 0).slice(-topN).reverse()
    },
    benchmark: benchmarkId
      ? buildBenchmark(benchmarkId, seriesByFund, meta, portfolioSeries, dailyReturns)
      : null,
    allocation: {
      by_type: groupTotals(holdings, (holding) => holding.investment_type),
      by_platform: groupTotals(holdings, (holding) => holding.platform),
      by_category: groupTotals(holdings, (holding) => holding.category)
    },
    data_quality: {
      stale_threshold_days: STALE_NAV_DAYS,
      no_history: holdings
        .filter((holding) => !holding.has_history)
        .map((holding) => ({ id: holding.id, name: holding.name, scheme_code: holding.scheme_code })),
      stale: holdings
        .filter((holding) => holding.stale_days !== null && holding.stale_days > STALE_NAV_DAYS)
        .map((holding) => ({
          id: holding.id,
          name: holding.name,
          last_snapshot: holding.last_snapshot,
          stale_days: holding.stale_days
        }))
        .sort((a, b) => b.stale_days - a.stale_days)
    }
  };
}

module.exports = { buildFundAnalytics, HOLDING_TYPES, PERIODS };
