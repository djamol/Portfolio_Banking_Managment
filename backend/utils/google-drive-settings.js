const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'google-drive-settings.json');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const OAUTH_STATES = new Map(); // state -> { returnUrl, createdAt }
const STATE_TTL_MS = 15 * 60 * 1000;

const DEFAULTS = {
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  folderName: 'PORTFOLIO_BK',
  folderId: '',
  keepBackups: 4
};

function ensureDataDir() {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
}

function readFileSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    logger.warn('Failed to read Google Drive settings file', { error: err.message });
    return {};
  }
}

function writeFileSettings(settings) {
  ensureDataDir();
  const tmp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
}

function envOrEmpty(key) {
  return String(process.env[key] || '').trim();
}

/**
 * Effective config: persisted UI settings override .env.
 */
function getDriveSettings() {
  const file = readFileSettings();
  const keepRaw = Number(
    file.keepBackups != null ? file.keepBackups : process.env.GOOGLE_DRIVE_KEEP_BACKUPS
  );
  const keepBackups = Number.isFinite(keepRaw) && keepRaw > 0 ? Math.floor(keepRaw) : 4;

  return {
    clientId: String(file.clientId || envOrEmpty('GOOGLE_DRIVE_CLIENT_ID')).trim(),
    clientSecret: String(file.clientSecret || envOrEmpty('GOOGLE_DRIVE_CLIENT_SECRET')).trim(),
    refreshToken: String(file.refreshToken || envOrEmpty('GOOGLE_DRIVE_REFRESH_TOKEN')).trim(),
    folderName:
      String(file.folderName || envOrEmpty('GOOGLE_DRIVE_BACKUP_FOLDER') || 'PORTFOLIO_BK').trim() ||
      'PORTFOLIO_BK',
    folderId: String(file.folderId || envOrEmpty('GOOGLE_DRIVE_FOLDER_ID')).trim(),
    keepBackups
  };
}

function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function getPublicDriveSettings() {
  const s = getDriveSettings();
  return {
    clientId: s.clientId,
    clientSecretSet: Boolean(s.clientSecret),
    clientSecretMasked: s.clientSecret ? maskSecret(s.clientSecret) : '',
    refreshTokenSet: Boolean(s.refreshToken),
    refreshTokenMasked: s.refreshToken ? maskSecret(s.refreshToken) : '',
    folderName: s.folderName,
    folderId: s.folderId,
    keepBackups: s.keepBackups,
    connected: Boolean(s.clientId && s.clientSecret && s.refreshToken),
    scope: DRIVE_SCOPE,
    settingsPath: SETTINGS_PATH
  };
}

/**
 * Partial update. Empty clientSecret / refreshToken means "leave unchanged"
 * unless clearClientSecret / clearRefreshToken is true.
 */
function saveDriveSettings(patch = {}) {
  const current = { ...DEFAULTS, ...readFileSettings() };
  const next = { ...current };

  if (patch.clientId != null) next.clientId = String(patch.clientId).trim();

  if (patch.clearClientSecret) {
    next.clientSecret = '';
  } else if (patch.clientSecret != null && String(patch.clientSecret).trim() !== '') {
    next.clientSecret = String(patch.clientSecret).trim();
  }

  if (patch.clearRefreshToken) {
    next.refreshToken = '';
  } else if (patch.refreshToken != null && String(patch.refreshToken).trim() !== '') {
    next.refreshToken = String(patch.refreshToken).trim();
  }

  if (patch.folderName != null) {
    next.folderName = String(patch.folderName).trim() || 'PORTFOLIO_BK';
  }
  if (patch.folderId != null) {
    next.folderId = String(patch.folderId).trim();
  }
  if (patch.keepBackups != null && patch.keepBackups !== '') {
    const n = Number(patch.keepBackups);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error('keepBackups must be a positive number');
    }
    next.keepBackups = Math.floor(n);
  }

  writeFileSettings({
    clientId: next.clientId || '',
    clientSecret: next.clientSecret || '',
    refreshToken: next.refreshToken || '',
    folderName: next.folderName || 'PORTFOLIO_BK',
    folderId: next.folderId || '',
    keepBackups: next.keepBackups || 4,
    updatedAt: new Date().toISOString()
  });

  // Keep process.env in sync so other code paths see the latest values.
  const effective = getDriveSettings();
  process.env.GOOGLE_DRIVE_CLIENT_ID = effective.clientId;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = effective.clientSecret;
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = effective.refreshToken;
  process.env.GOOGLE_DRIVE_BACKUP_FOLDER = effective.folderName;
  process.env.GOOGLE_DRIVE_FOLDER_ID = effective.folderId;
  process.env.GOOGLE_DRIVE_KEEP_BACKUPS = String(effective.keepBackups);

  logger.info('Google Drive settings saved', {
    clientIdSet: Boolean(effective.clientId),
    refreshTokenSet: Boolean(effective.refreshToken),
    folderName: effective.folderName,
    keepBackups: effective.keepBackups
  });

  return getPublicDriveSettings();
}

function buildApiPublicBase(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  const basePath = String(process.env.BASE_PATH || '').replace(/\/$/, '');
  return `${proto}://${host}${basePath}/api`;
}

function getOAuthRedirectUri(req) {
  return `${buildApiPublicBase(req)}/config/google-drive/oauth/callback`;
}

function purgeExpiredOAuthStates() {
  const now = Date.now();
  for (const [key, val] of OAUTH_STATES.entries()) {
    if (!val || now - val.createdAt > STATE_TTL_MS) {
      OAUTH_STATES.delete(key);
    }
  }
}

function createOAuthState(returnUrl) {
  purgeExpiredOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  OAUTH_STATES.set(state, {
    returnUrl: String(returnUrl || '').trim(),
    createdAt: Date.now()
  });
  return state;
}

function consumeOAuthState(state) {
  purgeExpiredOAuthStates();
  const key = String(state || '');
  const entry = OAUTH_STATES.get(key);
  OAUTH_STATES.delete(key);
  return entry || null;
}

function buildGoogleAuthUrl(req, returnUrl) {
  const settings = getDriveSettings();
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('Save Google Client ID and Client Secret before connecting.');
  }

  const state = createOAuthState(returnUrl);
  const redirectUri = getOAuthRedirectUri(req);
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });

  return {
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    redirectUri,
    state
  };
}

async function exchangeAuthorizationCode(code, redirectUri) {
  const settings = getDriveSettings();
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('Google Client ID / Secret are not configured.');
  }

  const body = new URLSearchParams({
    code: String(code),
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token && !data.access_token) {
    const detail = data.error_description || data.error || res.statusText;
    throw new Error(`Google token exchange failed: ${detail}`);
  }
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh_token. Revoke app access at https://myaccount.google.com/permissions and connect again with prompt=consent.'
    );
  }
  return data;
}

function safeReturnUrl(raw, req) {
  const fallbackOrigin = `${String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim()}://${String(req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim()}`;
  const fallback = `${fallbackOrigin}/#/import-export`;
  const value = String(raw || '').trim();
  if (!value) return fallback;
  try {
    const u = new URL(value);
    // Only allow http(s) same-ish redirects (any host user provided at start — typically their FE).
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return value;
  } catch {
    if (value.startsWith('/')) {
      return `${fallbackOrigin}${value}`;
    }
    return fallback;
  }
}

module.exports = {
  DRIVE_SCOPE,
  SETTINGS_PATH,
  getDriveSettings,
  getPublicDriveSettings,
  saveDriveSettings,
  getOAuthRedirectUri,
  buildGoogleAuthUrl,
  consumeOAuthState,
  exchangeAuthorizationCode,
  safeReturnUrl
};
