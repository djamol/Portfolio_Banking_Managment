const crypto = require('crypto');
const logger = require('../utils/logger');

const SESSION_COOKIE = 'pfm_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || 'dev-session-secret-change-me';
}

function getAppUser() {
  return process.env.APP_USER || 'amol';
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

function scryptHash(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return `scrypt$${s}$${hash}`;
}

function verifyPassword(password) {
  const hashEnv = process.env.APP_PASSWORD_HASH;
  const plain = process.env.APP_PASSWORD;
  if (hashEnv) {
    if (hashEnv.startsWith('scrypt$')) {
      const [, salt, expected] = hashEnv.split('$');
      const actual = crypto.scryptSync(password, salt, 64).toString('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
      } catch {
        return false;
      }
    }
    // Fallback: treat APP_PASSWORD_HASH as opaque shared secret string compare
    try {
      const a = Buffer.from(String(password));
      const b = Buffer.from(String(hashEnv));
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  if (plain != null && plain !== '') {
    const a = Buffer.from(String(password));
    const b = Buffer.from(String(plain));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  // Dev default when nothing configured (matches prior hardcoded login)
  const fallbackUser = getAppUser();
  const fallbackPass = 'admin';
  return password === fallbackPass && fallbackUser === getAppUser();
}

function createSession(username) {
  const id = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(id, { username, expiresAt });
  return { id, expiresAt };
}

function destroySession(id) {
  if (id) sessions.delete(id);
}

function getSession(req) {
  const cookies = parseCookies(req);
  const id = cookies[SESSION_COOKIE];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return { id, ...session };
}

function setSessionCookie(res, sessionId, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  req.user = { username: session.username };
  req.sessionId = session.id;
  next();
}

function publicApiPath(req) {
  const path = (req.originalUrl || req.path || '').split('?')[0].replace(/^\/api/, '') || req.path;
  if (req.method === 'GET' && (path === '/health' || path === 'health')) return true;
  if (req.method === 'POST' && (path === '/auth/login' || path === '/auth/logout')) return true;
  if (req.method === 'GET' && path === '/config') return true;
  return false;
}

function authGate(req, res, next) {
  if (publicApiPath(req)) return next();
  return requireAuth(req, res, next);
}

function requireFreshInstallConfirm(req, res, next) {
  if (!req.body?.freshInstall) return next();
  const header = req.headers['x-confirm-fresh-install'];
  if (header === 'yes' || header === 'true' || req.body.confirmFreshInstall === true) {
    return next();
  }
  return res.status(400).json({
    success: false,
    error: 'freshInstall requires confirmFreshInstall: true or X-Confirm-Fresh-Install: yes'
  });
}

module.exports = {
  SESSION_COOKIE,
  scryptHash,
  verifyPassword,
  getAppUser,
  createSession,
  destroySession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  authGate,
  requireFreshInstallConfirm,
  getSessionSecret
};
