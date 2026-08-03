const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../utils/logger');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'portfolio',
  // Keep DATE/DATETIME as YYYY-MM-DD strings so IST/UTC never shifts calendar days in JSON.
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pool;

function getConnectionSummary() {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    password: logger.redact(dbConfig.password)
  };
}

/** Presets for login UI: localhost (host MySQL) vs in-container / compose DB. */
function getDatabasePresets() {
  const localhostHost = process.env.DB_HOST_LOCALHOST || 'host.docker.internal';
  const dockerHost = process.env.DB_HOST_DOCKER || '127.0.0.1';
  // Host MySQL port — do not use MYSQL_PUBLISH_PORT (that's only the Docker host mapping).
  const localhostPort = Number(process.env.DB_PORT_LOCALHOST) || 3306;
  // In-container listen port (always 3306 for embedded). Publish is host:3307 → container:3306.
  const dockerPort =
    Number(process.env.DB_PORT_DOCKER) ||
    Number(process.env.EMBEDDED_MYSQL_PORT) ||
    3306;

  return [
    {
      id: 'localhost',
      label: 'Localhost (host MySQL)',
      host: localhostHost,
      port: localhostPort,
      description: 'MySQL on the host machine'
    },
    {
      id: 'docker',
      label: 'Internal Docker DB',
      host: dockerHost,
      port: dockerPort,
      description: 'Embedded MariaDB (container :3306; host publish optional)'
    }
  ];
}

function matchPresetId(host, port) {
  const h = String(host || '').toLowerCase();
  const p = Number(port) || 3306;
  const presets = getDatabasePresets();
  const match = presets.find(
    (preset) => preset.host.toLowerCase() === h && Number(preset.port) === p
  );
  if (match) return match.id;
  // Common aliases
  if (h === 'localhost' || h === '127.0.0.1') {
    const docker = presets.find((preset) => preset.id === 'docker');
    if (docker && docker.host.toLowerCase() === h) return 'docker';
    if (h === '127.0.0.1') return 'docker';
    if (h === 'localhost') return 'localhost';
  }
  if (h === 'host.docker.internal' || h === 'db') {
    return h === 'db' ? 'docker' : 'localhost';
  }
  return null;
}

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
};

async function closePool() {
  if (!pool) return;
  try {
    await pool.end();
  } catch (error) {
    logger.warn('MySQL: error closing pool', { message: error.message });
  }
  pool = null;
}

const initializeDatabaseOnce = async () => {
  logger.info('MySQL: connecting', getConnectionSummary());

  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    connectTimeout: 10000
  });

  logger.info('MySQL: server reachable, ensuring database exists', { database: dbConfig.database });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
  await connection.end();

  pool = mysql.createPool(dbConfig);
  await createTables();
  logger.info('MySQL: initialization complete', getConnectionSummary());
};

const initializeDatabase = async () => {
  const maxAttempts = Number(process.env.DB_CONNECT_RETRIES) || 15;
  const delayMs = Number(process.env.DB_CONNECT_DELAY_MS) || 2000;

  logger.info('MySQL: starting connection attempts', {
    maxAttempts,
    delayMs,
    maxWaitSeconds: Math.round((maxAttempts * delayMs) / 1000),
    ...getConnectionSummary()
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initializeDatabaseOnce();
      return;
    } catch (error) {
      logger.logError(`MySQL initialization attempt ${attempt}/${maxAttempts}`, error, getConnectionSummary());
      pool = null;
      if (attempt === maxAttempts) {
        logger.error('MySQL: all connection attempts exhausted', {
          hint: 'Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and that MySQL is running'
        });
        throw error;
      }
      logger.warn('MySQL: retrying connection', { attempt, nextRetryInMs: delayMs });
      await sleep(delayMs);
    }
  }
};

/**
 * Switch MySQL target at runtime (login page localhost vs internal Docker DB).
 * @param {{ host?: string, port?: number|string, user?: string, password?: string, database?: string }} overrides
 */
async function reconfigureDatabase(overrides = {}) {
  const previous = {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database
  };

  const next = {
    host: overrides.host != null ? String(overrides.host).trim() : dbConfig.host,
    port: overrides.port != null ? Number(overrides.port) || dbConfig.port : dbConfig.port,
    user: overrides.user != null ? String(overrides.user).trim() : dbConfig.user,
    password: overrides.password != null ? String(overrides.password) : dbConfig.password,
    database: overrides.database != null ? String(overrides.database).trim() : dbConfig.database
  };

  if (!next.host) {
    throw new Error('DB host is required');
  }

  if (
    next.host === previous.host &&
    next.port === previous.port &&
    next.user === previous.user &&
    next.password === previous.password &&
    next.database === previous.database
  ) {
    return getConnectionSummary();
  }

  logger.info('MySQL: reconfigure requested', {
    from: getConnectionSummary(),
    to: {
      host: next.host,
      port: next.port,
      user: next.user,
      database: next.database,
      password: logger.redact(next.password)
    }
  });

  await closePool();

  const applyConfig = (cfg) => {
    dbConfig.host = cfg.host;
    dbConfig.port = cfg.port;
    dbConfig.user = cfg.user;
    dbConfig.password = cfg.password;
    dbConfig.database = cfg.database;
    process.env.DB_HOST = dbConfig.host;
    process.env.DB_PORT = String(dbConfig.port);
    process.env.DB_USER = dbConfig.user;
    process.env.DB_PASSWORD = dbConfig.password;
    process.env.DB_NAME = dbConfig.database;
  };

  applyConfig(next);

  try {
    await initializeDatabaseOnce();
    return getConnectionSummary();
  } catch (error) {
    logger.logError('MySQL: reconfigure failed, restoring previous connection', error);
    await closePool();
    applyConfig(previous);
    try {
      await initializeDatabaseOnce();
    } catch (restoreError) {
      logger.logError('MySQL: failed to restore previous connection', restoreError);
    }
    throw error;
  }
}


const createTables = async () => {
  const connection = await pool.getConnection();

  try {
    logger.info('MySQL: creating tables if missing');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS investments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        website_app_name VARCHAR(255) NOT NULL,
        investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'EPF', 'Saving Bank Balance') NOT NULL,
        sub_type_name VARCHAR(255),
        sub_type_category VARCHAR(255),
        amount DECIMAL(15, 2) NOT NULL,
        investment_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_investment_type (investment_type),
        INDEX idx_investment_date (investment_date),
        INDEX idx_website_app (website_app_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS investment_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        investment_id INT NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        change_date DATE NOT NULL,
        change_type ENUM('added', 'removed', 'updated') NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE,
        INDEX idx_investment_id (investment_id),
        INDEX idx_change_date (change_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS sub_type_names (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'EPF', 'Saving Bank Balance') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_investment_type (investment_type),
        INDEX idx_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS sub_type_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(255) NOT NULL,
        sub_type_name_id INT,
        investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'EPF', 'Saving Bank Balance') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sub_type_name_id) REFERENCES sub_type_names(id) ON DELETE SET NULL,
        INDEX idx_investment_type (investment_type),
        INDEX idx_sub_type_name_id (sub_type_name_id),
        UNIQUE KEY unique_category_subtype (category, sub_type_name_id, investment_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS investment_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        investment_id INT NOT NULL,
        txn_date DATE NOT NULL,
        txn_type ENUM(
          'buy',
          'sell',
          'dividend',
          'interest',
          'fee',
          'deposit',
          'withdrawal',
          'transfer_in',
          'transfer_out'
        ) NOT NULL,
        units DECIMAL(20, 8) NULL,
        price DECIMAL(20, 8) NULL,
        cashflow_amount DECIMAL(15, 2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE,
        INDEX idx_txn_investment_id (investment_id),
        INDEX idx_txn_date (txn_date),
        INDEX idx_txn_type (txn_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bank_name VARCHAR(100) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(64) NULL,
        ifsc VARCHAR(32) NULL,
        account_type VARCHAR(64) DEFAULT 'Savings',
        currency VARCHAR(8) DEFAULT 'INR',
        opening_balance DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bank_name (bank_name),
        INDEX idx_account_number (account_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        txn_date DATE NOT NULL,
        value_date DATE NULL,
        narration TEXT,
        ref_no VARCHAR(128) NULL,
        withdrawal DECIMAL(15, 2) NOT NULL DEFAULT 0,
        deposit DECIMAL(15, 2) NOT NULL DEFAULT 0,
        balance DECIMAL(15, 2) NULL,
        category VARCHAR(150) NULL,
        category_source VARCHAR(16) DEFAULT 'auto',
        payee VARCHAR(255) NULL,
        txn_type VARCHAR(32) NULL,
        fingerprint CHAR(64) NOT NULL,
        raw_bank VARCHAR(32) NULL,
        tags VARCHAR(255) NULL,
        notes TEXT,
        import_batch_id VARCHAR(64) NULL,
        linked_transfer_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE,
        UNIQUE KEY uq_bank_txn_fingerprint (account_id, fingerprint),
        INDEX idx_bank_txn_date (txn_date),
        INDEX idx_bank_txn_account (account_id),
        INDEX idx_bank_txn_category (category),
        INDEX idx_bank_txn_type (txn_type),
        INDEX idx_bank_txn_payee (payee),
        INDEX idx_bank_txn_batch (import_batch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bank_category_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pattern VARCHAR(255) NOT NULL,
        match_field VARCHAR(32) NOT NULL DEFAULT 'narration',
        category VARCHAR(100) NOT NULL,
        priority INT NOT NULL DEFAULT 100,
        account_id INT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bank_rule_priority (priority),
        INDEX idx_bank_rule_account (account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bank_budgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        period_month CHAR(7) NULL,
        account_id INT NULL,
        notes VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bank_budget_month (period_month),
        INDEX idx_bank_budget_category (category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Migrate existing installs: add new columns if missing
    const alterStatements = [
      'ALTER TABLE bank_transactions ADD COLUMN category_source VARCHAR(16) DEFAULT \'auto\'',
      'ALTER TABLE bank_transactions ADD COLUMN payee VARCHAR(255) NULL',
      'ALTER TABLE bank_transactions ADD COLUMN linked_transfer_id INT NULL',
      'ALTER TABLE bank_transactions ADD INDEX idx_bank_txn_payee (payee)',
      'ALTER TABLE bank_transactions ADD INDEX idx_bank_txn_batch (import_batch_id)',
      'ALTER TABLE bank_transactions MODIFY COLUMN category VARCHAR(150) NULL',
      'ALTER TABLE bank_category_rules MODIFY COLUMN category VARCHAR(150) NOT NULL',
      'ALTER TABLE bank_budgets MODIFY COLUMN category VARCHAR(150) NOT NULL'
    ];
    for (const sql of alterStatements) {
      try {
        await connection.query(sql);
      } catch (err) {
        // Duplicate column / duplicate key name
        if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME')) continue;
        throw err;
      }
    }

    logger.info('MySQL: tables ready');
  } catch (error) {
    logger.logError('MySQL table creation', error);
    throw error;
  } finally {
    connection.release();
  }
};

const ensureTablesExist = async () => {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  await createTables();
};

module.exports = {
  getPool,
  initializeDatabase,
  ensureTablesExist,
  getConnectionSummary,
  getDatabasePresets,
  matchPresetId,
  reconfigureDatabase
};
