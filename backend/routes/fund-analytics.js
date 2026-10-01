const express = require('express');
const store = require('../db');
const { buildFundAnalytics, PERIODS } = require('../utils/fund-analytics');

const router = express.Router();

const CACHE_TTL_MS = 60000;
const cache = new Map();

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value));
}

function listParam(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (cache.size > 40) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

router.get('/', async (req, res) => {
  const { from, to } = req.query;
  if ((from && !validDate(from)) || (to && !validDate(to))) {
    return res.status(400).json({ success: false, error: 'Dates must use YYYY-MM-DD format' });
  }
  if (from && to && from > to) {
    return res.status(400).json({ success: false, error: 'from cannot be after to' });
  }

  const period = String(req.query.period || 'monthly');
  if (!PERIODS.includes(period)) {
    return res.status(400).json({ success: false, error: `period must be one of ${PERIODS.join(', ')}` });
  }

  const cacheKey = JSON.stringify(req.query);
  const cached = req.query.refresh === '1' ? null : cacheGet(cacheKey);
  if (cached) {
    res.set('X-Cache', 'hit');
    return res.json({ success: true, data: cached });
  }

  try {
    const [investments, snapshots, transactions] = await Promise.all([
      store.getAllInvestments(),
      store.listAllMutualFundNavSnapshots(from || null, to || null),
      Promise.resolve().then(() => store.getAllTransactions()).catch(() => [])
    ]);

    const benchmarkId = Number(req.query.benchmarkId);
    const data = buildFundAnalytics({
      investments,
      snapshots,
      transactions,
      from: from || null,
      to: to || null,
      period,
      topN: clamp(req.query.topN, 1, 50, 10),
      riskFreePct: clamp(req.query.riskFreePct, 0, 20, 6),
      benchmarkId: Number.isFinite(benchmarkId) && benchmarkId > 0 ? benchmarkId : null,
      filters: {
        types: listParam(req.query.types),
        platforms: listParam(req.query.platforms),
        categories: listParam(req.query.categories),
        ids: listParam(req.query.ids).map(Number).filter(Number.isFinite)
      }
    });

    cacheSet(cacheKey, data);
    res.set('X-Cache', 'miss');
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building fund analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
