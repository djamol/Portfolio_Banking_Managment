const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../utils/logger');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'portfolio',
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

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
};

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
  getConnectionSummary
};
