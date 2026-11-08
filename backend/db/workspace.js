const logger = require('../utils/logger');
const { isMongoDb, getPool, getMongoDb } = require('../config/index');
const { SCOPED, runUnrestricted, getWritePortfolioId } = require('../utils/portfolio-scope');

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

function cleanColor(value, fallback) {
  const v = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}
const CHILD_TABLES = [
  'investment_history',
  'investment_transactions',
  'mutual_fund_nav_history',
  'bank_transactions',
  'bank_category_rules',
  'bank_budgets'
];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function passwords() {
  return require('../middleware/auth');
}

function cleanUsername(value) {
  return String(value || '').trim();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    display_name: row.display_name || row.username,
    role: row.role || 'member',
    is_active: row.is_active === 0 || row.is_active === false ? 0 : 1
  };
}

function publicPortfolio(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    color: row.color || COLORS[0],
    is_default: row.is_default === 1 || row.is_default === true,
    owner_user_id: Number(row.owner_user_id),
    owner_name: row.owner_name || '',
    owner_username: row.owner_username || ''
  };
}

function initialPasswordHash() {
  const hashEnv = process.env.APP_PASSWORD_HASH;
  if (hashEnv && String(hashEnv).startsWith('scrypt$')) return String(hashEnv);
  return passwords().scryptHash(process.env.APP_PASSWORD || 'admin');
}

async function ignoreDup(run) {
  try {
    await run();
  } catch (err) {
    if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.code === 85 || err.code === 86 || err.code === 11000)) {
      return;
    }
    throw err;
  }
}

async function ensureMysqlFoundation(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(128) NOT NULL,
      role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_app_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      description VARCHAR(255) NULL,
      owner_user_id INT NOT NULL,
      color VARCHAR(16) NOT NULL DEFAULT '#2563eb',
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_portfolio_owner (owner_user_id),
      CONSTRAINT fk_portfolio_owner FOREIGN KEY (owner_user_id) REFERENCES app_users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS portfolio_members (
      portfolio_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('owner', 'editor', 'viewer') NOT NULL DEFAULT 'editor',
      PRIMARY KEY (portfolio_id, user_id),
      CONSTRAINT fk_member_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
      CONSTRAINT fk_member_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const alters = [
    ...[...SCOPED].map((table) => `ALTER TABLE \`${table}\` ADD COLUMN portfolio_id INT NULL`),
    ...[...SCOPED].map((table) => `ALTER TABLE \`${table}\` ADD INDEX idx_${table}_portfolio (portfolio_id)`)
  ];
  for (const sql of alters) {
    try {
      await connection.query(sql);
    } catch (err) {
      if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME')) continue;
      logger.error('Portfolio column migration failed', { sql, code: err?.code, message: err?.message });
    }
  }

  const triggers = [
    ['trg_pf_inv_hist_bi', 'investment_history', 'investments', 'investment_id'],
    ['trg_pf_inv_txn_bi', 'investment_transactions', 'investments', 'investment_id'],
    ['trg_pf_mf_nav_bi', 'mutual_fund_nav_history', 'investments', 'investment_id'],
    ['trg_pf_bank_txn_bi', 'bank_transactions', 'bank_accounts', 'account_id']
  ];
  for (const [name, table, parent, key] of triggers) {
    try {
      const [existing] = await connection.query(
        `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
        [name]
      );
      if (existing.length) continue;
      await connection.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON \`${table}\`
         FOR EACH ROW
         SET NEW.portfolio_id = IFNULL(NEW.portfolio_id,
           (SELECT portfolio_id FROM \`${parent}\` WHERE id = NEW.\`${key}\`))`
      );
    } catch (err) {
      logger.warn('Portfolio insert trigger skipped', { name, message: err?.message });
    }
  }

  await seedMysql(connection);
  logger.info('Portfolio foundation ready');
}

async function seedMysql(connection) {
  const [users] = await connection.query('SELECT id, username, role FROM app_users ORDER BY id ASC LIMIT 1');
  let userId = users[0]?.id;
  if (!userId) {
    const username = cleanUsername(process.env.APP_USER || 'amol') || 'amol';
    const [created] = await connection.query(
      `INSERT INTO app_users (username, password_hash, display_name, role, is_active)
       VALUES (?, ?, ?, 'admin', 1)`,
      [username, initialPasswordHash(), username]
    );
    userId = created.insertId;
    logger.info('Created admin user from APP_USER', { username });
  }

  const [ports] = await connection.query('SELECT id FROM portfolios ORDER BY id ASC LIMIT 1');
  let portfolioId = ports[0]?.id;
  if (!portfolioId) {
    const [created] = await connection.query(
      `INSERT INTO portfolios (name, description, owner_user_id, color, is_default)
       VALUES ('Primary', 'Default portfolio', ?, ?, 1)`,
      [userId, COLORS[0]]
    );
    portfolioId = created.insertId;
    await connection.query(
      `INSERT IGNORE INTO portfolio_members (portfolio_id, user_id, role) VALUES (?, ?, 'owner')`,
      [portfolioId, userId]
    );
  }

  try {
    await connection.query('UPDATE investments SET portfolio_id = ? WHERE portfolio_id IS NULL', [portfolioId]);
    await connection.query('UPDATE bank_accounts SET portfolio_id = ? WHERE portfolio_id IS NULL', [portfolioId]);
  } catch (err) {
    logger.warn('Portfolio backfill skipped', { message: err?.message });
  }
  const childUpdates = [
    `UPDATE investment_history h JOIN investments i ON i.id = h.investment_id
     SET h.portfolio_id = i.portfolio_id WHERE h.portfolio_id IS NULL AND i.portfolio_id IS NOT NULL`,
    `UPDATE investment_transactions t JOIN investments i ON i.id = t.investment_id
     SET t.portfolio_id = i.portfolio_id WHERE t.portfolio_id IS NULL AND i.portfolio_id IS NOT NULL`,
    `UPDATE mutual_fund_nav_history n JOIN investments i ON i.id = n.investment_id
     SET n.portfolio_id = i.portfolio_id WHERE n.portfolio_id IS NULL AND i.portfolio_id IS NOT NULL`,
    `UPDATE bank_transactions t JOIN bank_accounts a ON a.id = t.account_id
     SET t.portfolio_id = a.portfolio_id WHERE t.portfolio_id IS NULL AND a.portfolio_id IS NOT NULL`
  ];
  for (const sql of childUpdates) {
    try {
      await connection.query(sql);
    } catch (err) {
      logger.warn('Portfolio backfill skipped', { message: err?.message });
    }
  }
  for (const table of CHILD_TABLES) {
    try {
      await connection.query(`UPDATE \`${table}\` SET portfolio_id = ? WHERE portfolio_id IS NULL`, [portfolioId]);
    } catch (err) {
      logger.warn('Portfolio backfill skipped', { table, message: err?.message });
    }
  }
}

async function nextMongoId(db, name) {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = result?.seq ?? result?.value?.seq;
  if (!seq) throw new Error(`Could not allocate id for ${name}`);
  return seq;
}

async function ensureMongoFoundation(db) {
  await ignoreDup(() => db.collection('app_users').createIndex({ username: 1 }, { unique: true }));
  await ignoreDup(() => db.collection('portfolios').createIndex({ owner_user_id: 1 }));
  await ignoreDup(() => db.collection('portfolio_members').createIndex({ user_id: 1 }));
  await ignoreDup(() => db.collection('portfolio_members').createIndex({ portfolio_id: 1, user_id: 1 }, { unique: true }));
  for (const name of SCOPED) {
    await ignoreDup(() => db.collection(name).createIndex({ portfolio_id: 1 }));
  }

  let user = await db.collection('app_users').find({}).sort({ id: 1 }).limit(1).next();
  if (!user) {
    const username = cleanUsername(process.env.APP_USER || 'amol') || 'amol';
    user = {
      id: await nextMongoId(db, 'app_users'),
      username,
      password_hash: initialPasswordHash(),
      display_name: username,
      role: 'admin',
      is_active: 1,
      created_at: new Date()
    };
    await db.collection('app_users').insertOne(user);
    logger.info('Created admin user from APP_USER', { username });
  }

  let portfolio = await db.collection('portfolios').find({}).sort({ id: 1 }).limit(1).next();
  if (!portfolio) {
    portfolio = {
      id: await nextMongoId(db, 'portfolios'),
      name: 'Primary',
      description: 'Default portfolio',
      owner_user_id: user.id,
      color: COLORS[0],
      is_default: 1,
      created_at: new Date()
    };
    await db.collection('portfolios').insertOne(portfolio);
    await db.collection('portfolio_members').insertOne({
      portfolio_id: portfolio.id,
      user_id: user.id,
      role: 'owner'
    });
  }

  const defaultId = portfolio.id;
  const missing = { $or: [{ portfolio_id: null }, { portfolio_id: { $exists: false } }] };
  await db.collection('investments').updateMany(missing, { $set: { portfolio_id: defaultId } });
  await db.collection('bank_accounts').updateMany(missing, { $set: { portfolio_id: defaultId } });
  await backfillMongoChildren(db, 'investment_history', 'investments', 'investment_id', defaultId);
  await backfillMongoChildren(db, 'investment_transactions', 'investments', 'investment_id', defaultId);
  await backfillMongoChildren(db, 'mutual_fund_nav_history', 'investments', 'investment_id', defaultId);
  await backfillMongoChildren(db, 'bank_transactions', 'bank_accounts', 'account_id', defaultId);
  for (const name of ['bank_category_rules', 'bank_budgets']) {
    await db.collection(name).updateMany(missing, { $set: { portfolio_id: defaultId } });
  }
  logger.info('Portfolio foundation ready');
}

async function backfillMongoChildren(db, child, parent, key, defaultId) {
  const rows = await db.collection(child).aggregate([
    { $match: { $or: [{ portfolio_id: null }, { portfolio_id: { $exists: false } }] } },
    { $lookup: { from: parent, localField: key, foreignField: 'id', as: 'parent' } },
    { $project: { portfolio_id: { $ifNull: [{ $arrayElemAt: ['$parent.portfolio_id', 0] }, defaultId] } } }
  ]).toArray();
  if (!rows.length) return;
  await db.collection(child).bulkWrite(rows.map((row) => ({
    updateOne: {
      filter: { _id: row._id },
      update: { $set: { portfolio_id: row.portfolio_id } }
    }
  })));
}

function dbKind() {
  return isMongoDb() ? 'mongo' : 'mysql';
}

async function findUserByUsername(username) {
  const name = cleanUsername(username);
  if (!name) return null;
  if (dbKind() === 'mongo') {
    const row = await getMongoDb().collection('app_users').findOne({
      username: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });
    return row;
  }
  const [rows] = await getPool().query(
    'SELECT * FROM app_users WHERE LOWER(username) = LOWER(?) LIMIT 1',
    [name]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const num = Number(id);
  if (!num) return null;
  if (dbKind() === 'mongo') {
    return getMongoDb().collection('app_users').findOne({ id: num });
  }
  const [rows] = await getPool().query('SELECT * FROM app_users WHERE id = ?', [num]);
  return rows[0] || null;
}

async function listUsers() {
  if (dbKind() === 'mongo') {
    const rows = await getMongoDb().collection('app_users').find({}).sort({ display_name: 1 }).toArray();
    return rows.map(publicUser);
  }
  const [rows] = await getPool().query(
    'SELECT id, username, display_name, role, is_active FROM app_users ORDER BY display_name ASC, username ASC'
  );
  return rows.map(publicUser);
}

async function portfoliosFor(user) {
  if (dbKind() === 'mongo') return mongoPortfoliosFor(user);
  const pool = getPool();
  const sql = user.role === 'admin'
    ? `SELECT p.*, u.display_name AS owner_name, u.username AS owner_username
       FROM portfolios p JOIN app_users u ON u.id = p.owner_user_id
       ORDER BY u.display_name, p.name`
    : `SELECT p.*, u.display_name AS owner_name, u.username AS owner_username
       FROM portfolios p JOIN app_users u ON u.id = p.owner_user_id
       WHERE p.owner_user_id = ? OR p.id IN (SELECT portfolio_id FROM portfolio_members WHERE user_id = ?)
       ORDER BY p.is_default DESC, p.name`;
  const params = user.role === 'admin' ? [] : [user.id, user.id];
  const [rows] = await pool.query(sql, params);
  return rows.map(publicPortfolio);
}

async function mongoPortfoliosFor(user) {
  const db = getMongoDb();
  let rows;
  if (user.role === 'admin') {
    rows = await db.collection('portfolios').find({}).sort({ name: 1 }).toArray();
  } else {
    const memberOf = await db.collection('portfolio_members').find({ user_id: user.id }).toArray();
    const ids = memberOf.map((row) => row.portfolio_id);
    rows = await db.collection('portfolios').find({
      $or: [{ owner_user_id: user.id }, { id: { $in: ids.length ? ids : [-1] } }]
    }).sort({ name: 1 }).toArray();
  }
  const owners = await db.collection('app_users').find({}).toArray();
  const byId = new Map(owners.map((owner) => [owner.id, owner]));
  return rows.map((row) => publicPortfolio({
    ...row,
    owner_name: byId.get(row.owner_user_id)?.display_name || '',
    owner_username: byId.get(row.owner_user_id)?.username || ''
  }));
}

async function portfolioExists(id) {
  const num = Number(id);
  if (dbKind() === 'mongo') {
    const row = await getMongoDb().collection('portfolios').findOne({ id: num });
    return !!row;
  }
  const [rows] = await getPool().query('SELECT id FROM portfolios WHERE id = ?', [num]);
  return rows.length > 0;
}

async function resolveScope(sessionUser, header) {
  let user = null;
  if (sessionUser?.userId) user = await findUserById(sessionUser.userId);
  if (!user && sessionUser?.username) user = await findUserByUsername(sessionUser.username);
  if (!user || user.is_active === 0 || user.is_active === false) {
    throw httpError(401, 'Unauthorized');
  }
  const portfolios = await portfoliosFor(user);
  const ids = portfolios.map((row) => row.id);
  const ownedDefault = portfolios.find((row) => row.is_default && row.owner_user_id === Number(user.id));
  const fallback = ownedDefault || portfolios.find((row) => row.is_default) || portfolios[0] || null;
  const requestedRaw = header == null ? '' : String(header).trim();
  const requested = requestedRaw && requestedRaw !== 'all' ? Number(requestedRaw) : null;
  let mode = 'all';
  let scopeIds = ids;
  let unrestricted = user.role === 'admin';
  if (requested && Number.isInteger(requested) && requested > 0) {
    const allowed = user.role === 'admin' ? await portfolioExists(requested) : ids.includes(requested);
    if (allowed) {
      mode = 'one';
      scopeIds = [requested];
      unrestricted = false;
    }
  }
  const activeId = mode === 'one' ? scopeIds[0] : null;
  return {
    userId: Number(user.id),
    role: user.role,
    username: user.username,
    display_name: user.display_name || user.username,
    mode,
    ids: scopeIds,
    unrestricted,
    defaultPortfolioId: activeId || (fallback ? fallback.id : null),
    portfolios
  };
}

function contextFrom(scope, users) {
  return {
    user: {
      id: scope.userId,
      username: scope.username,
      display_name: scope.display_name,
      role: scope.role
    },
    portfolios: scope.portfolios || [],
    users: scope.role === 'admin' ? users : [],
    scopeMode: scope.mode,
    activePortfolioId: scope.mode === 'one' ? scope.ids[0] : 'all',
    writePortfolioId: scope.mode === 'one' ? scope.ids[0] : scope.defaultPortfolioId
  };
}

async function contextFor(scope) {
  const users = scope.role === 'admin' ? await listUsers() : [];
  return contextFrom(scope, users);
}

async function summaryFor(user) {
  return runUnrestricted(() => (dbKind() === 'mongo' ? mongoSummary(user) : mysqlSummary(user)));
}

async function mysqlSummary(user) {
  const pool = getPool();
  const where = user.role === 'admin'
    ? ''
    : 'WHERE p.owner_user_id = ? OR p.id IN (SELECT portfolio_id FROM portfolio_members WHERE user_id = ?)';
  const params = user.role === 'admin' ? [] : [user.id, user.id];
  const [rows] = await pool.query(
    `SELECT p.*, u.display_name AS owner_name, u.username AS owner_username,
       (SELECT COUNT(*) FROM investments i WHERE i.portfolio_id = p.id) AS investment_count,
       (SELECT COALESCE(SUM(i.amount), 0) FROM investments i WHERE i.portfolio_id = p.id) AS investment_total,
       (SELECT COUNT(*) FROM bank_accounts a WHERE a.portfolio_id = p.id) AS account_count
     FROM portfolios p
     JOIN app_users u ON u.id = p.owner_user_id
     ${where}
     ORDER BY u.display_name, p.name`,
    params
  );
  return rows.map((row) => ({
    ...publicPortfolio(row),
    investment_count: Number(row.investment_count) || 0,
    investment_total: Number(row.investment_total) || 0,
    account_count: Number(row.account_count) || 0
  }));
}

async function mongoSummary(user) {
  const portfolios = await mongoPortfoliosFor(user);
  const db = getMongoDb();
  const ids = portfolios.map((row) => row.id);
  const match = { portfolio_id: { $in: ids.length ? ids : [-1] } };
  const [investments, accounts] = await Promise.all([
    db.collection('investments').aggregate([
      { $match: match },
      { $group: { _id: '$portfolio_id', investment_count: { $sum: 1 }, investment_total: { $sum: '$amount' } } }
    ]).toArray(),
    db.collection('bank_accounts').aggregate([
      { $match: match },
      { $group: { _id: '$portfolio_id', account_count: { $sum: 1 } } }
    ]).toArray()
  ]);
  const inv = new Map(investments.map((row) => [Number(row._id), row]));
  const acct = new Map(accounts.map((row) => [Number(row._id), row]));
  return portfolios.map((row) => ({
    ...row,
    investment_count: inv.get(row.id)?.investment_count || 0,
    investment_total: Number(inv.get(row.id)?.investment_total) || 0,
    account_count: acct.get(row.id)?.account_count || 0
  }));
}

async function countAdmins(exceptId) {
  if (dbKind() === 'mongo') {
    const rows = await getMongoDb().collection('app_users').find({ role: 'admin', is_active: 1 }).toArray();
    return rows.filter((row) => Number(row.id) !== Number(exceptId)).length;
  }
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS c FROM app_users WHERE role = 'admin' AND is_active = 1 AND id <> ?`,
    [Number(exceptId) || 0]
  );
  return Number(rows[0].c);
}

async function insertPortfolio(ownerId, name, description, color, isDefault) {
  if (dbKind() === 'mongo') {
    const db = getMongoDb();
    const doc = {
      id: await nextMongoId(db, 'portfolios'),
      name,
      description: description || '',
      owner_user_id: ownerId,
      color: color || COLORS[0],
      is_default: isDefault ? 1 : 0,
      created_at: new Date()
    };
    await db.collection('portfolios').insertOne(doc);
    await db.collection('portfolio_members').insertOne({ portfolio_id: doc.id, user_id: ownerId, role: 'owner' });
    return doc.id;
  }
  const pool = getPool();
  const [created] = await pool.query(
    `INSERT INTO portfolios (name, description, owner_user_id, color, is_default) VALUES (?, ?, ?, ?, ?)`,
    [name, description || null, ownerId, color || COLORS[0], isDefault ? 1 : 0]
  );
  await pool.query(
    `INSERT IGNORE INTO portfolio_members (portfolio_id, user_id, role) VALUES (?, ?, 'owner')`,
    [created.insertId, ownerId]
  );
  return created.insertId;
}

async function createUser(actor, body) {
  if (actor.role !== 'admin') throw httpError(403, 'Only an admin can add users');
  const username = cleanUsername(body.username);
  const password = String(body.password || '');
  const display = cleanUsername(body.display_name) || username;
  const role = body.role === 'admin' ? 'admin' : 'member';
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    throw httpError(400, 'Username must be 3–64 letters, numbers, dots, dashes, or underscores');
  }
  if (password.length < 4) throw httpError(400, 'Password must be at least 4 characters');
  const hash = passwords().scryptHash(password);
  if (await findUserByUsername(username)) throw httpError(409, 'That username is already in use');

  let userId;
  if (dbKind() === 'mongo') {
    const db = getMongoDb();
    userId = await nextMongoId(db, 'app_users');
    await db.collection('app_users').insertOne({
      id: userId,
      username,
      password_hash: hash,
      display_name: display,
      role,
      is_active: 1,
      created_at: new Date()
    });
  } else {
    try {
      const [created] = await getPool().query(
        `INSERT INTO app_users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)`,
        [username, hash, display, role]
      );
      userId = created.insertId;
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') throw httpError(409, 'That username is already in use');
      throw err;
    }
  }
  const portfolioId = await insertPortfolio(userId, `${display} portfolio`, '', COLORS[userId % COLORS.length], true);
  const user = publicUser(await findUserById(userId));
  return { user, portfolioId };
}

async function updateUser(actor, id, body) {
  if (actor.role !== 'admin') throw httpError(403, 'Only an admin can change users');
  const existing = await findUserById(id);
  if (!existing) throw httpError(404, 'User not found');
  const role = body.role === 'admin' || body.role === 'member' ? body.role : existing.role;
  const isActive = body.is_active === 0 || body.is_active === false ? 0 : (body.is_active === 1 || body.is_active === true ? 1 : (existing.is_active === 0 ? 0 : 1));
  if (Number(actor.userId) === Number(existing.id) && (role !== 'admin' || isActive === 0)) {
    throw httpError(400, 'You cannot remove your own admin access');
  }
  if ((existing.role === 'admin' && existing.is_active !== 0) && (role !== 'admin' || isActive === 0)) {
    const others = await countAdmins(existing.id);
    if (others < 1) throw httpError(400, 'Keep at least one active admin');
  }
  const display = body.display_name != null ? cleanUsername(body.display_name) || existing.display_name : existing.display_name;
  const hash = body.password ? passwords().scryptHash(String(body.password)) : null;
  if (body.password && String(body.password).length < 4) throw httpError(400, 'Password must be at least 4 characters');

  if (dbKind() === 'mongo') {
    const set = { display_name: display, role, is_active: isActive };
    if (hash) set.password_hash = hash;
    await getMongoDb().collection('app_users').updateOne({ id: Number(id) }, { $set: set });
  } else if (hash) {
    await getPool().query(
      'UPDATE app_users SET display_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?',
      [display, role, isActive, hash, Number(id)]
    );
  } else {
    await getPool().query(
      'UPDATE app_users SET display_name = ?, role = ?, is_active = ? WHERE id = ?',
      [display, role, isActive, Number(id)]
    );
  }
  return publicUser(await findUserById(id));
}

async function assertCanUsePortfolio(actor, portfolio) {
  if (!portfolio) throw httpError(404, 'Portfolio not found');
  if (actor.role === 'admin') return portfolio;
  const allowed = await portfoliosFor({ id: actor.userId, role: actor.role });
  if (!allowed.some((row) => row.id === Number(portfolio.id))) {
    throw httpError(403, 'You do not have access to that portfolio');
  }
  return portfolio;
}

async function getPortfolioRow(id) {
  const num = Number(id);
  if (dbKind() === 'mongo') return getMongoDb().collection('portfolios').findOne({ id: num });
  const [rows] = await getPool().query('SELECT * FROM portfolios WHERE id = ?', [num]);
  return rows[0] || null;
}

async function createPortfolio(actor, body) {
  const name = cleanUsername(body.name);
  if (!name || name.length > 128) throw httpError(400, 'Portfolio name is required');
  let ownerId = Number(actor.userId);
  if (actor.role === 'admin' && body.owner_user_id) {
    const owner = await findUserById(body.owner_user_id);
    if (!owner) throw httpError(400, 'Owner not found');
    ownerId = Number(owner.id);
  }
  const owned = await portfoliosFor({ id: ownerId, role: 'member' });
  const isDefault = owned.length === 0;
  const color = cleanColor(body.color, COLORS[owned.length % COLORS.length]);
  const id = await insertPortfolio(ownerId, name, cleanUsername(body.description), color, isDefault);
  const row = await getPortfolioRow(id);
  const owner = await findUserById(ownerId);
  return publicPortfolio({
    ...row,
    owner_name: owner?.display_name || '',
    owner_username: owner?.username || ''
  });
}

async function updatePortfolio(actor, id, body) {
  const existing = await assertCanUsePortfolio(actor, await getPortfolioRow(id));
  const name = body.name != null ? cleanUsername(body.name) : existing.name;
  if (!name) throw httpError(400, 'Portfolio name is required');
  const description = body.description != null ? cleanUsername(body.description) : (existing.description || '');
  const color = cleanColor(body.color, existing.color || COLORS[0]);
  const makeDefault = body.is_default === true || body.is_default === 1;
  if (dbKind() === 'mongo') {
    const db = getMongoDb();
    if (makeDefault) {
      await db.collection('portfolios').updateMany({ owner_user_id: existing.owner_user_id }, { $set: { is_default: 0 } });
    }
    await db.collection('portfolios').updateOne(
      { id: Number(id) },
      { $set: { name, description, color, is_default: makeDefault ? 1 : (existing.is_default ? 1 : 0) } }
    );
  } else {
    const pool = getPool();
    if (makeDefault) {
      await pool.query('UPDATE portfolios SET is_default = 0 WHERE owner_user_id = ?', [existing.owner_user_id]);
    }
    await pool.query(
      'UPDATE portfolios SET name = ?, description = ?, color = ?, is_default = ? WHERE id = ?',
      [name, description || null, color, makeDefault ? 1 : (existing.is_default ? 1 : 0), Number(id)]
    );
  }
  const row = await getPortfolioRow(id);
  const owner = await findUserById(row.owner_user_id);
  return publicPortfolio({ ...row, owner_name: owner?.display_name || '', owner_username: owner?.username || '' });
}

async function usageCounts(portfolioId) {
  return runUnrestricted(async () => {
    if (dbKind() === 'mongo') {
      const db = getMongoDb();
      const [investments, accounts] = await Promise.all([
        db.collection('investments').countDocuments({ portfolio_id: Number(portfolioId) }),
        db.collection('bank_accounts').countDocuments({ portfolio_id: Number(portfolioId) })
      ]);
      return { investments, accounts };
    }
    const pool = getPool();
    const [inv] = await pool.query('SELECT COUNT(*) AS c FROM investments WHERE portfolio_id = ?', [portfolioId]);
    const [acct] = await pool.query('SELECT COUNT(*) AS c FROM bank_accounts WHERE portfolio_id = ?', [portfolioId]);
    return { investments: Number(inv[0].c), accounts: Number(acct[0].c) };
  });
}

async function deletePortfolio(actor, id) {
  const existing = await assertCanUsePortfolio(actor, await getPortfolioRow(id));
  const usage = await usageCounts(existing.id);
  if (usage.investments || usage.accounts) {
    throw httpError(400, 'This portfolio still has holdings or bank accounts. Move them off it before deleting.');
  }
  const owned = (await portfoliosFor({ id: existing.owner_user_id, role: 'member' }))
    .filter((row) => row.owner_user_id === Number(existing.owner_user_id));
  if (owned.length <= 1) throw httpError(400, 'Keep at least one portfolio for this person');
  if (dbKind() === 'mongo') {
    const db = getMongoDb();
    await db.collection('portfolio_members').deleteMany({ portfolio_id: Number(id) });
    await db.collection('portfolios').deleteOne({ id: Number(id) });
    if (existing.is_default) {
      const next = await db.collection('portfolios').find({ owner_user_id: existing.owner_user_id }).sort({ id: 1 }).limit(1).next();
      if (next) await db.collection('portfolios').updateOne({ id: next.id }, { $set: { is_default: 1 } });
    }
  } else {
    const pool = getPool();
    await pool.query('DELETE FROM portfolios WHERE id = ?', [Number(id)]);
    if (existing.is_default) {
      await pool.query(
        `UPDATE portfolios SET is_default = 1
         WHERE id = (
           SELECT id FROM (
             SELECT id FROM portfolios WHERE owner_user_id = ? ORDER BY id ASC LIMIT 1
           ) next_portfolio
         )`,
        [existing.owner_user_id]
      );
    }
  }
  return { deleted: true, id: Number(id) };
}

async function ensureEnvAdmin(username, password) {
  const existing = await findUserByUsername(username);
  const hash = passwords().scryptHash(password);
  if (existing) {
    if (!String(existing.password_hash || '').startsWith('scrypt$')) {
      if (dbKind() === 'mongo') {
        await getMongoDb().collection('app_users').updateOne({ id: existing.id }, { $set: { password_hash: hash } });
      } else {
        await getPool().query('UPDATE app_users SET password_hash = ? WHERE id = ?', [hash, existing.id]);
      }
      existing.password_hash = hash;
    }
    return existing;
  }
  const created = await createUser(
    { role: 'admin', userId: 0 },
    { username, password, display_name: username, role: 'admin' }
  );
  return findUserById(created.user.id);
}

function writeTargetId() {
  return getWritePortfolioId();
}

module.exports = {
  ensureMysqlFoundation,
  ensureMongoFoundation,
  findUserByUsername,
  resolveScope,
  contextFor,
  summaryFor,
  createUser,
  updateUser,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  ensureEnvAdmin,
  writeTargetId,
  listUsers
};
