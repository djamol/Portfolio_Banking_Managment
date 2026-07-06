const { isMongoDb, getPool } = require('../config/index');
const mongoStore = require('../db/mongo-store');
const { EXPORT_COLLECTIONS, fromExtendedJson } = require('./mongo-export');
const { clearAllTables } = require('./sql-import');

function parseMongoExport(input) {
  let data = input;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('MongoDB export content is empty');
    }
    data = JSON.parse(trimmed);
  }

  if (data.meta?.format === 'portfolio-mongo-export' && data.collections) {
    return data;
  }

  if (data.database && data.collections) {
    return {
      meta: {
        format: 'portfolio-mongo-export',
        version: 1,
        database: data.database,
        exportedAt: data.exportedAt || new Date().toISOString()
      },
      collections: data.collections
    };
  }

  const collections = {};
  let found = false;
  for (const name of EXPORT_COLLECTIONS) {
    if (Array.isArray(data[name])) {
      collections[name] = data[name];
      found = true;
    }
  }
  if (found) {
    return {
      meta: { format: 'portfolio-mongo-export', version: 1 },
      collections
    };
  }

  throw new Error('Unrecognized MongoDB export format. Expected portfolio-mongo-export JSON.');
}

function normalizeDocuments(documents) {
  return documents.map((doc) => {
    const normalized = fromExtendedJson(doc);
    if (normalized.created_at) normalized.created_at = new Date(normalized.created_at);
    if (normalized.updated_at) normalized.updated_at = new Date(normalized.updated_at);
    return normalized;
  });
}

async function importMysqlCollection(pool, collectionName, documents, { freshInstall = false }) {
  if (!documents.length) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  for (const doc of documents) {
    const row = { ...doc };
    delete row._id;

    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => row[col]);

    try {
      if (freshInstall) {
        await pool.query(
          `INSERT INTO \`${collectionName}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
          values
        );
        inserted++;
      } else {
        const updateCols = columns.filter((c) => c !== 'id').map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');
        await pool.query(
          `INSERT INTO \`${collectionName}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})
           ON DUPLICATE KEY UPDATE ${updateCols}`,
          values
        );
        inserted++;
      }
    } catch (error) {
      if (/duplicate/i.test(error.message)) {
        skipped++;
      } else {
        throw error;
      }
    }
  }

  return { inserted, skipped };
}

async function importDatabaseMongo(exportData, { freshInstall = false } = {}) {
  const parsed = parseMongoExport(exportData);
  const collectionResults = {};
  let totalInserted = 0;
  let totalSkipped = 0;
  const errors = [];

  if (isMongoDb()) {
    if (freshInstall) {
      await mongoStore.clearAllCollections();
    }

    for (const name of EXPORT_COLLECTIONS) {
      const rawDocs = parsed.collections[name] || [];
      const documents = normalizeDocuments(rawDocs);
      try {
        const result = await mongoStore.importCollectionData(name, documents, { freshInstall });
        collectionResults[name] = result;
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }

    const tableCounts = await mongoStore.getCollectionCounts();
    return {
      freshInstall,
      collectionResults,
      inserted: totalInserted,
      skipped: totalSkipped,
      errors,
      tableCounts
    };
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    if (freshInstall) {
      await clearAllTables(connection);
    }

    for (const name of EXPORT_COLLECTIONS) {
      const rawDocs = parsed.collections[name] || [];
      const documents = normalizeDocuments(rawDocs);
      try {
        const result = await importMysqlCollection(connection, name, documents, { freshInstall });
        collectionResults[name] = result;
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }

    await connection.query('SET FOREIGN_KEY_CHECKS=1');

    const tableCounts = {};
    for (const name of EXPORT_COLLECTIONS) {
      const [[{ total }]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${name}\``);
      tableCounts[name] = total;
    }

    return {
      freshInstall,
      collectionResults,
      inserted: totalInserted,
      skipped: totalSkipped,
      errors,
      tableCounts
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  parseMongoExport,
  importDatabaseMongo
};
