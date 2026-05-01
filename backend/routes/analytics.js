const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get total portfolio value
router.get('/total', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT SUM(amount) as total_amount, COUNT(*) as total_investments
      FROM investments
    `);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching total:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by type
router.get('/by-type', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        investment_type,
        COUNT(*) as count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM investments
      GROUP BY investment_type
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by type:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by month
router.get('/by-month', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(investment_date, '%Y-%m') as month,
        SUM(amount) as total_amount,
        COUNT(*) as count
      FROM investments
      GROUP BY DATE_FORMAT(investment_date, '%Y-%m')
      ORDER BY month DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by month:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by year
router.get('/by-year', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        YEAR(investment_date) as year,
        SUM(amount) as total_amount,
        COUNT(*) as count
      FROM investments
      GROUP BY YEAR(investment_date)
      ORDER BY year DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by year:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get monthly changes (comparison)
router.get('/monthly-changes', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(change_date, '%Y-%m') as month,
        SUM(CASE WHEN change_type = 'added' THEN amount ELSE 0 END) as added,
        SUM(CASE WHEN change_type = 'removed' THEN amount ELSE 0 END) as removed,
        SUM(CASE WHEN change_type = 'updated' THEN amount ELSE 0 END) as updated
      FROM investment_history
      GROUP BY DATE_FORMAT(change_date, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching monthly changes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get yearly changes
router.get('/yearly-changes', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        YEAR(change_date) as year,
        SUM(CASE WHEN change_type = 'added' THEN amount ELSE 0 END) as added,
        SUM(CASE WHEN change_type = 'removed' THEN amount ELSE 0 END) as removed,
        SUM(CASE WHEN change_type = 'updated' THEN amount ELSE 0 END) as updated
      FROM investment_history
      GROUP BY YEAR(change_date)
      ORDER BY year DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching yearly changes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by website/app
router.get('/by-platform', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        website_app_name,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM investments
      GROUP BY website_app_name
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by platform:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get portfolio growth over time
router.get('/growth', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(investment_date, '%Y-%m') as month,
        SUM(amount) OVER (ORDER BY DATE_FORMAT(investment_date, '%Y-%m') ASC) as cumulative_amount
      FROM investments
      GROUP BY DATE_FORMAT(investment_date, '%Y-%m')
      ORDER BY month ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching growth:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Portfolio value over time from history snapshots (best for line chart)
router.get('/value-series', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const platform = req.query.platform;
    const investmentType = req.query.type;

    const pool = db.getPool();
    const where = [];
    const params = [];

    if (from) {
      where.push('ih.change_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('ih.change_date <= ?');
      params.push(to);
    }
    if (platform) {
      where.push('i.website_app_name = ?');
      params.push(platform);
    }
    if (investmentType) {
      where.push('i.investment_type = ?');
      params.push(investmentType);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT
        ih.change_date,
        SUM(ih.amount) AS total_value
      FROM investment_history ih
      JOIN investments i ON i.id = ih.investment_id
      ${whereSql}
      GROUP BY ih.change_date
      ORDER BY ih.change_date ASC
      `,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching value series:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Latest allocation by investment_type (donut/treemap)
router.get('/allocation-latest', async (req, res) => {
  try {
    const platform = req.query.platform;
    const pool = db.getPool();
    const params = [];
    const platformSql = platform ? 'WHERE i.website_app_name = ?' : '';
    if (platform) params.push(platform);

    const [rows] = await pool.query(`
      WITH latest AS (
        SELECT investment_id, MAX(change_date) AS max_dt
        FROM investment_history
        GROUP BY investment_id
      )
      SELECT
        i.investment_type,
        SUM(ih.amount) AS value
      FROM latest l
      JOIN investment_history ih
        ON ih.investment_id = l.investment_id AND ih.change_date = l.max_dt
      JOIN investments i
        ON i.id = ih.investment_id
      ${platformSql}
      GROUP BY i.investment_type
      ORDER BY value DESC
    `, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching latest allocation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Insights & hygiene signals: snapshot freshness, portfolio change, concentration risk
router.get('/insights', async (req, res) => {
  try {
    const pool = db.getPool();

    const [[latestRow]] = await pool.query(`
      SELECT MAX(change_date) AS latest_date
      FROM investment_history
    `);

    const latestDate = latestRow?.latest_date;
    if (!latestDate) {
      return res.json({
        success: true,
        data: {
          latestDate: null,
          daysSinceLatestSnapshot: null,
          portfolio: null,
          topHoldings: []
        }
      });
    }

    const [[prevRow]] = await pool.query(
      `
      SELECT MAX(change_date) AS prev_date
      FROM investment_history
      WHERE change_date < ?
      `,
      [latestDate]
    );
    const prevDate = prevRow?.prev_date || null;

    const [[portfolioLatest]] = await pool.query(
      `
      SELECT SUM(amount) AS total_value
      FROM investment_history
      WHERE change_date = ?
      `,
      [latestDate]
    );

    let portfolioPrevValue = null;
    if (prevDate) {
      const [[portfolioPrev]] = await pool.query(
        `
        SELECT SUM(amount) AS total_value
        FROM investment_history
        WHERE change_date = ?
        `,
        [prevDate]
      );
      portfolioPrevValue = portfolioPrev?.total_value ?? null;
    }

    const [[freshness]] = await pool.query(
      `
      SELECT DATEDIFF(CURDATE(), ?) AS days_since
      `,
      [latestDate]
    );

    // Top holdings concentration at latest snapshot
    const [topHoldings] = await pool.query(
      `
      SELECT
        i.id AS investment_id,
        i.website_app_name,
        i.investment_type,
        i.sub_type_name,
        i.sub_type_category,
        ih.amount,
        (ih.amount / totals.total_value) * 100 AS pct_of_portfolio
      FROM investment_history ih
      JOIN investments i ON i.id = ih.investment_id
      JOIN (
        SELECT SUM(amount) AS total_value
        FROM investment_history
        WHERE change_date = ?
      ) totals
      WHERE ih.change_date = ?
      ORDER BY ih.amount DESC
      LIMIT 10
      `,
      [latestDate, latestDate]
    );

    const latestValue = portfolioLatest?.total_value ?? 0;
    const prevValue = portfolioPrevValue;
    const changeAbs = prevValue === null ? null : (latestValue - prevValue);
    const changePct = prevValue === null || Number(prevValue) === 0 ? null : ((latestValue - prevValue) / prevValue) * 100;

    res.json({
      success: true,
      data: {
        latestDate,
        prevDate,
        daysSinceLatestSnapshot: freshness?.days_since ?? null,
        portfolio: {
          latestValue,
          prevValue,
          changeAbs,
          changePct
        },
        topHoldings
      }
    });
  } catch (error) {
    console.error('Error fetching insights:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delta between two snapshot dates (waterfall / top movers)
// Query params: from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/delta', async (req, res) => {
  try {
    const fromDate = req.query.from;
    const toDate = req.query.to;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing query params. Expected from=YYYY-MM-DD&to=YYYY-MM-DD'
      });
    }

    const pool = db.getPool();
    const [rows] = await pool.query(
      `
      WITH a AS (
        SELECT investment_id, amount
        FROM investment_history
        WHERE change_date = ?
      ),
      b AS (
        SELECT investment_id, amount
        FROM investment_history
        WHERE change_date = ?
      )
      SELECT
        i.id AS investment_id,
        i.website_app_name,
        i.investment_type,
        i.sub_type_name,
        i.sub_type_category,
        COALESCE(b.amount, 0) AS amount_to,
        COALESCE(a.amount, 0) AS amount_from,
        COALESCE(b.amount, 0) - COALESCE(a.amount, 0) AS delta
      FROM investments i
      LEFT JOIN a ON a.investment_id = i.id
      LEFT JOIN b ON b.investment_id = i.id
      WHERE COALESCE(b.amount, 0) <> 0 OR COALESCE(a.amount, 0) <> 0
      ORDER BY delta DESC
      `,
      [fromDate, toDate]
    );

    res.json({
      success: true,
      meta: { from: fromDate, to: toDate },
      data: rows
    });
  } catch (error) {
    console.error('Error fetching delta:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cashflows over time from investment_transactions (bar chart)
// Helpful for XIRR and income analytics later.
router.get('/cashflows-by-month', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT
        DATE_FORMAT(txn_date, '%Y-%m') AS month,
        SUM(cashflow_amount) AS net_cashflow,
        SUM(CASE WHEN cashflow_amount < 0 THEN -cashflow_amount ELSE 0 END) AS outflow,
        SUM(CASE WHEN cashflow_amount > 0 THEN cashflow_amount ELSE 0 END) AS inflow
      FROM investment_transactions
      GROUP BY DATE_FORMAT(txn_date, '%Y-%m')
      ORDER BY month ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching cashflows:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by sub type name
router.get('/by-sub-type-name', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        sub_type_name,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM investments
      WHERE sub_type_name IS NOT NULL AND sub_type_name != ''
      GROUP BY sub_type_name
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by sub type name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investments by sub type category
router.get('/by-sub-type-category', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        sub_type_category,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM investments
      WHERE sub_type_category IS NOT NULL AND sub_type_category != ''
      GROUP BY sub_type_category
      ORDER BY total_amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching by sub type category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investment summary table with history record counts
router.get('/summary-table', async (req, res) => {
  try {
    const pool = db.getPool();
    const [rows] = await pool.query(`
      SELECT 
        i.id,
        i.website_app_name,
        i.investment_type,
        i.sub_type_name,
        i.sub_type_category,
        COALESCE(
          (
            SELECT h.amount
            FROM investment_history h
            WHERE h.investment_id = i.id
            ORDER BY h.change_date DESC, h.id DESC
            LIMIT 1
          ),
          i.amount
        ) AS amount,
        i.investment_date,
        i.notes,
        COALESCE(h.history_count, 0) as history_count
      FROM investments i
      LEFT JOIN (
        SELECT 
          investment_id,
          COUNT(*) as history_count
        FROM investment_history
        GROUP BY investment_id
      ) h ON i.id = h.investment_id
      ORDER BY amount DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching summary table:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investment history by investment ID
router.get('/investment-history/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    const investmentId = req.params.id;
    const [rows] = await pool.query(`
      SELECT 
        id,
        investment_id,
        change_type,
        amount,
        change_date,
        notes
      FROM investment_history
      WHERE investment_id = ?
      ORDER BY change_date DESC, id DESC
    `, [investmentId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching investment history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;