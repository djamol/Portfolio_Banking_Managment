const express = require('express');
const router = express.Router();
const { getIgnorePlatforms } = require('../utils/ignore-platform');
const { getDbType, isMongoDb, mysqlDb } = require('../config/index');
const {
  getPublicDriveSettings,
  saveDriveSettings,
  getOAuthRedirectUri,
  buildGoogleAuthUrl,
  consumeOAuthState,
  exchangeAuthorizationCode,
  safeReturnUrl
} = require('../utils/google-drive-settings');
const { testDriveConnection } = require('../utils/google-drive');

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

/** Google Drive backup settings (requires login except OAuth callback). */
router.get('/google-drive', (req, res) => {
  try {
    const data = getPublicDriveSettings();
    data.redirectUri = getOAuthRedirectUri(req);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/google-drive', (req, res) => {
  try {
    const body = req.body || {};
    const data = saveDriveSettings({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      refreshToken: body.refreshToken,
      clearClientSecret: !!body.clearClientSecret,
      clearRefreshToken: !!body.clearRefreshToken,
      folderName: body.folderName,
      folderId: body.folderId,
      keepBackups: body.keepBackups
    });
    data.redirectUri = getOAuthRedirectUri(req);
    res.json({ success: true, data, message: 'Google Drive settings saved.' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/google-drive/oauth/start', (req, res) => {
  try {
    const returnUrl = safeReturnUrl(req.body?.returnUrl || req.query.returnUrl, req);
    const started = buildGoogleAuthUrl(req, returnUrl);
    res.json({
      success: true,
      data: {
        authUrl: started.authUrl,
        redirectUri: started.redirectUri,
        message:
          'Add this redirect URI in Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs, then open authUrl.'
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

function appendReturnQuery(returnUrl, params) {
  if (returnUrl.includes('#')) {
    const [beforeHash, afterHash = ''] = returnUrl.split('#');
    const qIndex = afterHash.indexOf('?');
    const pathPart = (qIndex >= 0 ? afterHash.slice(0, qIndex) : afterHash) || '/import-export';
    const search = qIndex >= 0 ? afterHash.slice(qIndex + 1) : '';
    const sp = new URLSearchParams(search);
    Object.entries(params).forEach(([k, v]) => sp.set(k, String(v)));
    return `${beforeHash}#${pathPart}?${sp.toString()}`;
  }
  const u = new URL(returnUrl);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  return u.toString();
}

/** Public — Google redirects here with ?code=&state= (no session required). */
router.get('/google-drive/oauth/callback', async (req, res) => {
  const redirectUri = getOAuthRedirectUri(req);
  const stateEntry = consumeOAuthState(req.query.state);
  const returnUrl = safeReturnUrl(stateEntry?.returnUrl, req);

  const failRedirect = (msg) =>
    res.redirect(appendReturnQuery(returnUrl, { gdrive: 'error', gdrive_msg: msg }));

  try {
    if (req.query.error) {
      return failRedirect(String(req.query.error_description || req.query.error));
    }
    if (!stateEntry) {
      return failRedirect('OAuth state expired or invalid. Start Connect again from Backup & restore.');
    }
    if (!req.query.code) {
      return failRedirect('Missing authorization code from Google.');
    }

    const tokens = await exchangeAuthorizationCode(req.query.code, redirectUri);
    saveDriveSettings({ refreshToken: tokens.refresh_token });
    return res.redirect(appendReturnQuery(returnUrl, { gdrive: 'connected' }));
  } catch (error) {
    console.error('Google Drive OAuth callback failed:', error);
    return failRedirect(error.message || 'OAuth failed');
  }
});

router.post('/google-drive/disconnect', (req, res) => {
  try {
    const data = saveDriveSettings({ clearRefreshToken: true });
    data.redirectUri = getOAuthRedirectUri(req);
    res.json({ success: true, data, message: 'Google Drive disconnected (refresh token cleared).' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/google-drive/test', async (req, res) => {
  try {
    const result = await testDriveConnection();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
