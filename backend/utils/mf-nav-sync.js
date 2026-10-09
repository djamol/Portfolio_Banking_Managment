const store = require('../db');
const logger = require('./logger');
const { fetchMfApi, isSchemeCode, mfDateToIso } = require('./mf-api');

let running = null;
let timer = null;

function localYmd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function runSync() {
  const started = Date.now();
  const snapshotDate = localYmd();
  const all = await store.getAllInvestments();
  const funds = all.filter(inv => ['Mutual Fund', 'ETF'].includes(inv.investment_type)
    && isSchemeCode(inv.mutual_fund_scheme_code) && Number(inv.units) > 0);

  const latest = funds.length ? await fetchMfApi('/latest') : [];
  const navByCode = new Map();
  for (const entry of Array.isArray(latest) ? latest : []) {
    if (Number(entry?.nav) > 0) navByCode.set(String(entry.schemeCode), entry);
  }

  const results = [];
  for (const inv of funds) {
    const code = String(inv.mutual_fund_scheme_code);
    const entry = navByCode.get(code);
    if (!entry) {
      results.push({ id: inv.id, scheme_code: code, status: 'missing', error: 'Scheme not found in MFAPI latest list' });
      continue;
    }
    const nav = Number(entry.nav);
    if (Math.abs((Number(inv.nav_price) || 0) - nav) < 0.000001 && inv.nav_source === 'mfapi-latest') {
      results.push({ id: inv.id, scheme_code: code, status: 'unchanged', nav });
      continue;
    }
    try {
      const units = Number(inv.units);
      const value = Math.round(units * nav * 100) / 100;
      await store.saveMutualFundNavSnapshot({
        investment_id: inv.id,
        snapshot_date: snapshotDate,
        nav_date: mfDateToIso(entry.date) || snapshotDate,
        units,
        nav_price: nav,
        value,
        source: 'mfapi-latest'
      });
      await store.setInvestmentValuation(inv.id, { amount: value, nav_price: nav, nav_source: 'mfapi-latest' });
      results.push({ id: inv.id, scheme_code: code, status: 'updated', previous_nav: Number(inv.nav_price) || null, nav, value });
    } catch (error) {
      results.push({ id: inv.id, scheme_code: code, status: 'failed', error: error.message });
    }
  }

  const count = status => results.filter(r => r.status === status).length;
  const summary = {
    snapshot_date: snapshotDate,
    total: funds.length,
    updated: count('updated'),
    unchanged: count('unchanged'),
    missing: count('missing'),
    failed: count('failed'),
    duration_ms: Date.now() - started
  };
  logger.info('Mutual fund NAV sync finished', summary);
  return { ...summary, results };
}

/** Runs the sync; concurrent callers share the in-flight run. */
function syncLatestNavs() {
  if (!running) {
    running = runSync().finally(() => { running = null; });
  }
  return running;
}

function msUntil(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Daily in-process schedule; MF_NAV_SYNC_TIME=HH:MM (server local time, default 01:00) or "off". */
function startNavSyncScheduler() {
  const setting = String(process.env.MF_NAV_SYNC_TIME || '01:00').trim().toLowerCase();
  if (setting === 'off' || setting === 'false') {
    logger.info('Mutual fund NAV sync scheduler disabled');
    return;
  }
  const match = setting.match(/^(\d{1,2}):(\d{2})$/);
  const hour = match ? Number(match[1]) : 1;
  const minute = match ? Number(match[2]) : 0;
  if (!match || hour > 23 || minute > 59) {
    logger.warn('Invalid MF_NAV_SYNC_TIME; using 01:00', { value: setting });
  }
  const h = match && hour <= 23 && minute <= 59 ? hour : 1;
  const m = match && hour <= 23 && minute <= 59 ? minute : 0;

  const schedule = () => {
    const delay = msUntil(h, m);
    timer = setTimeout(async () => {
      try {
        await syncLatestNavs();
      } catch (error) {
        logger.logError('Scheduled mutual fund NAV sync failed', error);
      }
      schedule();
    }, delay);
    timer.unref?.();
    logger.info('Mutual fund NAV sync scheduled', { nextRun: new Date(Date.now() + delay).toString() });
  };
  if (!timer) schedule();
}

module.exports = { syncLatestNavs, startNavSyncScheduler };
