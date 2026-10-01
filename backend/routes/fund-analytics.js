const express = require('express');
const store = require('../db');
const { buildFundAnalytics, PERIODS } = require('../utils/fund-analytics');

const router = express.Router();

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value));
}

function listParam(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
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

  try {
    const [investments, snapshots] = await Promise.all([
      store.getAllInvestments(),
      store.listAllMutualFundNavSnapshots(from || null, to || null)
    ]);

    const data = buildFundAnalytics({
      investments,
      snapshots,
      from: from || null,
      to: to || null,
      period,
      topN: Math.min(Math.max(Number(req.query.topN) || 10, 1), 50),
      filters: {
        types: listParam(req.query.types),
        platforms: listParam(req.query.platforms),
        categories: listParam(req.query.categories),
        ids: listParam(req.query.ids).map(Number).filter(Number.isFinite)
      }
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building fund analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
