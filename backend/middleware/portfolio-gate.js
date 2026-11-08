const { runWithPortfolio } = require('../utils/portfolio-scope');

async function portfolioGate(req, res, next) {
  if (!req.user || req.user.username === 'cron') return next();
  try {
    const workspace = require('../db/workspace');
    const scope = await workspace.resolveScope(req.user, req.headers['x-portfolio-id']);
    req.portfolioScope = scope;
    req.user.userId = scope.userId;
    req.user.role = scope.role;
    return runWithPortfolio(scope, () => next());
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Portfolio scope failed' });
  }
}

module.exports = { portfolioGate };
