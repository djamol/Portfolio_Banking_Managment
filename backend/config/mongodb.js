const { MongoClient } = require('mongodb');
require('dotenv').config();

const COLLECTIONS = [
  'sub_type_names',
  'sub_type_categories',
  'investments',
  'investment_history',
  'investment_transactions'
];

const mongoConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
  database: process.env.MONGODB_DB || process.env.DB_NAME || 'portfolio'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
let db;

const getDb = () => {
  if (!db) {
    throw new Error('MongoDB not initialized. Call initializeDatabase() first.');
  }
  return db;
};

const getClient = () => {
  if (!client) {
    throw new Error('MongoDB not initialized. Call initializeDatabase() first.');
  }
  return client;
};

async function ensureIndexes(database) {
  await database.collection('investments').createIndex({ investment_date: -1 });
  await database.collection('investments').createIndex({ investment_type: 1 });
  await database.collection('investments').createIndex({ website_app_name: 1 });
  await database.collection('investment_history').createIndex({ investment_id: 1, change_date: -1 });
  await database.collection('sub_type_names').createIndex({ name: 1 }, { unique: true });
  await database.collection('sub_type_categories').createIndex(
    { category: 1, sub_type_name_id: 1, investment_type: 1 },
    { unique: true }
  );
  await database.collection('counters').createIndex({ _id: 1 }, { unique: true });
}

async function initializeDatabaseOnce() {
  client = new MongoClient(mongoConfig.uri);
  await client.connect();
  db = client.db(mongoConfig.database);
  await ensureIndexes(db);
  console.log(`MongoDB connected: ${mongoConfig.database}`);
}

async function initializeDatabase() {
  const maxAttempts = Number(process.env.DB_CONNECT_RETRIES) || 15;
  const delayMs = Number(process.env.DB_CONNECT_DELAY_MS) || 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initializeDatabaseOnce();
      console.log('Database initialized successfully');
      return;
    } catch (error) {
      console.error(`MongoDB initialization error (attempt ${attempt}/${maxAttempts}):`, error.message);
      if (client) {
        await client.close().catch(() => {});
        client = null;
        db = null;
      }
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log(`Retrying MongoDB connection in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = {
  COLLECTIONS,
  mongoConfig,
  getDb,
  getClient,
  initializeDatabase,
  closeDatabase
};
