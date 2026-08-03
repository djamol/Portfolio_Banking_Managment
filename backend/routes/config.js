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
    data.embeddedMysql = /^(1|true|yes|on)$/i.test(String(process.env.EMBEDDED_MYSQL || ''));
    data.mysqlPublishPort = process.env.MYSQL_PUBLISH_PORT || null;
  }

  res.json({
    success: true,
    data
  });
});

/** Switch MySQL host at runtime (login: preset or full custom config). */
router.post('/database', async (req, res) => {
  if (isMongoDb()) {
    return res.status(400).json({
      success: false,
      error: 'Database host switch is only available when DB_TYPE=mysql'
    });
  }

  let host;
  let port;
  try {
    const body = req.body || {};
    const { preset, user, password, database } = body;
    host = body.host;
    port = body.port;

    if (preset && preset !== 'custom') {
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
        error: 'Provide preset (localhost|docker) or custom host'
      });
    }

    const overrides = { host, port };
    if (user != null && String(user).trim() !== '') overrides.user = String(user).trim();
    if (password != null) overrides.password = String(password);
    if (database != null && String(database).trim() !== '') {
      overrides.database = String(database).trim();
    }

    const summary = await mysqlDb.reconfigureDatabase(overrides);
    res.json({
      success: true,
      data: {
        database: summary,
        databasePreset: mysqlDb.matchPresetId(summary.host, summary.port) || 'custom',
        embeddedMysql: /^(1|true|yes|on)$/i.test(String(process.env.EMBEDDED_MYSQL || '')),
        mysqlPublishPort: process.env.MYSQL_PUBLISH_PORT || null
      }
    });
  } catch (error) {
    const code = error && error.code;
    let message = error.message || 'Failed to switch database';
    if (code === 'ECONNREFUSED' && (host === '127.0.0.1' || host === 'localhost')) {
      message =
        'Internal Docker DB is not running (ECONNREFUSED 127.0.0.1:3306). ' +
        'Rebuild/run the image with EMBEDDED_MYSQL=true (default for standalone). ' +
        'MySQL host publish (-p) is optional and not required for Internal Docker DB.';
    }
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

module.exports = router;
