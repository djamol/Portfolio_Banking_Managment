require('dotenv').config();
const logger = require('../utils/logger');

const DB_TYPE = (process.env.DB_TYPE || 'mysql').toLowerCase();

const mysqlDb = require('./database');
const mongoDb = require('./mongodb');

function getDbType() {
  return DB_TYPE === 'mongodb' ? 'mongodb' : 'mysql';
}

function isMongoDb() {
  return getDbType() === 'mongodb';
}

function logStartupConfig() {
  const summary = {
    dbType: getDbType(),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  };

  if (isMongoDb()) {
    Object.assign(summary, mongoDb.getConnectionSummary());
  } else {
    Object.assign(summary, mysqlDb.getConnectionSummary());
  }

  logger.info('Database backend selected', summary);
}

function initializeDatabase() {
  logStartupConfig();
  if (isMongoDb()) {
    return mongoDb.initializeDatabase();
  }
  return mysqlDb.initializeDatabase();
}

function getPool() {
  if (isMongoDb()) {
    throw new Error('getPool() is only available when DB_TYPE=mysql');
  }
  return mysqlDb.getPool();
}

function getMongoDb() {
  if (!isMongoDb()) {
    throw new Error('getMongoDb() is only available when DB_TYPE=mongodb');
  }
  return mongoDb.getDb();
}

module.exports = {
  getDbType,
  isMongoDb,
  initializeDatabase,
  getPool,
  getMongoDb,
  mysqlDb,
  mongoDb
};
