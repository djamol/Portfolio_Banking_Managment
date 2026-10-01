/**
 * Fixed-deposit style analytics (FD / Bond / PPF / EPF): accrual, maturity
 * ladder, payout calendar and income projections derived from the deposit
 * fields on `investments`.
 */

const DEPOSIT_TYPES = ['FD', 'Bond', 'PPF', 'EPF'];
const DAY_MS = 86400000;
const DEFAULT_COMPOUNDING = 'quarterly';
const DEFAULT_PAYOUT = 'at-maturity';

const PERIODS_PER_YEAR = {
  monthly: 12,
  quarterly: 4,
  'half-yearly': 2,
  yearly: 1
};

const PAYOUT_FREQUENCIES = ['at-maturity', 'monthly', 'quarterly', 'half-yearly', 'yearly'];
const COMPOUNDING_OPTIONS = ['simple', 'monthly', 'quarterly', 'half-yearly', 'yearly'];

const RATE_BANDS = [
  { key: '< 6%', max: 6 },
  { key: '6 – 7%', max: 7 },
  { key: '7 – 7.5%', max: 7.5 },
  { key: '7.5 – 8%', max: 8 },
  { key: '8%+', max: Infinity }
];

const TENURE_BANDS = [
  { key: '< 1 year', maxMonths: 12 },
  { key: '1 – 2 years', maxMonths: 24 },
  { key: '2 – 3 years', maxMonths: 36 },
  { key: '3 – 5 years', maxMonths: 60 },
  { key: '5 years+', maxMonths: Infinity }
];

const MATURITY_TAG = /maturity\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i;
const MATURES_TAG = /matures?\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i;
const RATE_TAG = /(?:rate|roi|interest)\s*[:=]\s*(\d+(?:\.\d+)?)/i;
const PERCENT_TAG = /(\d+(?:\.\d+)?)\s*%/;

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
const daysBetween = (startIso, endIso) => Math.round((toUtc(endIso) - toUtc(startIso)) / DAY_MS);
const yearsBetween = (startIso, endIso) => daysBetween(startIso, endIso) / 365.25;

function addMonths(isoDate, months) {
  const date = toUtc(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return fromUtc(date);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthKeyOf(isoDate) {
  const [year, month] = isoDate.split('-');
  return { key: `${year}-${month}`, label: `${MONTH_NAMES[Number(month) - 1]} ${year}` };
}

function financialYearOf(isoDate) {
  const year = Number(isoDate.slice(0, 4));
  const startYear = isoDate.slice(5) >= '04-01' ? year : year - 1;
  return { key: String(startYear), label: `FY ${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}` };
}

function parseMaturityFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(MATURITY_TAG) || String(notes).match(MATURES_TAG);
  return match ? match[1] : null;
}

function parseRateFromNotes(notes) {
  if (!notes) return null;
  const text = String(notes);
  const match = text.match(RATE_TAG) || text.match(PERCENT_TAG);
  if (!match) return null;
  const rate = Number(match[1]);
  return rate > 0 && rate <= 30 ? rate : null;
}

function normaliseFrequency(value, allowed, fallback) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (allowed.includes(key)) return key;
  if (key === 'cumulative' || key === 'maturity') return 'at-maturity';
  if (key === 'annual' || key === 'annually') return 'yearly';
  if (key === 'semi-annual' || key === 'semi-annually') return 'half-yearly';
  return fallback;
}

/** Deposit value at `asOf` for a cumulative deposit (interest reinvested). */
function compoundedValue(principal, ratePct, startIso, asOfIso, compounding) {
  const years = Math.max(yearsBetween(startIso, asOfIso), 0);
  if (!principal || !ratePct || years === 0) return principal;
  if (compounding === 'simple') return principal * (1 + (ratePct / 100) * years);
  const n = PERIODS_PER_YEAR[compounding] || 4;
  return principal * (1 + ratePct / (100 * n)) ** (n * years);
}

/** Interest payout dates and amounts for a non-cumulative deposit. */
function payoutSchedule(deposit, horizonEndIso) {
  const perYear = PERIODS_PER_YEAR[deposit.payout_frequency];
  if (!perYear || !deposit.maturity_date || !deposit.interest_rate || !deposit.principal) return [];

  const monthsPerPayout = 12 / perYear;
  const amount = (deposit.principal * deposit.interest_rate) / (100 * perYear);
  const schedule = [];
  let index = 1;

  for (;;) {
    const date = addMonths(deposit.investment_date, monthsPerPayout * index);
    if (date > deposit.maturity_date || date > horizonEndIso) break;
    schedule.push({ date, amount: round(amount), kind: 'interest' });
    index += 1;
    if (index > 600) break;
  }
  return schedule;
}

function bandOf(bands, value, field) {
  if (value === null || value === undefined) return 'Unspecified';
  return (bands.find((band) => value < band[field]) || bands[bands.length - 1]).key;
}

function buildDeposit(investment, asOf, taxRatePct) {
  const bookAmount = num(investment.amount);
  const isClosed = bookAmount <= 0.009;
  const principal = num(investment.invested_amount) || bookAmount;
  const startDate = toIsoDate(investment.investment_date);
  const maturityDate = toIsoDate(investment.maturity_date) || parseMaturityFromNotes(investment.notes);
  const rate = num(investment.interest_rate) || parseRateFromNotes(investment.notes) || null;
  const payoutFrequency = normaliseFrequency(investment.payout_frequency, PAYOUT_FREQUENCIES, DEFAULT_PAYOUT);
  const compounding = normaliseFrequency(investment.compounding, COMPOUNDING_OPTIONS, DEFAULT_COMPOUNDING);
  const isCumulative = payoutFrequency === 'at-maturity';

  const tenureDays = maturityDate && startDate ? daysBetween(startDate, maturityDate) : null;
  const tenureMonths = tenureDays !== null ? round(tenureDays / 30.44, 1) : null;
  const matured = isClosed || Boolean(maturityDate && maturityDate <= asOf);
  const daysToMaturity = isClosed ? null : (maturityDate ? daysBetween(asOf, maturityDate) : null);
  const elapsedDays = startDate ? Math.max(daysBetween(startDate, asOf), 0) : null;
  const progressPct = isClosed ? 100 : (tenureDays && tenureDays > 0 && elapsedDays !== null
    ? round(Math.min((elapsedDays / tenureDays) * 100, 100), 1)
    : null);

  const accrualDate = matured && maturityDate ? maturityDate : asOf;
  let maturityAmount = num(investment.maturity_amount) || null;
  let totalInterest = null;
  let accruedInterest = 0;
  let receivedInterest = 0;
  let currentValue = isClosed ? 0 : principal;
  let periodicPayout = null;

  if (rate && startDate) {
    if (isCumulative) {
      if (!maturityAmount && maturityDate) {
        maturityAmount = round(compoundedValue(principal, rate, startDate, maturityDate, compounding));
      }
      totalInterest = maturityAmount !== null ? round(maturityAmount - principal) : null;
      if (isClosed) {
        currentValue = 0;
        accruedInterest = 0;
        receivedInterest = totalInterest || 0;
      } else {
        currentValue = round(compoundedValue(principal, rate, startDate, accrualDate, compounding));
        accruedInterest = round((currentValue || 0) - principal);
        receivedInterest = 0;
      }
    } else {
      const perYear = PERIODS_PER_YEAR[payoutFrequency] || 1;
      periodicPayout = isClosed ? null : round((principal * rate) / (100 * perYear));
      maturityAmount = maturityAmount || principal;
      currentValue = isClosed ? 0 : principal;
      accruedInterest = 0;
      const paidPeriods = Math.floor(Math.max(yearsBetween(startDate, accrualDate), 0) * perYear);
      receivedInterest = round(paidPeriods * (((principal * rate) / (100 * perYear)) || 0));
      totalInterest = tenureDays !== null
        ? round((principal * rate / 100) * (tenureDays / 365.25))
        : null;
    }
  } else if (maturityAmount) {
    totalInterest = round(maturityAmount - principal);
    accruedInterest = 0;
    receivedInterest = isClosed ? (totalInterest || 0) : 0;
    currentValue = isClosed ? 0 : principal;
  }

  const earnedInterest = isClosed
    ? (totalInterest || 0)
    : round((accruedInterest || 0) + (receivedInterest || 0));

  // Back out the implied rate when only principal and maturity value are known.
  const impliedRate = !rate && maturityAmount && principal > 0 && tenureDays
    ? round(((maturityAmount / principal) ** (365.25 / tenureDays) - 1) * 100)
    : null;

  const annualIncome = isClosed || !rate ? 0 : round((principal * rate) / 100);
  const taxRate = num(taxRatePct);
  const postTaxRate = rate !== null ? round(rate * (1 - taxRate / 100)) : null;

  return {
    id: Number(investment.id),
    name: [investment.sub_type_name, investment.sub_type_category].filter(Boolean).join(' - ')
      || investment.website_app_name
      || `Deposit #${investment.id}`,
    investment_type: investment.investment_type,
    platform: investment.website_app_name || null,
    sub_type_name: investment.sub_type_name || null,
    category: investment.sub_type_category || null,
    investment_date: startDate,
    maturity_date: maturityDate,
    maturity_source: investment.maturity_date ? 'field' : (maturityDate ? 'notes' : null),
    interest_rate: rate,
    rate_source: num(investment.interest_rate) ? 'field' : (rate ? 'notes' : null),
    implied_rate_pct: impliedRate,
    post_tax_rate_pct: postTaxRate,
    payout_frequency: payoutFrequency,
    compounding: isCumulative ? compounding : null,
    principal: round(principal),
    book_amount: round(bookAmount),
    current_value: round(currentValue),
    maturity_amount: maturityAmount !== null ? round(maturityAmount) : null,
    total_interest: totalInterest,
    post_tax_interest: totalInterest !== null ? round(totalInterest * (1 - taxRate / 100)) : null,
    accrued_interest: accruedInterest,
    received_interest: receivedInterest,
    earned_interest: earnedInterest,
    pending_interest: isClosed ? 0 : (totalInterest !== null
      ? round(Math.max(totalInterest - earnedInterest, 0))
      : null),
    periodic_payout: periodicPayout,
    annual_income: annualIncome,
    monthly_income: annualIncome ? round(annualIncome / 12) : null,
    tenure_days: tenureDays,
    tenure_months: tenureMonths,
    tenure_band: bandOf(TENURE_BANDS, tenureMonths, 'maxMonths'),
    rate_band: bandOf(RATE_BANDS, rate, 'max'),
    days_to_maturity: daysToMaturity,
    progress_pct: progressPct,
    matured,
    is_closed: isClosed,
    is_cumulative: isCumulative,
    notes: investment.notes || null
  };
}

function groupTotals(deposits, keyOf) {
  const groups = new Map();
  for (const deposit of deposits) {
    const key = keyOf(deposit) || 'Unspecified';
    if (!groups.has(key)) {
      groups.set(key, {
        key, count: 0, principal: 0, current_value: 0, maturity_amount: 0,
        interest: 0, rateWeight: 0, ratedPrincipal: 0
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.principal += deposit.principal || 0;
    group.current_value += deposit.current_value || 0;
    group.maturity_amount += deposit.maturity_amount ?? deposit.principal ?? 0;
    group.interest += deposit.total_interest || 0;
    if (deposit.interest_rate) {
      group.rateWeight += deposit.interest_rate * (deposit.principal || 0);
      group.ratedPrincipal += deposit.principal || 0;
    }
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.current_value, 0);
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      count: group.count,
      principal: round(group.principal),
      current_value: round(group.current_value),
      maturity_amount: round(group.maturity_amount),
      interest: round(group.interest),
      avg_rate_pct: group.ratedPrincipal > 0 ? round(group.rateWeight / group.ratedPrincipal) : null,
      weight_pct: total > 0 ? round((group.current_value / total) * 100) : null
    }))
    .sort((a, b) => b.current_value - a.current_value);
}

/** Maturity proceeds grouped into calendar buckets. */
function maturityLadder(deposits, keyOf) {
  const buckets = new Map();
  for (const deposit of deposits) {
    if (!deposit.maturity_date) continue;
    const { key, label } = keyOf(deposit.maturity_date);
    if (!buckets.has(key)) {
      buckets.set(key, { key, label, count: 0, principal: 0, maturity_amount: 0, interest: 0, deposits: [] });
    }
    const bucket = buckets.get(key);
    const maturityValue = deposit.maturity_amount ?? deposit.principal ?? 0;
    bucket.count += 1;
    bucket.principal += deposit.principal || 0;
    bucket.maturity_amount += maturityValue;
    bucket.interest += maturityValue - (deposit.principal || 0);
    bucket.deposits.push({ id: deposit.id, name: deposit.name, amount: round(maturityValue) });
  }
  return [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      ...bucket,
      principal: round(bucket.principal),
      maturity_amount: round(bucket.maturity_amount),
      interest: round(bucket.interest)
    }));
}

/** Month-by-month expected cash inflow: periodic interest plus maturity proceeds. */
function cashflowCalendar(deposits, asOf, months) {
  const horizonEnd = addMonths(asOf, months);
  const buckets = new Map();

  const ensure = (date) => {
    const { key, label } = monthKeyOf(date);
    if (!buckets.has(key)) buckets.set(key, { key, label, interest: 0, maturity: 0, total: 0 });
    return buckets.get(key);
  };

  for (let i = 0; i < months; i += 1) ensure(addMonths(asOf, i));

  for (const deposit of deposits) {
    if (deposit.matured) continue;
    for (const payout of payoutSchedule(deposit, horizonEnd)) {
      if (payout.date < asOf) continue;
      const bucket = ensure(payout.date);
      bucket.interest += payout.amount || 0;
    }
    if (deposit.maturity_date && deposit.maturity_date >= asOf && deposit.maturity_date <= horizonEnd) {
      const bucket = ensure(deposit.maturity_date);
      bucket.maturity += deposit.maturity_amount ?? deposit.principal ?? 0;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      interest: round(bucket.interest),
      maturity: round(bucket.maturity),
      total: round(bucket.interest + bucket.maturity)
    }));
}

/** Monthly locked vs released value across the whole deposit book. */
function valueProjection(deposits, asOf) {
  const dated = deposits.filter((deposit) => deposit.investment_date);
  if (!dated.length) return [];

  const start = dated.reduce((min, deposit) => (deposit.investment_date < min ? deposit.investment_date : min),
    dated[0].investment_date);
  const maturities = dated.map((deposit) => deposit.maturity_date).filter(Boolean);
  const end = maturities.length ? maturities.reduce((max, date) => (date > max ? date : max)) : asOf;

  const points = [];
  let cursor = `${start.slice(0, 7)}-01`;
  let guard = 0;

  while (cursor <= end && guard < 600) {
    let locked = 0;
    let released = 0;
    let accrued = 0;
    let active = 0;

    for (const deposit of dated) {
      if (deposit.investment_date > cursor) continue;
      const matured = deposit.is_closed || (deposit.maturity_date && deposit.maturity_date <= cursor);
      if (matured) {
        released += deposit.maturity_amount ?? deposit.principal ?? 0;
        continue;
      }
      active += 1;
      const value = deposit.is_cumulative && deposit.interest_rate
        ? compoundedValue(deposit.principal, deposit.interest_rate, deposit.investment_date, cursor,
          deposit.compounding || DEFAULT_COMPOUNDING)
        : deposit.principal;
      locked += value;
      accrued += value - (deposit.principal || 0);
    }

    const { key, label } = monthKeyOf(cursor);
    points.push({
      key,
      label,
      date: cursor,
      locked: round(locked),
      released: round(released),
      accrued: round(accrued),
      total: round(locked + released),
      active,
      projected: cursor > asOf
    });
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return points;
}

function windowSummary(deposits, asOf, days) {
  const end = fromUtc(new Date(toUtc(asOf).getTime() + days * DAY_MS));
  const matching = deposits.filter((deposit) => deposit.maturity_date
    && deposit.maturity_date >= asOf
    && deposit.maturity_date <= end);
  return {
    days,
    until: end,
    count: matching.length,
    principal: round(matching.reduce((sum, deposit) => sum + (deposit.principal || 0), 0)),
    proceeds: round(matching.reduce((sum, deposit) => sum + (deposit.maturity_amount ?? deposit.principal ?? 0), 0))
  };
}

/**
 * @param {object} input
 * @param {object[]} input.investments live investment rows (any type)
 * @param {string} [input.asOf] valuation date, defaults to today
 */
function buildFdAnalytics({
  investments,
  asOf = null,
  taxRatePct = 0,
  horizonMonths = 24,
  filters = {}
}) {
  const valuationDate = asOf || fromUtc(new Date());
  const depositRows = investments.filter((row) => DEPOSIT_TYPES.includes(row.investment_type));

  const options = {
    types: [...new Set(depositRows.map((row) => row.investment_type).filter(Boolean))].sort(),
    platforms: [...new Set(depositRows.map((row) => row.website_app_name).filter(Boolean))].sort(),
    categories: [...new Set(depositRows
      .map((row) => row.sub_type_category || row.sub_type_name)
      .filter(Boolean))].sort(),
    payout_frequencies: PAYOUT_FREQUENCIES,
    compounding: COMPOUNDING_OPTIONS
  };

  const selected = depositRows.filter((row) => {
    if (filters.types?.length && !filters.types.includes(row.investment_type)) return false;
    if (filters.platforms?.length && !filters.platforms.includes(row.website_app_name)) return false;
    if (filters.categories?.length
      && !filters.categories.includes(row.sub_type_category || row.sub_type_name)) return false;
    return true;
  });

  const deposits = selected
    .map((row) => buildDeposit(row, valuationDate, taxRatePct))
    .sort((a, b) => {
      if (a.is_closed !== b.is_closed) return a.is_closed ? 1 : -1;
      if (a.matured !== b.matured) return a.matured ? 1 : -1;
      if (!a.maturity_date && b.maturity_date) return 1;
      if (a.maturity_date && !b.maturity_date) return -1;
      return (a.maturity_date || '').localeCompare(b.maturity_date || '');
    });

  const active = deposits.filter((deposit) => !deposit.matured && !deposit.is_closed && (deposit.current_value || 0) > 0);
  const matured = deposits.filter((deposit) => deposit.matured || deposit.is_closed || (deposit.current_value || 0) <= 0);
  const withRate = active.filter((deposit) => deposit.interest_rate !== null);

  const activePrincipal = active.reduce((sum, deposit) => sum + (deposit.principal || 0), 0);
  const totalPrincipal = deposits.reduce((sum, deposit) => sum + (deposit.principal || 0), 0);
  const currentValue = active.reduce((sum, deposit) => sum + (deposit.current_value || 0), 0);
  const maturityValue = active.reduce(
    (sum, deposit) => sum + (deposit.maturity_amount ?? deposit.principal ?? 0), 0
  );
  const accrued = active.reduce((sum, deposit) => sum + (deposit.accrued_interest || 0), 0);
  const received = deposits.reduce((sum, deposit) => sum + (deposit.received_interest || 0), 0);
  const activeInterest = active.reduce((sum, deposit) => sum + (deposit.total_interest || 0), 0);
  const pendingInterest = active.reduce((sum, deposit) => sum + (deposit.pending_interest || 0), 0);
  const totalInterest = deposits.reduce((sum, deposit) => sum + (deposit.total_interest || 0), 0);

  const rateWeight = withRate.reduce((sum, deposit) => sum + deposit.interest_rate * (deposit.principal || 0), 0);
  const rateBase = withRate.reduce((sum, deposit) => sum + (deposit.principal || 0), 0);
  const tenureWeight = active.reduce(
    (sum, deposit) => sum + (deposit.days_to_maturity || 0) * (deposit.principal || 0), 0
  );

  const annualIncome = active.reduce((sum, deposit) => sum + (deposit.annual_income || 0), 0);
  const payoutIncome = active
    .filter((deposit) => !deposit.is_cumulative)
    .reduce((sum, deposit) => sum + (deposit.annual_income || 0), 0);

  const bestRate = withRate.length
    ? withRate.reduce((best, deposit) => (deposit.interest_rate > best.interest_rate ? deposit : best))
    : null;
  const worstRate = withRate.length
    ? withRate.reduce((worst, deposit) => (deposit.interest_rate < worst.interest_rate ? deposit : worst))
    : null;
  const nextMaturity = active
    .filter((deposit) => deposit.maturity_date && deposit.maturity_date >= valuationDate)
    .sort((a, b) => a.maturity_date.localeCompare(b.maturity_date))[0] || null;

  return {
    generated_at: new Date().toISOString(),
    as_of: valuationDate,
    tax_rate_pct: num(taxRatePct),
    horizon_months: horizonMonths,
    options,
    applied_filters: {
      types: filters.types || [],
      platforms: filters.platforms || [],
      categories: filters.categories || []
    },
    summary: {
      deposits: deposits.length,
      active: active.length,
      matured: matured.length,
      principal: round(activePrincipal),
      total_principal: round(totalPrincipal),
      current_value: round(currentValue),
      maturity_value: round(maturityValue),
      accrued_interest: round(accrued),
      received_interest: round(received),
      earned_interest: round(accrued + received),
      pending_interest: round(pendingInterest),
      total_interest: round(activeInterest),
      lifetime_interest: round(totalInterest),
      post_tax_interest: round(activeInterest * (1 - num(taxRatePct) / 100)),
      avg_rate_pct: rateBase > 0 ? round(rateWeight / rateBase) : null,
      post_tax_avg_rate_pct: rateBase > 0
        ? round((rateWeight / rateBase) * (1 - num(taxRatePct) / 100))
        : null,
      avg_remaining_years: activePrincipal > 0 ? round(tenureWeight / activePrincipal / 365.25, 2) : null,
      annual_income: round(annualIncome),
      monthly_income: round(annualIncome / 12),
      payout_annual_income: round(payoutIncome),
      best_rate: bestRate && { id: bestRate.id, name: bestRate.name, rate: bestRate.interest_rate },
      worst_rate: worstRate && { id: worstRate.id, name: worstRate.name, rate: worstRate.interest_rate },
      next_maturity: nextMaturity && {
        id: nextMaturity.id,
        name: nextMaturity.name,
        date: nextMaturity.maturity_date,
        days: nextMaturity.days_to_maturity,
        amount: nextMaturity.maturity_amount ?? nextMaturity.principal
      },
      maturing: [30, 90, 180, 365].map((days) => windowSummary(active, valuationDate, days)),
      overdue: active
        .filter((deposit) => deposit.maturity_date && deposit.maturity_date < valuationDate)
        .map((deposit) => ({
          id: deposit.id,
          name: deposit.name,
          maturity_date: deposit.maturity_date,
          days_overdue: Math.abs(daysBetween(deposit.maturity_date, valuationDate)),
          amount: deposit.current_value || deposit.maturity_amount || deposit.principal
        }))
    },
    deposits,
    ladder: {
      by_month: maturityLadder(deposits, monthKeyOf),
      by_year: maturityLadder(deposits, (date) => ({ key: date.slice(0, 4), label: date.slice(0, 4) })),
      by_financial_year: maturityLadder(deposits, financialYearOf)
    },
    cashflow_calendar: cashflowCalendar(deposits, valuationDate, horizonMonths),
    value_projection: valueProjection(deposits, valuationDate),
    allocation: {
      by_platform: groupTotals(deposits, (deposit) => deposit.platform),
      by_type: groupTotals(deposits, (deposit) => deposit.investment_type),
      by_category: groupTotals(deposits, (deposit) => deposit.category),
      by_rate_band: groupTotals(deposits, (deposit) => deposit.rate_band),
      by_tenure_band: groupTotals(deposits, (deposit) => deposit.tenure_band),
      by_payout: groupTotals(deposits, (deposit) => deposit.payout_frequency)
    },
    data_quality: {
      missing_rate: active.filter((deposit) => deposit.interest_rate === null)
        .map((deposit) => ({ id: deposit.id, name: deposit.name })),
      missing_maturity: active.filter((deposit) => !deposit.maturity_date)
        .map((deposit) => ({ id: deposit.id, name: deposit.name })),
      from_notes: active.filter((deposit) => deposit.maturity_source === 'notes' || deposit.rate_source === 'notes')
        .map((deposit) => ({
          id: deposit.id,
          name: deposit.name,
          maturity_source: deposit.maturity_source,
          rate_source: deposit.rate_source
        }))
    }
  };
}

module.exports = {
  buildFdAnalytics,
  DEPOSIT_TYPES,
  PAYOUT_FREQUENCIES,
  COMPOUNDING_OPTIONS
};
