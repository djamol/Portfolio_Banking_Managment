const express = require('express');
const router = express.Router();
const { isMongoDb, getPool } = require('../config/index');
const mongoAnalytics = require('../utils/mongo-analytics');
const {
  amountAsOfSubquery,
  buildInvestmentFilterClauses,
  buildAmountFilterClauses,
  resolveSeriesBreakdown
} = require('../utils/snapshot-queries');

router.get('/total', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getTotal() });
    }
    const pool = getPool();
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

router.get('/by-type', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getByType() });
    }
    const pool = getPool();
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

router.get('/by-month', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getByMonth() });
    }
    const pool = getPool();
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

router.get('/by-year', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getByYear() });
    }
    const pool = getPool();
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

router.get('/monthly-changes', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getMonthlyChanges() });
    }
    const pool = getPool();
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

router.get('/yearly-changes', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getYearlyChanges() });
    }
    const pool = getPool();
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

router.get('/by-platform', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getByPlatform() });
    }
    const pool = getPool();
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

router.get('/growth', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getGrowth() });
    }
    const pool = getPool();
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

router.get('/value-series', async (req, res) => {
  try {
    if (isMongoDb()) {
      const data = await mongoAnalytics.getValueSeries(req.query);
      return res.json({ success: true, data });
    }

    const from = req.query.from;
    const to = req.query.to;
    const breakdown = resolveSeriesBreakdown(req.query);

    const pool = getPool();
    const snapshotWhere = [];
    const snapshotParams = [];

    if (from) {
      snapshotWhere.push('sd.change_date >= ?');
      snapshotParams.push(from);
    }
    if (to) {
      snapshotWhere.push('sd.change_date <= ?');
      snapshotParams.push(to);
    }

    const investmentParams = [];
    const investmentWhere = buildInvestmentFilterClauses(req.query, investmentParams);
    const investmentSql = investmentWhere.length
      ? `WHERE ${investmentWhere.join(' AND ')}`
      : '';

    const amountParams = [];
    const amountWhere = buildAmountFilterClauses(req.query, amountParams, 'vals.amount_at_date');
    const outerWhere = [...snapshotWhere, ...amountWhere];
    const outerSql = outerWhere.length ? `WHERE ${outerWhere.join(' AND ')}` : '';

    const seriesSelect = breakdown
      ? `${breakdown.seriesExpr} AS series_name,`
      : '';
    const groupBySeries = breakdown ? ', vals.series_name' : '';
    const selectSeries = breakdown ? 'vals.series_name,' : '';

    const [rows] = await pool.query(
      `
      SELECT
        sd.change_date,
        ${selectSeries}
        SUM(vals.amount_at_date) AS total_value
      FROM (
        SELECT DISTINCT change_date
        FROM investment_history
      ) sd
      JOIN (
        SELECT
          i.id,
          sd2.change_date,
          ${seriesSelect}
          ${amountAsOfSubquery('i', 'sd2.change_date')} AS amount_at_date
        FROM (
          SELECT DISTINCT change_date
          FROM investment_history
        ) sd2
        CROSS JOIN investments i
        ${investmentSql}
      ) vals ON vals.change_date = sd.change_date
      ${outerSql}
      GROUP BY sd.change_date${groupBySeries}
      ORDER BY sd.change_date ASC${breakdown ? ', vals.series_name ASC' : ''}
      `,
      [...investmentParams, ...snapshotParams, ...amountParams]
    );

    if (breakdown) {
      return res.json({
        success: true,
        data: {
          mode: 'series',
          breakdown: breakdown.breakdown,
          rows
        }
      });
    }

    res.json({
      success: true,
      data: {
        mode: 'total',
        breakdown: null,
        rows
      }
    });
  } catch (error) {
    console.error('Error fetching value series:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/allocation-latest', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getAllocationLatest(req.query) });
    }

    const pool = getPool();
    const amountExpr = amountAsOfSubquery('i', 'CURDATE()');
    const investmentParams = [];
    const investmentWhere = buildInvestmentFilterClauses(req.query, investmentParams);
    const amountParams = [];
    const amountWhere = buildAmountFilterClauses(req.query, amountParams, 'vals.amount_at_date');
    const investmentSql = investmentWhere.length ? `WHERE ${investmentWhere.join(' AND ')}` : '';
    const amountSql = amountWhere.length ? `WHERE ${amountWhere.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
      SELECT
        vals.investment_type,
        SUM(vals.amount_at_date) AS value
      FROM (
        SELECT
          i.investment_type,
          ${amountExpr} AS amount_at_date
        FROM investments i
        ${investmentSql}
      ) vals
      ${amountSql}
      GROUP BY vals.investment_type
      ORDER BY value DESC
      `,
      [...investmentParams, ...amountParams]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching latest allocation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/insights', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getInsights(req.query) });
    }

    const pool = getPool();

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

    const investmentParams = [];
    const investmentWhere = buildInvestmentFilterClauses(req.query, investmentParams);
    const investmentSql = investmentWhere.length ? `WHERE ${investmentWhere.join(' AND ')}` : '';
    const amountParams = [];
    const amountWhere = buildAmountFilterClauses(req.query, amountParams, 'vals.amount_at_date');
    const amountSql = amountWhere.length ? `WHERE ${amountWhere.join(' AND ')}` : '';

    const portfolioValueSql = `
      SELECT SUM(vals.amount_at_date) AS total_value
      FROM (
        SELECT ${amountAsOfSubquery('i', '?')} AS amount_at_date
        FROM investments i
        ${investmentSql}
      ) vals
      ${amountSql}
    `;

    const [[portfolioLatest]] = await pool.query(
      portfolioValueSql,
      [latestDate, ...investmentParams, ...amountParams]
    );

    let portfolioPrevValue = null;
    if (prevDate) {
      const [[portfolioPrev]] = await pool.query(
        portfolioValueSql,
        [prevDate, ...investmentParams, ...amountParams]
      );
      portfolioPrevValue = portfolioPrev?.total_value ?? null;
    }

    const [[freshness]] = await pool.query(
      `
      SELECT DATEDIFF(CURDATE(), ?) AS days_since
      `,
      [latestDate]
    );

    const [topHoldingsRaw] = await pool.query(
      `
      SELECT
        i.id AS investment_id,
        i.website_app_name,
        i.investment_type,
        i.sub_type_name,
        i.sub_type_category,
        vals.amount_at_date AS amount
      FROM (
        SELECT
          i.id,
          ${amountAsOfSubquery('i', '?')} AS amount_at_date
        FROM investments i
        ${investmentSql}
      ) vals
      JOIN investments i ON i.id = vals.id
      ${amountSql}
      ORDER BY vals.amount_at_date DESC
      LIMIT 10
      `,
      [latestDate, ...investmentParams, ...amountParams]
    );

    const totalForPct = Number(portfolioLatest?.total_value) || 0;
    const topHoldings = topHoldingsRaw.map((row) => ({
      ...row,
      pct_of_portfolio: totalForPct > 0 ? (Number(row.amount) / totalForPct) * 100 : 0
    }));

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

    if (isMongoDb()) {
      const rows = await mongoAnalytics.getDelta(fromDate, toDate);
      return res.json({
        success: true,
        meta: { from: fromDate, to: toDate },
        data: rows
      });
    }

    const pool = getPool();
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

router.get('/cashflows-by-month', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getCashflowsByMonth() });
    }

    const pool = getPool();
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

router.get('/by-sub-type-name', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getBySubTypeName() });
    }

    const pool = getPool();
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

router.get('/by-sub-type-category', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getBySubTypeCategory() });
    }

    const pool = getPool();
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

router.get('/summary-table', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getSummaryTable() });
    }

    const pool = getPool();
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

router.get('/investment-history/:id', async (req, res) => {
  try {
    if (isMongoDb()) {
      const rows = await mongoAnalytics.getInvestmentHistory(req.params.id);
      return res.json({ success: true, data: rows });
    }

    const pool = getPool();
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
