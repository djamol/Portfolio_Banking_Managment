require('dotenv').config();

const DB_TYPE = (process.env.DB_TYPE || 'mysql').toLowerCase();

const mysqlDb = require('./database');
const mongoDb = require('./mongodb');

function getDbType() {
  return DB_TYPE === 'mongodb' ? 'mongodb' : 'mysql';
}

function isMongoDb() {
  return getDbType() === 'mongodb';
}

function initializeDatabase() {
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
