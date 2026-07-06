const express = require('express');
const router = express.Router();
const store = require('../db');
const { exportDatabaseSql } = require('../utils/sql-export');
const { importDatabaseSql } = require('../utils/sql-import');
const { exportDatabaseMongo } = require('../utils/mongo-export');
const { importDatabaseMongo } = require('../utils/mongo-import');
const { getPool, isMongoDb } = require('../config/index');

router.get('/export', async (req, res) => {
  try {
    const investments = await store.getAllInvestments();
    res.json({ success: true, data: investments });
  } catch (error) {
    console.error('Error exporting portfolio:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const investments = req.body;

    if (!Array.isArray(investments) || investments.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array of investments.'
      });
    }

    let importedCount = 0;
    let updatedCount = 0;
    const errors = [];

    for (const investment of investments) {
      try {
        const {
          website_app_name,
          investment_type,
          sub_type_name,
          sub_type_category,
          amount,
          investment_date,
          notes
        } = investment;

        if (!website_app_name || !investment_type || !amount || !investment_date) {
          errors.push(`Skipping record: Missing required fields for ${website_app_name || 'unknown'} - ${investment_type || 'unknown'}`);
          continue;
        }

        const result = await store.upsertImportedInvestment({
          website_app_name,
          investment_type,
          sub_type_name,
          sub_type_category,
          amount,
          investment_date,
          notes
        });

        if (result.action === 'updated') {
          updatedCount++;
        } else {
          importedCount++;
        }
      } catch (error) {
        errors.push(`Error processing investment ${investment.website_app_name || 'unknown'}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      data: {
        imported: importedCount,
        updated: updatedCount,
        errors,
        totalProcessed: investments.length
      },
      message: `Import completed: ${importedCount} new investments added, ${updatedCount} existing investments updated.`
    });
  } catch (error) {
    console.error('Error importing portfolio:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export/sql', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.status(400).json({
        success: false,
        error: 'SQL export is not available when DB_TYPE=mongodb. Use /export/mongo instead.'
      });
    }

    const pool = getPool();
    const { sql, exportedAt } = await exportDatabaseSql(pool);
    const filename = `portfolio_export_${exportedAt.slice(0, 10)}.sql`;
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(sql);
  } catch (error) {
    console.error('Error exporting SQL:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/import/sql', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.status(400).json({
        success: false,
        error: 'SQL import is not available when DB_TYPE=mongodb. Use /import/mongo instead.'
      });
    }

    const { sql, freshInstall = false } = req.body || {};

    if (!sql || !String(sql).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing SQL content. Expected { sql: string, freshInstall?: boolean }'
      });
    }

    const pool = getPool();
    const result = await importDatabaseSql(pool, sql, { freshInstall: !!freshInstall });

    res.json({
      success: true,
      data: result,
      message: freshInstall
        ? `Fresh SQL import completed. ${result.executed} statements executed.`
        : `SQL merge import completed. ${result.executed} statements executed, ${result.skipped} duplicates skipped.`
    });
  } catch (error) {
    console.error('Error importing SQL:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export/mongo', async (req, res) => {
  try {
    const { json, counts, exportedAt } = await exportDatabaseMongo();
    const filename = `portfolio_export_${exportedAt.slice(0, 10)}.mongo.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(json);
  } catch (error) {
    console.error('Error exporting MongoDB:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/import/mongo', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { data, freshInstall = false } = req.body || {};
    const exportPayload = data ?? req.body;

    if (!exportPayload || (typeof exportPayload === 'object' && !exportPayload.collections && !exportPayload.investments)) {
      return res.status(400).json({
        success: false,
        error: 'Missing MongoDB export content. Expected { data: object, freshInstall?: boolean }'
      });
    }

    const result = await importDatabaseMongo(exportPayload, { freshInstall: !!freshInstall });

    res.json({
      success: true,
      data: result,
      message: freshInstall
        ? `Fresh MongoDB import completed. ${result.inserted} documents inserted.`
        : `MongoDB merge import completed. ${result.inserted} documents upserted, ${result.skipped} skipped.`
    });
  } catch (error) {
    console.error('Error importing MongoDB:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
