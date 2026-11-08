const express = require('express');
const {
  verifyPassword,
  verifyStoredHash,
  getAppUser,
  createSession,
  destroySession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
} = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password are required' });
    }
    const workspace = require('../db/workspace');
    let user = await workspace.findUserByUsername(username);
    const envAccount = username === getAppUser() && verifyPassword(password);
    if (user && (user.is_active === 0 || user.is_active === false)) {
      logger.warn('Login failed', { username, reason: 'inactive' });
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    if (user && !verifyStoredHash(password, user.password_hash)) {
      if (!envAccount) {
        logger.warn('Login failed', { username });
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
    } else if (!user) {
      if (!envAccount) {
        logger.warn('Login failed', { username });
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
      user = await workspace.ensureEnvAdmin(username, password);
    }
    const rememberMe = !!req.body?.rememberMe;
    const session = createSession(user, rememberMe);
    setSessionCookie(res, session.id, session.expiresAt, rememberMe);
    logger.info('Login success', { username: user.username, rememberMe, role: user.role });
    res.json({
      success: true,
      data: {
        username: user.username,
        role: user.role,
        userId: user.id,
        rememberMe
      }
    });
  } catch (error) {
    logger.logError('Login error', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

router.post('/logout', (req, res) => {
  const session = getSession(req);
  if (session) destroySession(session.id);
  clearSessionCookie(res);
  res.json({ success: true, data: { loggedOut: true } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      username: req.user.username,
      userId: req.user.userId,
      role: req.user.role
    }
  });
});

module.exports = router;
