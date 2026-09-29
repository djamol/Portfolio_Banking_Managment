const express = require('express');
const { syncLatestNavs } = require('../utils/mf-nav-sync');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { results, ...summary } = await syncLatestNavs();
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error running mutual fund NAV cron job:', error);
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
