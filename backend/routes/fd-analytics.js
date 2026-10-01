const express = require('express');
const store = require('../db');
const { buildFdAnalytics } = require('../utils/fd-analytics');

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

router.get('/', async (req, res) => {
  const { asOf } = req.query;
  if (asOf && !validDate(asOf)) {
    return res.status(400).json({ success: false, error: 'asOf must use YYYY-MM-DD format' });
  }

  const cacheKey = JSON.stringify(req.query);
  const entry = cache.get(cacheKey);
  if (req.query.refresh !== '1' && entry && Date.now() - entry.at < CACHE_TTL_MS) {
    res.set('X-Cache', 'hit');
    return res.json({ success: true, data: entry.value });
  }

  try {
    const investments = await store.getAllInvestments();
    const data = buildFdAnalytics({
      investments,
      asOf: asOf || null,
      taxRatePct: clamp(req.query.taxRatePct, 0, 50, 0),
      horizonMonths: clamp(req.query.horizonMonths, 3, 120, 24),
      filters: {
        types: listParam(req.query.types),
        platforms: listParam(req.query.platforms),
        categories: listParam(req.query.categories)
      }
    });

    if (cache.size > 40) cache.clear();
    cache.set(cacheKey, { at: Date.now(), value: data });
    res.set('X-Cache', 'miss');
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building FD analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
