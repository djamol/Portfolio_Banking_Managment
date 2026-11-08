const express = require('express');
const logger = require('../utils/logger');
const workspace = require('../db/workspace');

const router = express.Router();

function actor(req) {
  return {
    userId: req.user.userId,
    role: req.user.role,
    username: req.user.username
  };
}

async function send(res, work) {
  try {
    const data = await work();
    res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) logger.logError('Workspace request failed', error);
    res.status(status).json({ success: false, error: error.message || 'Request failed' });
  }
}

router.get('/context', (req, res) => send(res, () => workspace.contextFor(req.portfolioScope)));

router.get('/summary', (req, res) => send(res, () => workspace.summaryFor({
  id: req.user.userId,
  role: req.user.role
})));

router.get('/users', (req, res) => send(res, async () => {
  if (req.user.role !== 'admin') {
    const err = new Error('Only an admin can list users');
    err.status = 403;
    throw err;
  }
  return workspace.listUsers();
}));

router.post('/users', (req, res) => send(res, () => workspace.createUser(actor(req), req.body || {})));

router.put('/users/:id', (req, res) => send(res, () => workspace.updateUser(actor(req), req.params.id, req.body || {})));

router.post('/portfolios', (req, res) => send(res, () => workspace.createPortfolio(actor(req), req.body || {})));

router.put('/portfolios/:id', (req, res) => send(res, () => workspace.updatePortfolio(actor(req), req.params.id, req.body || {})));

router.delete('/portfolios/:id', (req, res) => send(res, () => workspace.deletePortfolio(actor(req), req.params.id)));

module.exports = router;
