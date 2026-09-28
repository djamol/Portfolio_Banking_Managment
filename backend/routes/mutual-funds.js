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
    const funds = all.filter(inv => inv.investment_type === 'Mutual Fund');
    const now = new Date();
    const snapshotDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const navCache = new Map();
    const results = [];

    for (const inv of funds) {
      const code = isSchemeCode(inv.mutual_fund_scheme_code) ? String(inv.mutual_fund_scheme_code) : '';
      if (!code || !(Number(inv.units) > 0)) {
        results.push({
          id: inv.id,
          ok: false,
          fund_name: inv.mutual_fund_scheme_name || inv.sub_type_name || `Mutual fund #${inv.id}`,
          investment_type: inv.investment_type || 'Mutual Fund',
          sub_type_name: inv.sub_type_name || '',
          sub_type_category: inv.sub_type_category || '',
          scheme_code: code,
          platform: inv.website_app_name || '',
          units: Number(inv.units) || null,
          current_nav: Number(inv.nav_price) || null,
          current_value: Number(inv.amount) || 0,
          error: !code ? 'Missing or invalid MFAPI scheme code' : 'Units must be greater than zero'
        });
        continue;
      }
      try {
        if (!navCache.has(code)) {
          const latest = await fetchMfApi(`/${code}/latest`);
          const entry = latest?.data?.find(e => Number(e.nav) > 0);
          if (!entry) throw new Error('MFAPI returned no usable NAV');
          navCache.set(code, { nav: Number(entry.nav), navDate: mfDateToIso(entry.date) });
        }
        const { nav, navDate } = navCache.get(code);
        const snapshots = await store.listMutualFundNavSnapshots(inv.id);
        const savedSnapshot = snapshots
          .filter(snapshot => snapshot.source !== 'mfapi-latest')
          .sort((a, b) => String(b.snapshot_date).localeCompare(String(a.snapshot_date)))[0];
        const savedNav = savedSnapshot?.nav_price
          ?? (inv.nav_source !== 'mfapi-latest' && Number(inv.nav_price) > 0 ? Number(inv.nav_price) : null);
        results.push({
          id: inv.id,
          ok: true,
          fund_name: inv.mutual_fund_scheme_name || inv.sub_type_name || `Mutual fund #${inv.id}`,
          investment_type: inv.investment_type || 'Mutual Fund',
          sub_type_name: inv.sub_type_name || '',
          sub_type_category: inv.sub_type_category || '',
          scheme_code: code,
          platform: inv.website_app_name || '',
          units: Number(inv.units),
          current_nav: Number(inv.nav_price) || null,
          current_value: Number(inv.amount) || 0,
          saved_nav: savedNav == null ? null : Number(savedNav),
          saved_nav_date: savedSnapshot?.nav_date || null,
          saved_nav_source: savedSnapshot?.source || (savedNav != null ? inv.nav_source || 'imported' : null),
          nav,
          nav_date: navDate,
          changed: Math.abs((Number(inv.nav_price) || 0) - nav) > 0.000001
        });
      } catch (error) {
        results.push({
          id: inv.id,
          ok: false,
          fund_name: inv.mutual_fund_scheme_name || inv.sub_type_name || `Mutual fund #${inv.id}`,
          investment_type: inv.investment_type || 'Mutual Fund',
          sub_type_name: inv.sub_type_name || '',
          sub_type_category: inv.sub_type_category || '',
          scheme_code: code,
          platform: inv.website_app_name || '',
          error: error.message
        });
      }
    }

    const succeeded = results.filter(r => r.ok);
    res.json({
      success: true,
      data: {
        snapshot_date: snapshotDate,
        total: funds.length,
        succeeded: succeeded.length,
        failed: results.length - succeeded.length,
        changed: succeeded.filter(r => r.changed).length,
        results
      }
    });
  } catch (error) {
    console.error('Error refreshing mutual fund NAVs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/refresh-latest/apply', async (req, res) => {
  const updates = req.body?.updates;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ success: false, error: 'updates must be an array' });
  }

  const now = new Date();
  const snapshotDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const results = [];
  try {
    for (const update of updates) {
      const id = Number(update?.id);
      if (!Number.isInteger(id) || !['api', 'saved', 'manual', 'reject'].includes(update?.choice)) {
        results.push({ id: update?.id, ok: false, error: 'Invalid NAV choice' });
        continue;
      }
      if (update.choice === 'reject') {
        results.push({ id, ok: true, rejected: true });
        continue;
      }

      const nav = Number(update.nav);
      const investment = await store.getInvestmentById(id);
      if (!investment || investment.investment_type !== 'Mutual Fund' || !(Number(investment.units) > 0) || !(nav > 0)) {
        results.push({ id, ok: false, error: 'Invalid mutual fund or NAV value' });
        continue;
      }
      const units = Number(investment.units);
      const value = Math.round(units * nav * 100) / 100;
      const source = update.choice === 'api' ? 'mfapi-latest'
        : update.choice === 'manual' ? 'manual-review' : 'review-saved';
      await store.saveMutualFundNavSnapshot({
        investment_id: id,
        snapshot_date: snapshotDate,
        nav_date: validDate(update.nav_date) ? update.nav_date : snapshotDate,
        units,
        nav_price: nav,
        value,
        source
      });
      await store.setInvestmentValuation(id, { amount: value, nav_price: nav, nav_source: source });
      results.push({ id, ok: true, value, nav, source });
    }
    const applied = results.filter(result => result.ok && !result.rejected);
    res.json({
      success: true,
      data: {
        snapshot_date: snapshotDate,
        applied: applied.length,
        rejected: results.filter(result => result.rejected).length,
        failed: results.filter(result => !result.ok).length,
        results
      }
    });
  } catch (error) {
    console.error('Error applying mutual fund NAV choices:', error);
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