const mysql = require('mysql2/promise');
require('dotenv').config();

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

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
};

const initializeDatabaseOnce = async () => {
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
  await connection.end();

  pool = mysql.createPool(dbConfig);
  await createTables();
  console.log('Database initialized successfully');
};

const initializeDatabase = async () => {
  const maxAttempts = Number(process.env.DB_CONNECT_RETRIES) || 15;
  const delayMs = Number(process.env.DB_CONNECT_DELAY_MS) || 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initializeDatabaseOnce();
      return;
    } catch (error) {
      console.error(`Database initialization error (attempt ${attempt}/${maxAttempts}):`, error.message);
      pool = null;
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log(`Retrying database connection in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
};

const createTables = async () => {
  const connection = await pool.getConnection();
  
  try {
    // Investments table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS investments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        website_app_name VARCHAR(255) NOT NULL,
        investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'Saving Bank Balance') NOT NULL,
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

    // Investment history for tracking changes
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

    // Sub-type names (e.g., MF house names, Bank names)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sub_type_names (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'Saving Bank Balance') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_investment_type (investment_type),
        INDEX idx_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Sub-type categories (e.g., Nifty 50, Large Cap, etc.)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sub_type_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(255) NOT NULL,
        sub_type_name_id INT,
        investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'Saving Bank Balance') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sub_type_name_id) REFERENCES sub_type_names(id) ON DELETE SET NULL,
        INDEX idx_investment_type (investment_type),
        INDEX idx_sub_type_name_id (sub_type_name_id),
        UNIQUE KEY unique_category_subtype (category, sub_type_name_id, investment_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Investment transactions for true cashflow-based analytics (XIRR, realized P&L, income)
    // Convention: cashflow_amount is POSITIVE for inflows (sell/dividend/interest),
    // NEGATIVE for outflows (buy/fee). Units/price are optional for non-market instruments.
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

    console.log('Tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getPool,
  initializeDatabase
};