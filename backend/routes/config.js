const express = require('express');
const router = express.Router();
const { getIgnorePlatforms } = require('../utils/ignore-platform');
const { getDbType, isMongoDb, mysqlDb } = require('../config/index');

router.get('/', (req, res) => {
  const data = {
    ignorePlatforms: getIgnorePlatforms(),
    dbType: getDbType()
  };

  if (!isMongoDb()) {
    const current = mysqlDb.getConnectionSummary();
    data.database = current;
    data.databasePreset = mysqlDb.matchPresetId(current.host, current.port);
    data.databasePresets = mysqlDb.getDatabasePresets();
  }

  res.json({
    success: true,
    data
  });
});

/** Switch MySQL host at runtime (login: localhost vs internal Docker DB). */
router.post('/database', async (req, res) => {
  if (isMongoDb()) {
    return res.status(400).json({
      success: false,
      error: 'Database host switch is only available when DB_TYPE=mysql'
    });
  }

  try {
    const body = req.body || {};
    let { host, port, preset } = body;

    if (preset) {
      const found = mysqlDb.getDatabasePresets().find((p) => p.id === String(preset));
      if (!found) {
        return res.status(400).json({
          success: false,
          error: `Unknown database preset: ${preset}`
        });
      }
      host = found.host;
      port = found.port;
    }

    if (!host) {
      return res.status(400).json({
        success: false,
        error: 'Provide preset (localhost|docker) or host'
      });
    }

    const summary = await mysqlDb.reconfigureDatabase({ host, port });
    res.json({
      success: true,
      data: {
        database: summary,
        databasePreset: mysqlDb.matchPresetId(summary.host, summary.port)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to switch database'
    });
  }
});

module.exports = router;
