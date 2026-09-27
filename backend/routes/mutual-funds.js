const express = require('express');
const { fetchMfApi, isSchemeCode, selectNavAsOf, mfDateToIso } = require('../utils/mf-api');
const store = require('../db');

const router = express.Router();

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value));
}

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) {
    return res.status(400).json({ success: false, error: 'Search query must contain at least 2 characters' });
  }

  try {
    const data = await fetchMfApi(`/search?q=${encodeURIComponent(query)}`);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error searching mutual funds:', error);
    res.status(error.status || 502).json({ success: false, error: error.message });
  }
});

router.get('/:schemeCode/latest', async (req, res) => {
  if (!isSchemeCode(req.params.schemeCode)) {
    return res.status(400).json({ success: false, error: 'Invalid mutual fund scheme code' });
  }

  try {
    const data = await fetchMfApi(`/${req.params.schemeCode}/latest`);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching latest mutual fund NAV:', error);
    res.status(error.status || 502).json({ success: false, error: error.message });
  }
});

router.get('/:schemeCode/history', async (req, res) => {
  const { schemeCode } = req.params;
  const { startDate, endDate } = req.query;
  if (!isSchemeCode(schemeCode)) {
    return res.status(400).json({ success: false, error: 'Invalid mutual fund scheme code' });
  }
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
    return res.status(400).json({ success: false, error: 'Dates must use YYYY-MM-DD format' });
  }
  if (startDate && endDate && startDate > endDate) {
    return res.status(400).json({ success: false, error: 'startDate cannot be after endDate' });
  }

  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  const query = params.toString();

  try {
    const data = await fetchMfApi(`/${schemeCode}${query ? `?${query}` : ''}`);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching mutual fund NAV history:', error);
    res.status(error.status || 502).json({ success: false, error: error.message });
  }
});

router.post('/snapshots', async (req, res) => {
  const { investmentId, dates } = req.body;
  if (!investmentId || !Array.isArray(dates) || !dates.length) {
    return res.status(400).json({ success: false, error: 'investmentId and dates are required' });
  }
  try {
    const investment = await store.getInvestmentById(investmentId);
    if (!investment || investment.investment_type !== 'Mutual Fund') {
      return res.status(404).json({ success: false, error: 'Mutual fund investment not found' });
    }
    if (!isSchemeCode(investment.mutual_fund_scheme_code)) {
      return res.status(400).json({ success: false, error: 'Investment has no MFAPI scheme code' });
    }
    const validDates = dates.filter(date => validDate(date)).sort();
    if (!validDates.length) return res.status(400).json({ success: false, error: 'Valid dates are required' });
    const history = await fetchMfApi(`/${investment.mutual_fund_scheme_code}`);
    const snapshots = [];
    for (const snapshotDate of validDates) {
      const navEntry = selectNavAsOf(history?.data, snapshotDate);
      if (!navEntry) continue;
      const units = Number(investment.units);
      if (!(units > 0)) continue;
      snapshots.push(await store.saveMutualFundNavSnapshot({
        investment_id: investment.id,
        snapshot_date: snapshotDate,
        nav_date: navEntry.isoDate,
        units,
        nav_price: Number(navEntry.nav),
        value: units * Number(navEntry.nav),
        source: 'mfapi-history'
      }));
    }
    res.json({ success: true, data: snapshots });
  } catch (error) {
    console.error('Error saving mutual fund NAV snapshots:', error);
    res.status(502).json({ success: false, error: error.message });
  }
});

router.post('/refresh-latest', async (req, res) => {
  try {
    const all = await store.getAllInvestments();
    const funds = all.filter(inv => inv.investment_type === 'Mutual Fund'
      && isSchemeCode(inv.mutual_fund_scheme_code) && Number(inv.units) > 0);
    const now = new Date();
    const snapshotDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const navCache = new Map();
    const results = [];

    for (const inv of funds) {
      const code = String(inv.mutual_fund_scheme_code);
      try {
        if (!navCache.has(code)) {
          const latest = await fetchMfApi(`/${code}/latest`);
          const entry = latest?.data?.find(e => Number(e.nav) > 0);
          if (!entry) throw new Error('MFAPI returned no usable NAV');
          navCache.set(code, { nav: Number(entry.nav), navDate: mfDateToIso(entry.date) });
        }
        const { nav, navDate } = navCache.get(code);
        const units = Number(inv.units);
        const value = Math.round(units * nav * 100) / 100;
        await store.saveMutualFundNavSnapshot({
          investment_id: inv.id,
          snapshot_date: snapshotDate,
          nav_date: navDate,
          units,
          nav_price: nav,
          value,
          source: 'mfapi-latest'
        });
        await store.setInvestmentValuation(inv.id, { amount: value, nav_price: nav, nav_source: 'mfapi-latest' });
        results.push({ id: inv.id, ok: true, previous: Number(inv.amount), value, nav, nav_date: navDate });
      } catch (error) {
        results.push({ id: inv.id, ok: false, error: error.message });
      }
    }

    const succeeded = results.filter(r => r.ok);
    const change = succeeded.reduce((s, r) => s + (r.value - r.previous), 0);
    res.json({
      success: true,
      data: {
        snapshot_date: snapshotDate,
        total: funds.length,
        succeeded: succeeded.length,
        failed: results.length - succeeded.length,
        value_change: Math.round(change * 100) / 100,
        results
      }
    });
  } catch (error) {
    console.error('Error refreshing mutual fund NAVs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/snapshots/:investmentId', async (req, res) => {
  try {
    const rows = await store.listMutualFundNavSnapshots(
      req.params.investmentId,
      req.query.from,
      req.query.to
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching mutual fund NAV snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;