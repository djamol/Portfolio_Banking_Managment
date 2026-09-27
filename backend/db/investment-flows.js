const { isMongoDb, getPool, getMongoDb } = require('../config/index');

const HOLDING_TYPES = ['Mutual Fund', 'ETF'];
const DIVIDEND_RE = /DIVIDEND|\bDIV\b|\bDIV[-\/]|FINAL\s*DIV|INTERIM\s*DIV|\bINTDIV/i;
const BROKER_RE = /ZERODHA\s*BROK|NSE\s*CLEARING|NSCCL|\bNSE\b|\bBSE\b(?!\s*STAR)|\bPAYOUT\b|TRADING|RAISE\s*SECU|RAISESECURITIES|MONEYLICIO|UPSTOX|RKSV|ANGEL\s*(ONE|BROK)/i;
const STALE_DAYS = 45;
const DAY_MS = 86400000;

const PLATFORM_PATTERNS = [
  ['Zerodha', /ZERODHA|\bCOIN\s*BY\s*ZERODHA/i],
  ['Groww', /GROWW|NEXTBILLION/i],
  ['Dhan', /\bDHAN\b|RAISE\s*SECU|RAISESECURITIES|MONEYLICIO/i],
  ['Kuvera', /KUVERA/i],
  ['Paytm Money', /PAYTM\s*MONEY/i],
  ['Upstox', /UPSTOX|RKSV/i],
  ['Angel One', /ANGEL\s*(ONE|BROK)/i],
  ['ICICI Direct', /ICICI\s*SEC|ICICIDIRECT/i],
  ['HDFC Securities', /HDFC\s*SEC/i],
  ['Kotak Securities', /KOTAK\s*SEC/i],
  ['Axis InvestNow', /INVESTNOW/i],
  ['BSE StAR MF', /BSESTARMF|BSE\s*STAR/i],
  ['ICCL (BSE Clearing)', /INDIAN\s*CLEARING|INDIANCLEARING|CLEARING\s*CORPORATION|\bICCL\b/i],
  ['NSE Clearing', /NSE\s*CLEARING|NSCCL/i],
  ['CAMS', /\bCAMS\b/i],
  ['KFintech', /KFIN|KARVY/i],
  ['Shriram', /SHRIRAM/i]
];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ymd(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function fyLabel(date) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function platformKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function detectPlatform(row) {
  const text = `${row.narration || ''} ${row.payee || ''}`;
  for (const [name, re] of PLATFORM_PATTERNS) {
    if (re.test(text)) return name;
  }
  const amc = text.match(/([A-Z][A-Z&. ]{2,40}?)\s*MUTUAL\s*FUND/i);
  if (amc) return `${titleCase(amc[1])} MF`;
  return row.payee ? String(row.payee).slice(0, 60) : 'Other';
}

/** purchase | redemption | dividend | null */
function classifyTxn(row) {
  const cat = String(row.category || '');
  const text = `${row.narration || ''} ${row.payee || ''}`;
  const w = num(row.withdrawal);
  const d = num(row.deposit);
  if (/^Investment_FD/i.test(cat) || /fixed deposit/i.test(cat)) return null;
  if (d > 0 && w <= 0 && DIVIDEND_RE.test(text) && !/Income_Interest/i.test(cat)) return 'dividend';
  const isInvestment = /^Investment_/i.test(cat) || /mutual|\betf\b/i.test(cat);
  if (!isInvestment) return null;
  if (w > 0) return 'purchase';
  if (d > 0) return 'redemption';
  return null;
}

function channelOf(row) {
  const text = `${row.narration || ''} ${row.payee || ''}`;
  if (row.category === 'Investment_Broker_Trading' || BROKER_RE.test(text)) return 'Broker / ETF';
  return 'Mutual Fund';
}

/** XIRR (% p.a.) via bisection; flows: [{ date, amount }] with outflows negative */
function xirr(flows) {
  if (!flows || flows.length < 2) return null;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...flows.map((f) => Date.parse(f.date)));
  const pts = flows.map((f) => ({ t: (Date.parse(f.date) - t0) / (365 * DAY_MS), a: f.amount }));
  if (pts.every((p) => p.t < 30 / 365)) return null;
  const npv = (r) => pts.reduce((s, p) => s + p.a / Math.pow(1 + r, p.t), 0);
  let lo = -0.99;
  let hi = 10;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) return null;
  let mid = 0;
  for (let i = 0; i < 200; i += 1) {
    mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-4) break;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return mid * 100;
}

/* ---------- data access ---------- */

async function fetchCandidateTxns(filters) {
  if (isMongoDb()) {
    const q = {
      $or: [
        { category: /^Investment_/ },
        { category: /mutual|etf/i },
        { deposit: { $gt: 0 }, narration: /DIV/i }
      ]
    };
    if (filters.account_id) q.account_id = Number(filters.account_id);
    if (filters.from || filters.to) {
      q.txn_date = {};
      if (filters.from) q.txn_date.$gte = filters.from;
      if (filters.to) q.txn_date.$lte = filters.to;
    }
    const rows = await getMongoDb().collection('bank_transactions').find(q).toArray();
    const accounts = await getMongoDb().collection('bank_accounts').find({}).toArray();
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    return rows.map(({ _id, ...r }) => ({
      ...r,
      bank_name: accMap.get(r.account_id)?.bank_name,
      account_name: accMap.get(r.account_id)?.account_name
    }));
  }
  const where = [
    `(t.category LIKE 'Investment\\_%' OR t.category LIKE '%Mutual%' OR t.category LIKE '%ETF%' OR (t.deposit > 0 AND t.narration LIKE '%DIV%'))`
  ];
  const params = [];
  if (filters.account_id) {
    where.push('t.account_id = ?');
    params.push(Number(filters.account_id));
  }
  if (filters.from) {
    where.push('t.txn_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('t.txn_date <= ?');
    params.push(filters.to);
  }
  const [rows] = await getPool().query(
    `SELECT t.id, t.account_id, t.txn_date, t.narration, t.payee, t.withdrawal, t.deposit,
            t.category, t.txn_type, a.bank_name, a.account_name
     FROM bank_transactions t
     JOIN bank_accounts a ON a.id = t.account_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.txn_date ASC, t.id ASC`,
    params
  );
  return rows;
}

async function fetchHoldings() {
  if (isMongoDb()) {
    const db = getMongoDb();
    const investments = (
      await db.collection('investments').find({ investment_type: { $in: HOLDING_TYPES } }).toArray()
    ).map(({ _id, ...r }) => r);
    const ids = investments.map((i) => i.id);
    const history = ids.length
      ? (
          await db
            .collection('investment_history')
            .find({ investment_id: { $in: ids } })
            .sort({ change_date: 1, id: 1 })
            .toArray()
        ).map(({ _id, ...r }) => r)
      : [];
    return { investments, history };
  }
  const pool = getPool();
  const [investments] = await pool.query(
    `SELECT * FROM investments WHERE investment_type IN (?, ?)`,
    HOLDING_TYPES
  );
  const [history] = await pool.query(
    `SELECT ih.investment_id, ih.amount, ih.invested_amount, ih.change_date, ih.change_type, ih.id
     FROM investment_history ih
     JOIN investments i ON i.id = ih.investment_id
     WHERE i.investment_type IN (?, ?)
     ORDER BY ih.change_date ASC, ih.id ASC`,
    HOLDING_TYPES
  );
  return { investments, history };
}

/* ---------- aggregation ---------- */

function buildBankSide(rows) {
  const txns = [];
  for (const r of rows) {
    const kind = classifyTxn(r);
    if (!kind) continue;
    txns.push({
      id: r.id,
      date: ymd(r.txn_date),
      kind,
      amount: kind === 'purchase' ? num(r.withdrawal) : num(r.deposit),
      platform: kind === 'dividend' && !r.payee && detectPlatform(r) === 'Other' ? 'Dividend credits' : detectPlatform(r),
      channel: kind === 'dividend' ? 'Dividend' : channelOf(r),
      narration: r.narration,
      category: r.category,
      account: [r.bank_name, r.account_name].filter(Boolean).join(' · ')
    });
  }
  txns.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const summary = {
    invested: 0,
    redeemed: 0,
    dividends: 0,
    net_invested: 0,
    txn_count: txns.length,
    purchase_count: 0,
    redemption_count: 0,
    first_date: txns[0]?.date || null,
    last_date: txns[txns.length - 1]?.date || null,
    mf_invested: 0,
    broker_invested: 0
  };
  const monthMap = {};
  const fyMap = {};
  const platformMap = {};

  for (const t of txns) {
    const month = t.date.slice(0, 7);
    const fy = fyLabel(t.date);
    monthMap[month] ||= { month, invested: 0, redeemed: 0, dividends: 0, net: 0, txn_count: 0 };
    fyMap[fy] ||= { fy, invested: 0, redeemed: 0, dividends: 0, net: 0, txn_count: 0 };
    platformMap[t.platform] ||= {
      platform: t.platform,
      invested: 0,
      redeemed: 0,
      dividends: 0,
      net: 0,
      txn_count: 0,
      first_date: t.date,
      last_date: t.date,
      channel: t.channel
    };
    const buckets = [monthMap[month], fyMap[fy], platformMap[t.platform]];
    const field = t.kind === 'purchase' ? 'invested' : t.kind === 'redemption' ? 'redeemed' : 'dividends';
    for (const b of buckets) {
      b[field] += t.amount;
      b.txn_count += 1;
      b.net = b.invested - b.redeemed;
    }
    platformMap[t.platform].last_date = t.date;
    if (t.kind !== 'dividend' && platformMap[t.platform].channel === 'Dividend') {
      platformMap[t.platform].channel = t.channel;
    }

    if (t.kind === 'purchase') {
      summary.invested += t.amount;
      summary.purchase_count += 1;
      if (t.channel === 'Mutual Fund') summary.mf_invested += t.amount;
      else summary.broker_invested += t.amount;
    } else if (t.kind === 'redemption') {
      summary.redeemed += t.amount;
      summary.redemption_count += 1;
    } else {
      summary.dividends += t.amount;
    }
  }
  summary.net_invested = summary.invested - summary.redeemed;

  const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  let cumulative = 0;
  for (const m of byMonth) {
    cumulative += m.net;
    m.cumulative_net = cumulative;
  }
  const activeMonths = byMonth.filter((m) => m.invested > 0);
  summary.active_months = activeMonths.length;
  summary.avg_monthly_invested = activeMonths.length ? summary.invested / activeMonths.length : 0;
  const best = [...byMonth].sort((a, b) => b.invested - a.invested)[0];
  summary.best_month = best && best.invested > 0 ? { month: best.month, invested: best.invested } : null;

  return {
    txns,
    summary,
    byMonth,
    byFy: Object.values(fyMap).sort((a, b) => a.fy.localeCompare(b.fy)),
    byPlatform: Object.values(platformMap).sort((a, b) => b.invested - a.invested),
    sips: detectSips(txns)
  };
}

/** Same platform + same amount debited in 3+ distinct months → SIP-like */
function detectSips(txns) {
  const groups = {};
  for (const t of txns) {
    if (t.kind !== 'purchase') continue;
    const key = `${t.platform}|${Math.round(t.amount)}`;
    (groups[key] ||= []).push(t);
  }
  const refDate = txns.length ? txns[txns.length - 1].date : ymd(new Date());
  const sips = [];
  for (const list of Object.values(groups)) {
    const months = [...new Set(list.map((t) => t.date.slice(0, 7)))];
    if (months.length < 3) continue;
    const first = list[0].date;
    const last = list[list.length - 1].date;
    const [fy, fm] = first.slice(0, 7).split('-').map(Number);
    const [ly, lm] = last.slice(0, 7).split('-').map(Number);
    const span = (ly - fy) * 12 + (lm - fm) + 1;
    const days = list.map((t) => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    const lastD = new Date(`${last}T00:00:00Z`);
    lastD.setUTCMonth(lastD.getUTCMonth() + 1);
    sips.push({
      platform: list[0].platform,
      channel: list[0].channel,
      amount: Math.round(list[0].amount * 100) / 100,
      installments: list.length,
      months_paid: months.length,
      months_span: span,
      consistency_pct: span ? Math.min(100, (months.length / span) * 100) : 100,
      total: list.reduce((s, t) => s + t.amount, 0),
      typical_day: days[Math.floor(days.length / 2)],
      first_date: first,
      last_date: last,
      next_expected: lastD.toISOString().slice(0, 10),
      active: daysBetween(last, refDate) <= 40
    });
  }
  return sips.sort((a, b) => Number(b.active) - Number(a.active) || b.amount - a.amount);
}

function buildHoldings({ investments, history }) {
  const today = ymd(new Date());
  const histByInv = {};
  for (const h of history) {
    (histByInv[h.investment_id] ||= []).push({ ...h, change_date: ymd(h.change_date) });
  }
  for (const list of Object.values(histByInv)) {
    list.sort((a, b) => a.change_date.localeCompare(b.change_date) || num(a.id) - num(b.id));
  }

  const items = [];
  for (const inv of investments) {
    const hist = histByInv[inv.id] || [];
    const latest = hist[hist.length - 1];
    const current = latest ? num(latest.amount) : num(inv.amount);
    let invested = num(inv.invested_amount) > 0 ? num(inv.invested_amount) : null;
    if (invested == null && latest && num(latest.invested_amount) > 0) invested = num(latest.invested_amount);
    if (invested == null && inv.profit_loss != null && inv.profit_loss !== '') {
      invested = current - num(inv.profit_loss);
    }
    const asOf = latest?.change_date || ymd(inv.investment_date) || null;
    if (current <= 0 && !invested) continue;
    const gain = invested != null ? current - invested : null;
    items.push({
      id: inv.id,
      name: inv.mutual_fund_scheme_name || inv.sub_type_category || inv.sub_type_name || inv.website_app_name,
      type: inv.investment_type,
      platform: inv.website_app_name || '—',
      group: inv.sub_type_name || '—',
      category: inv.sub_type_category || '—',
      scheme_code: inv.mutual_fund_scheme_code || null,
      units: inv.units != null ? num(inv.units) : null,
      nav: inv.nav_price != null ? num(inv.nav_price) : null,
      avg_cost: inv.avg_buy_price != null ? num(inv.avg_buy_price) : null,
      invested,
      current,
      gain,
      gain_pct: invested ? (gain / invested) * 100 : null,
      as_of: asOf,
      stale_days: asOf ? daysBetween(asOf, today) : null,
      weight_pct: 0
    });
  }

  const totalCurrent = items.reduce((s, i) => s + i.current, 0);
  for (const i of items) i.weight_pct = totalCurrent ? (i.current / totalCurrent) * 100 : 0;
  items.sort((a, b) => b.current - a.current);

  const summarize = (list) => {
    const withCost = list.filter((i) => i.invested != null);
    const invested = withCost.reduce((s, i) => s + i.invested, 0);
    const currentWithCost = withCost.reduce((s, i) => s + i.current, 0);
    const current = list.reduce((s, i) => s + i.current, 0);
    return {
      count: list.length,
      current,
      invested,
      gain: currentWithCost - invested,
      gain_pct: invested ? ((currentWithCost - invested) / invested) * 100 : null,
      gainers: list.filter((i) => (i.gain || 0) > 0).length,
      losers: list.filter((i) => (i.gain || 0) < 0).length,
      missing_cost: list.length - withCost.length
    };
  };

  const groupBy = (field) => {
    const map = {};
    for (const i of items) {
      const k = i[field] || '—';
      map[k] ||= { key: k, current: 0, invested: 0, gain: 0, count: 0 };
      map[k].current += i.current;
      map[k].count += 1;
      if (i.invested != null) {
        map[k].invested += i.invested;
        map[k].gain += i.gain;
      }
    }
    return Object.values(map)
      .map((g) => ({
        ...g,
        weight_pct: totalCurrent ? (g.current / totalCurrent) * 100 : 0,
        gain_pct: g.invested ? (g.gain / g.invested) * 100 : null
      }))
      .sort((a, b) => b.current - a.current);
  };

  return {
    summary: {
      ...summarize(items),
      mf: summarize(items.filter((i) => i.type === 'Mutual Fund')),
      etf: summarize(items.filter((i) => i.type === 'ETF')),
      top_weight_pct: items[0]?.weight_pct || 0,
      top5_weight_pct: items.slice(0, 5).reduce((s, i) => s + i.weight_pct, 0),
      stale_count: items.filter((i) => (i.stale_days ?? 0) > STALE_DAYS).length
    },
    items,
    byType: groupBy('type'),
    byPlatform: groupBy('platform'),
    byGroup: groupBy('group'),
    byCategory: groupBy('category'),
    history: buildHistorySeries(investments, histByInv)
  };
}

/** Carry-forward each holding's value/cost onto every snapshot date */
function buildHistorySeries(investments, histByInv) {
  const typeById = new Map(investments.map((i) => [i.id, i.investment_type]));
  const events = [];
  for (const [id, list] of Object.entries(histByInv)) {
    for (const h of list) events.push({ ...h, investment_id: Number(id) });
  }
  events.sort((a, b) => a.change_date.localeCompare(b.change_date) || num(a.id) - num(b.id));
  const state = new Map();
  const series = [];
  let i = 0;
  while (i < events.length) {
    const date = events[i].change_date;
    while (i < events.length && events[i].change_date === date) {
      const e = events[i];
      const prev = state.get(e.investment_id) || {};
      const removed = e.change_type === 'removed';
      state.set(e.investment_id, {
        amount: removed ? 0 : num(e.amount),
        invested: removed ? 0 : num(e.invested_amount) > 0 ? num(e.invested_amount) : prev.invested || 0
      });
      i += 1;
    }
    const point = { date, mf_value: 0, etf_value: 0, invested: 0 };
    for (const [id, s] of state) {
      if (typeById.get(id) === 'ETF') point.etf_value += s.amount;
      else point.mf_value += s.amount;
      point.invested += s.invested;
    }
    series.push(point);
  }
  return series;
}

function buildReconciliation(bank, holdings, filters) {
  const map = {};
  const keyFor = (name) => {
    const k = platformKey(name);
    const existing = Object.keys(map).find((x) => x && k && (x.includes(k) || k.includes(x)));
    return existing || k;
  };
  for (const p of bank.byPlatform) {
    const k = keyFor(p.platform);
    map[k] ||= { platform: p.platform, bank_net: 0, bank_dividends: 0, holdings_invested: 0, holdings_current: 0 };
    map[k].bank_net += p.net;
    map[k].bank_dividends += p.dividends;
  }
  for (const h of holdings.byPlatform) {
    const k = keyFor(h.key);
    map[k] ||= { platform: h.key, bank_net: 0, bank_dividends: 0, holdings_invested: 0, holdings_current: 0 };
    map[k].holdings_invested += h.invested;
    map[k].holdings_current += h.current;
  }
  const rows = Object.values(map)
    .map((r) => ({ ...r, gap: r.bank_net - r.holdings_invested }))
    .sort((a, b) => b.holdings_current + b.bank_net - (a.holdings_current + a.bank_net));

  const fullRange = !filters.from && !filters.to && !filters.account_id;
  const flows = bank.txns.map((t) => ({
    date: t.date,
    amount: t.kind === 'purchase' ? -t.amount : t.amount
  }));
  if (flows.length && holdings.summary.current > 0) {
    flows.push({ date: ymd(new Date()), amount: holdings.summary.current });
  }
  return {
    rows,
    bank_net_invested: bank.summary.net_invested,
    holdings_invested: holdings.summary.invested,
    gap: bank.summary.net_invested - holdings.summary.invested,
    full_range: fullRange,
    bank_xirr: fullRange ? xirr(flows) : null
  };
}

function buildInsights(bank, holdings, recon) {
  const out = [];
  const hs = holdings.summary;
  const top = holdings.items[0];
  if (top && top.weight_pct >= 25) {
    out.push({
      level: 'warn',
      text: `${top.name} is ${top.weight_pct.toFixed(1)}% of your MF/ETF value — consider whether that concentration is intended.`
    });
  }
  if (hs.top5_weight_pct >= 70 && holdings.items.length > 5) {
    out.push({ level: 'info', text: `Top 5 holdings make up ${hs.top5_weight_pct.toFixed(1)}% of the portfolio.` });
  }
  if (hs.stale_count) {
    out.push({
      level: 'warn',
      text: `${hs.stale_count} holding(s) have values older than ${STALE_DAYS} days — re-import statements or refresh NAV.`
    });
  }
  if (hs.missing_cost) {
    out.push({
      level: 'info',
      text: `${hs.missing_cost} holding(s) have no invested amount, so they are excluded from gain / return.`
    });
  }
  const losers = holdings.items.filter((i) => (i.gain_pct ?? 0) <= -10);
  if (losers.length) {
    out.push({
      level: 'warn',
      text: `${losers.length} holding(s) are down 10% or more: ${losers.slice(0, 3).map((l) => l.name).join(', ')}${losers.length > 3 ? '…' : ''}.`
    });
  }
  const inactive = bank.sips.filter((s) => !s.active);
  if (inactive.length) {
    out.push({ level: 'info', text: `${inactive.length} SIP pattern(s) appear to have stopped (no debit in 40+ days).` });
  }
  const irregular = bank.sips.filter((s) => s.active && s.consistency_pct < 80);
  if (irregular.length) {
    out.push({ level: 'info', text: `${irregular.length} active SIP(s) skipped months (consistency below 80%).` });
  }
  if (recon.full_range && bank.summary.txn_count && Math.abs(recon.gap) > Math.max(10000, hs.invested * 0.1)) {
    out.push({
      level: 'info',
      text: `Bank net invested differs from holdings cost by ₹${Math.round(Math.abs(recon.gap)).toLocaleString('en-IN')} — some purchases may be in unimported accounts, or categorized differently.`
    });
  }
  if (hs.etf.count && hs.mf.count) {
    const etfShare = (hs.etf.current / (hs.current || 1)) * 100;
    out.push({ level: 'info', text: `Split: Mutual Funds ${(100 - etfShare).toFixed(1)}% · ETFs ${etfShare.toFixed(1)}% by current value.` });
  }
  return out;
}

async function getInvestmentFlows(filters = {}) {
  const [rows, holdingData] = await Promise.all([fetchCandidateTxns(filters), fetchHoldings()]);
  const bank = buildBankSide(rows);
  const holdings = buildHoldings(holdingData);
  const reconciliation = buildReconciliation(bank, holdings, filters);
  const insights = buildInsights(bank, holdings, reconciliation);
  const recent = [...bank.txns].reverse().slice(0, 25);
  delete bank.txns;
  return { bank: { ...bank, recent }, holdings, reconciliation, insights };
}

module.exports = { getInvestmentFlows, xirr, classifyTxn, detectPlatform };
