const express = require('express');
const {
  verifyPassword,
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

router.post('/login', (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password are required' });
    }
    if (username !== getAppUser() || !verifyPassword(password)) {
      logger.warn('Login failed', { username });
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    const rememberMe = !!req.body?.rememberMe;
    const session = createSession(username, rememberMe);
    setSessionCookie(res, session.id, session.expiresAt, rememberMe);
    logger.info('Login success', { username, rememberMe });
    res.json({ success: true, data: { username, rememberMe } });
  } catch (error) {
    logger.logError('Login error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/logout', (req, res) => {
  const session = getSession(req);
  if (session) destroySession(session.id);
  clearSessionCookie(res);
  res.json({ success: true, data: { loggedOut: true } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, data: { username: req.user.username } });
});

module.exports = router;
