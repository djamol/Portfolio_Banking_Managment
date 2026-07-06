const { MongoClient } = require('mongodb');
require('dotenv').config();
const logger = require('../utils/logger');

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

function getConnectionSummary() {
  return {
    uri: logger.redactUri(mongoConfig.uri),
    database: mongoConfig.database
  };
}

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
  logger.info('MongoDB: ensuring indexes');
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
  logger.info('MongoDB: connecting', getConnectionSummary());

  client = new MongoClient(mongoConfig.uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });
  await client.connect();

  db = client.db(mongoConfig.database);
  await db.command({ ping: 1 });
  logger.info('MongoDB: ping successful', { database: mongoConfig.database });

  await ensureIndexes(db);
  logger.info('MongoDB: initialization complete', getConnectionSummary());
}

async function initializeDatabase() {
  const maxAttempts = Number(process.env.DB_CONNECT_RETRIES) || 15;
  const delayMs = Number(process.env.DB_CONNECT_DELAY_MS) || 2000;

  logger.info('MongoDB: starting connection attempts', {
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
      logger.logError(`MongoDB initialization attempt ${attempt}/${maxAttempts}`, error, getConnectionSummary());
      if (client) {
        await client.close().catch(() => {});
        client = null;
        db = null;
      }
      if (attempt === maxAttempts) {
        logger.error('MongoDB: all connection attempts exhausted', {
          hint: 'Check MONGODB_URI, MONGODB_DB and that MongoDB is running'
        });
        throw error;
      }
      logger.warn('MongoDB: retrying connection', { attempt, nextRetryInMs: delayMs });
      await sleep(delayMs);
    }
  }
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB: connection closed');
  }
}

module.exports = {
  COLLECTIONS,
  mongoConfig,
  getDb,
  getClient,
  initializeDatabase,
  closeDatabase,
  getConnectionSummary
};
