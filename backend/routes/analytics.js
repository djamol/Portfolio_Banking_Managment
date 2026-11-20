const express = require('express');
const router = express.Router();
const { isMongoDb, getPool } = require('../config/index');
const mongoAnalytics = require('../utils/mongo-analytics');
const { appendIgnorePlatformClause } = require('../utils/ignore-platform');
const {
  amountAsOfSubquery,
  amountAsOfHistorySubquery,
  currentAmountSubquery,
  buildInvestmentFilterClauses,
  buildAmountFilterClauses,
  resolveSeriesBreakdown,
  wantsIncludeIgnored,
  splitReplacementJoin,
  historyEffectiveDateExpr
} = require('../utils/snapshot-queries');

function defaultIgnoreWhere(alias = '', query = {}) {
  const clauses = [];
  const params = [];
  if (!wantsIncludeIgnored(query)) {
    const column = alias ? `${alias}.website_app_name` : 'website_app_name';
    appendIgnorePlatformClause(clauses, params, column);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

router.get('/total', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getTotal(req.query) });
    }
    const pool = getPool();
    const ignore = defaultIgnoreWhere('curr', req.query);
    const [rows] = await pool.query(
      `
      SELECT SUM(curr.amount) as total_amount, COUNT(*) as total_investments
      FROM (
        SELECT
          i.id,
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      ${ignore.sql}
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('curr');
    const [rows] = await pool.query(
      `
      SELECT 
        curr.investment_type,
        COUNT(*) as count,
        SUM(curr.amount) as total_amount,
        AVG(curr.amount) as avg_amount
      FROM (
        SELECT
          i.investment_type,
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      ${ignore.sql}
      GROUP BY curr.investment_type
      ORDER BY total_amount DESC
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('curr');
    const [rows] = await pool.query(
      `
      SELECT 
        DATE_FORMAT(curr.investment_date, '%Y-%m') as month,
        SUM(curr.amount) as total_amount,
        COUNT(*) as count
      FROM (
        SELECT
          i.investment_date,
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      ${ignore.sql}
      GROUP BY DATE_FORMAT(curr.investment_date, '%Y-%m')
      ORDER BY month DESC
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('curr');
    const [rows] = await pool.query(
      `
      SELECT 
        YEAR(curr.investment_date) as year,
        SUM(curr.amount) as total_amount,
        COUNT(*) as count
      FROM (
        SELECT
          i.investment_date,
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      ${ignore.sql}
      GROUP BY YEAR(curr.investment_date)
      ORDER BY year DESC
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('i');
    const [rows] = await pool.query(
      `
      SELECT 
        DATE_FORMAT(ih.change_date, '%Y-%m') as month,
        SUM(CASE WHEN ih.change_type = 'added' THEN ih.amount ELSE 0 END) as added,
        SUM(CASE WHEN ih.change_type = 'removed' THEN ih.amount ELSE 0 END) as removed,
        SUM(CASE WHEN ih.change_type = 'updated' THEN ih.amount ELSE 0 END) as updated
      FROM investment_history ih
      JOIN investments i ON i.id = ih.investment_id
      ${ignore.sql}
      GROUP BY DATE_FORMAT(ih.change_date, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('i');
    const [rows] = await pool.query(
      `
      SELECT 
        YEAR(ih.change_date) as year,
        SUM(CASE WHEN ih.change_type = 'added' THEN ih.amount ELSE 0 END) as added,
        SUM(CASE WHEN ih.change_type = 'removed' THEN ih.amount ELSE 0 END) as removed,
        SUM(CASE WHEN ih.change_type = 'updated' THEN ih.amount ELSE 0 END) as updated
      FROM investment_history ih
      JOIN investments i ON i.id = ih.investment_id
      ${ignore.sql}
      GROUP BY YEAR(ih.change_date)
      ORDER BY year DESC
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('curr');
    const [rows] = await pool.query(
      `
      SELECT 
        curr.website_app_name,
        COUNT(*) as count,
        SUM(curr.amount) as total_amount
      FROM (
        SELECT
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      ${ignore.sql}
      GROUP BY curr.website_app_name
      ORDER BY total_amount DESC
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('curr');
    const [rows] = await pool.query(
      `
      SELECT
        month,
        SUM(month_amount) OVER (ORDER BY month ASC) AS cumulative_amount
      FROM (
        SELECT
          DATE_FORMAT(curr.investment_date, '%Y-%m') AS month,
          SUM(curr.amount) AS month_amount
        FROM (
          SELECT
            i.investment_date,
            i.website_app_name,
            ${currentAmountSubquery('i')} AS amount
          FROM investments i
        ) curr
        ${ignore.sql}
        GROUP BY DATE_FORMAT(curr.investment_date, '%Y-%m')
      ) grouped
      ORDER BY month ASC
      `,
      ignore.params
    );
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
    const investmentParams = [];
    const investmentWhere = buildInvestmentFilterClauses(req.query, investmentParams);
    const investmentSql = investmentWhere.length
      ? `WHERE ${investmentWhere.join(' AND ')}`
      : '';

    const amountParams = [];
    const amountWhere = buildAmountFilterClauses(req.query, amountParams, 'o.amount');
    const hasAmountBand = amountWhere.some((clause) => clause.includes('>=') || clause.includes('<='));

    const dateParams = [];
    const dateWhere = [];
    if (from) {
      dateWhere.push('s.change_date >= ?');
      dateParams.push(from);
    }
    if (to) {
      dateWhere.push('s.change_date <= ?');
      dateParams.push(to);
    }
    const dateSql = dateWhere.length ? `WHERE ${dateWhere.join(' AND ')}` : '';

    const seriesCol = breakdown ? `${breakdown.seriesExpr} AS series_name,` : '';
    const seriesOut = breakdown ? 'series_name,' : '';
    const seriesGroup = breakdown ? 'series_name, ' : '';
    const seriesPartition = breakdown ? 'PARTITION BY series_name ' : '';
    const seriesOrder = breakdown ? ', series_name ASC' : '';

    // Step changes from history. A cross join of every date × every holding
    // ran a correlated lookup ~36M times and took over a minute.
    // Split replacements (backdated individual FDs) use created_at so they
    // do not double-count the lumped row they replaced.
    const effectiveDate = historyEffectiveDateExpr('i', 'ih', 'rep');
    const replacementJoin = splitReplacementJoin('i', 'rep');
    let sql;
    let params;
    if (!hasAmountBand) {
      sql = `
        SELECT
          DATE_FORMAT(s.change_date, '%Y-%m-%d') AS change_date,
          ${seriesOut}
          s.total_value
        FROM (
          SELECT
            ${seriesOut}
            change_date,
            SUM(delta) OVER (${seriesPartition}ORDER BY change_date) AS total_value
          FROM (
            SELECT ${seriesGroup}change_date, SUM(delta) AS delta
            FROM (
              SELECT
                ${seriesCol}
                ${effectiveDate} AS change_date,
                ih.amount - COALESCE(
                  LAG(ih.amount) OVER (
                    PARTITION BY ih.investment_id
                    ORDER BY ${effectiveDate}, ih.id
                  ),
                  0
                ) AS delta
              FROM investment_history ih
              JOIN investments i ON i.id = ih.investment_id
              ${replacementJoin}
              ${investmentSql}
            ) steps
            GROUP BY ${seriesGroup}change_date
          ) daily
        ) s
        ${dateSql}
        ORDER BY s.change_date ASC${seriesOrder}
      `;
      params = [...investmentParams, ...dateParams];
    } else {
      const bandSql = amountWhere.length ? `AND ${amountWhere.join(' AND ')}` : '';
      const bandDateSql = dateWhere.length
        ? `WHERE ${dateWhere.map((clause) => clause.replace('s.change_date', 'd.change_date')).join(' AND ')}`
        : '';
      sql = `
        SELECT
          DATE_FORMAT(d.change_date, '%Y-%m-%d') AS change_date,
          ${breakdown ? 'o.series_name,' : ''}
          SUM(o.amount) AS total_value
        FROM (
          SELECT DISTINCT ${effectiveDate} AS change_date
          FROM investment_history ih
          JOIN investments i ON i.id = ih.investment_id
          ${replacementJoin}
        ) d
        JOIN (
          SELECT
            ih.investment_id,
            ${effectiveDate} AS change_date,
            ih.amount,
            ${seriesCol}
            LEAD(${effectiveDate}) OVER (
              PARTITION BY ih.investment_id ORDER BY ${effectiveDate}, ih.id
            ) AS next_date
          FROM investment_history ih
          JOIN investments i ON i.id = ih.investment_id
          ${replacementJoin}
          ${investmentSql}
        ) o
          ON o.change_date <= d.change_date
         AND (o.next_date IS NULL OR d.change_date < o.next_date)
         ${bandSql}
        ${bandDateSql}
        GROUP BY d.change_date${breakdown ? ', o.series_name' : ''}
        ORDER BY d.change_date ASC${breakdown ? ', o.series_name ASC' : ''}
      `;
      params = [...investmentParams, ...amountParams, ...dateParams];
    }

    const [rows] = await pool.query(sql, params);

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
    // Live allocation = latest history amount (same as Investment Summary /total).
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
          ${currentAmountSubquery('i')} AS amount_at_date
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
      SELECT DATE_FORMAT(MAX(change_date), '%Y-%m-%d') AS latest_date
      FROM investment_history
    `);

    const latestDate = latestRow?.latest_date || null;
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
      SELECT DATE_FORMAT(MAX(change_date), '%Y-%m-%d') AS prev_date
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
    const ignore = defaultIgnoreWhere('i');
    const whereExtra = ignore.sql
      ? `AND ${ignore.sql.replace(/^WHERE\s+/i, '')}`
      : '';
    // Amount-as-of from history only (same carry-forward idea as insights; 0 if no history yet).
    const [rows] = await pool.query(
      `
      SELECT
        i.id AS investment_id,
        i.website_app_name,
        i.investment_type,
        i.sub_type_name,
        i.sub_type_category,
        ${amountAsOfHistorySubquery('i', '?')} AS amount_to,
        ${amountAsOfHistorySubquery('i', '?')} AS amount_from,
        (${amountAsOfHistorySubquery('i', '?')}) - (${amountAsOfHistorySubquery('i', '?')}) AS delta
      FROM investments i
      WHERE ((${amountAsOfHistorySubquery('i', '?')}) - (${amountAsOfHistorySubquery('i', '?')})) <> 0
      ${whereExtra}
      ORDER BY delta DESC
      `,
      [toDate, fromDate, toDate, fromDate, toDate, fromDate, ...ignore.params]
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
      return res.json({ success: true, data: await mongoAnalytics.getCashflowsByMonth(req.query) });
    }

    const pool = getPool();
    const params = [];
    const where = buildInvestmentFilterClauses(req.query, params, 'i');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(`
      SELECT
        DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
        SUM(t.cashflow_amount) AS net_cashflow,
        SUM(CASE WHEN t.cashflow_amount < 0 THEN -t.cashflow_amount ELSE 0 END) AS outflow,
        SUM(CASE WHEN t.cashflow_amount > 0 THEN t.cashflow_amount ELSE 0 END) AS inflow
      FROM investment_transactions t
      JOIN investments i ON i.id = t.investment_id
      ${whereSql}
      GROUP BY DATE_FORMAT(t.txn_date, '%Y-%m')
      ORDER BY month ASC
    `, params);
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
    const ignore = defaultIgnoreWhere('curr');
    const whereParts = [`curr.sub_type_name IS NOT NULL AND curr.sub_type_name != ''`];
    if (ignore.sql) {
      whereParts.push(ignore.sql.replace(/^WHERE\s+/i, ''));
    }
    const [rows] = await pool.query(
      `
      SELECT 
        curr.sub_type_name,
        COUNT(*) as count,
        SUM(curr.amount) as total_amount
      FROM (
        SELECT
          i.sub_type_name,
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      WHERE ${whereParts.join(' AND ')}
      GROUP BY curr.sub_type_name
      ORDER BY total_amount DESC
      `,
      ignore.params
    );
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
    const ignore = defaultIgnoreWhere('curr');
    const whereParts = [`curr.sub_type_category IS NOT NULL AND curr.sub_type_category != ''`];
    if (ignore.sql) {
      whereParts.push(ignore.sql.replace(/^WHERE\s+/i, ''));
    }
    const [rows] = await pool.query(
      `
      SELECT 
        curr.sub_type_category,
        COUNT(*) as count,
        SUM(curr.amount) as total_amount
      FROM (
        SELECT
          i.sub_type_category,
          i.website_app_name,
          ${currentAmountSubquery('i')} AS amount
        FROM investments i
      ) curr
      WHERE ${whereParts.join(' AND ')}
      GROUP BY curr.sub_type_category
      ORDER BY total_amount DESC
      `,
      ignore.params
    );
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
        i.units,
        i.nav_price,
        i.nav_source,
        i.mutual_fund_scheme_name,
        i.avg_buy_price,
        i.invested_amount,
        i.profit_loss,
        i.mutual_fund_scheme_code,
        CASE
          WHEN COALESCE((
            SELECT h.amount
            FROM investment_history h
            WHERE h.investment_id = i.id
            ORDER BY h.change_date DESC, h.id DESC
            LIMIT 1
          ), i.amount) = 0 AND i.amount <> 0 THEN i.amount
          ELSE COALESCE((
            SELECT h.amount
            FROM investment_history h
            WHERE h.investment_id = i.id
            ORDER BY h.change_date DESC, h.id DESC
            LIMIT 1
          ), i.amount)
        END AS amount,
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

router.get('/fresh-entries', async (req, res) => {
  try {
    if (isMongoDb()) {
      return res.json({ success: true, data: await mongoAnalytics.getFreshEntries(req.query) });
    }

    const pool = getPool();
    const params = [];
    const where = buildInvestmentFilterClauses(req.query, params, 'i');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(h.change_date, '%Y-%m') AS month,
        ROUND(SUM(h.amount), 2) AS fresh_amount,
        COUNT(*) AS fresh_count
      FROM investment_history h
      JOIN (
        SELECT investment_id, MIN(id) AS first_id
        FROM investment_history
        GROUP BY investment_id
      ) first_row ON first_row.first_id = h.id
      JOIN investments i ON i.id = h.investment_id
      ${whereSql}
      GROUP BY DATE_FORMAT(h.change_date, '%Y-%m')
      ORDER BY month ASC
      `,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching fresh entries:', error);
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
        units,
        nav_price,
        invested_amount,
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
