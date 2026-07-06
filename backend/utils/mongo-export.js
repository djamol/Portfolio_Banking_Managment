const { COLLECTIONS } = require('../config/mongodb');
const { isMongoDb, getPool, getMongoDb } = require('../config/index');
const mongoStore = require('../db/mongo-store');

const EXPORT_COLLECTIONS = COLLECTIONS;

function toExtendedJson(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(toExtendedJson);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = toExtendedJson(val);
    }
    return out;
  }
  return value;
}

function fromExtendedJson(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && !Array.isArray(value) && value.$date) {
    return new Date(value.$date);
  }
  if (Array.isArray(value)) {
    return value.map(fromExtendedJson);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = fromExtendedJson(val);
    }
    return out;
  }
  return value;
}

async function fetchMysqlCollections(pool) {
  const collections = {};
  const counts = {};

  for (const name of EXPORT_COLLECTIONS) {
    const [rows] = await pool.query(`SELECT * FROM \`${name}\``);
    counts[name] = rows.length;
    collections[name] = rows.map((row) => toExtendedJson(row));
  }

  return { collections, counts };
}

async function fetchMongoCollections() {
  const collections = {};
  const counts = {};

  for (const name of EXPORT_COLLECTIONS) {
    const rows = await mongoStore.getCollectionData(name);
    counts[name] = rows.length;
    collections[name] = rows.map((row) => toExtendedJson(row));
  }

  return { collections, counts };
}

async function exportDatabaseMongo() {
  const exportedAt = new Date().toISOString();
  const database = process.env.MONGODB_DB || process.env.DB_NAME || 'portfolio';

  let collections;
  let counts;

  if (isMongoDb()) {
    ({ collections, counts } = await fetchMongoCollections());
  } else {
    const pool = getPool();
    ({ collections, counts } = await fetchMysqlCollections(pool));
  }

  const payload = {
    meta: {
      format: 'portfolio-mongo-export',
      version: 1,
      database,
      dbType: isMongoDb() ? 'mongodb' : 'mysql',
      exportedAt
    },
    collections
  };

  return {
    json: JSON.stringify(payload, null, 2),
    payload,
    counts,
    exportedAt
  };
}

module.exports = {
  EXPORT_COLLECTIONS,
  toExtendedJson,
  fromExtendedJson,
  exportDatabaseMongo
};
