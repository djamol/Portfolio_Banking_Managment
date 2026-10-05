const express = require('express');
const { syncLatestNavs } = require('../utils/mf-nav-sync');

const router = express.Router();

const TZ_ALIASES = {
  IST: 'Asia/Kolkata',
  UTC: 'UTC',
  GMT: 'UTC',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CST: 'America/Chicago',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  BST: 'Europe/London',
  CET: 'Europe/Paris',
  JST: 'Asia/Tokyo',
  SGT: 'Asia/Singapore',
  AEST: 'Australia/Sydney',
};

function resolveTimeZone(tz) {
  const raw = String(tz || 'UTC').trim();
  const zone = TZ_ALIASES[raw.toUpperCase()] || raw;
  new Intl.DateTimeFormat('en-US', { timeZone: zone }); // throws RangeError if invalid
  return { label: raw.toUpperCase() in TZ_ALIASES ? raw.toUpperCase() : zone, zone };
}

function formatInTimeZone(date, { label, zone }) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
    display: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${label} (UTC${offset})`,
  };
}

router.get('/', async (req, res) => {
  let tz;
  try {
    tz = resolveTimeZone(req.query.tz);
  } catch {
    return res.status(400).json({ success: false, error: `Invalid timezone: ${req.query.tz}` });
  }

  try {
    const startedAt = new Date();
    const { results, ...summary } = await syncLatestNavs();
    const finishedAt = new Date();
    res.json({
      success: true,
      data: {
        ...summary,
        timezone: tz.label === tz.zone ? tz.zone : `${tz.label} (${tz.zone})`,
        started_at: formatInTimeZone(startedAt, tz),
        finished_at: formatInTimeZone(finishedAt, tz),
        started_at_utc: startedAt.toISOString(),
        finished_at_utc: finishedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error running mutual fund NAV cron job:', error);
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
