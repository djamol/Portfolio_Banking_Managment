import { Injectable } from '@angular/core';
import { ChartConfiguration } from 'chart.js';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { PeriodGrain, PeriodRow } from '../../../services/banking/banking.models';
import {
  CategoryGrain,
  RolledCategoryRow,
  rollupCategoryMonthRows,
  rollupCategoryRows
} from '../../../utils/category-rollup.util';
import { formatCategoryLabel } from '../../../utils/category-tree.util';
import { BANK_CHART_COLORS } from './banking-chart.util';
import { BankingContextService } from './banking-context.service';
import { BankingFilterState } from './banking-filter-state.service';

@Injectable({ providedIn: 'root' })
export class BankingAnalyticsState {
  analytics: any = null;
  cashSummary: {
    accounts: Array<{
      id: number;
      bank_name: string;
      account_name: string;
      currency: string;
      latest_balance: number;
      is_active: number;
    }>;
    totals_by_currency: Array<{ currency: string; total: number }>;
    active_count: number;
    inactive_count: number;
  } | null = null;

  categoryChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  expenseChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  monthlyChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  periodChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  periodNetChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  interestChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  netChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  balanceChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  txnVolumeChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  flowLineChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  categoryTrendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  spendBarChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  chartsMixChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };

  /** Hierarchy grain for charts / hierarchical table */
  categoryGrain: CategoryGrain = 'parent';
  /** Drill path keys, e.g. ['Expense', 'Expense_Food'] */
  categoryDrillPath: string[] = [];
  /** Rolled rows for spend/mix drill + analytics hierarchy table */
  rolledSpendRows: RolledCategoryRow[] = [];
  rolledMixRows: RolledCategoryRow[] = [];
  hierarchyTableRows: RolledCategoryRow[] = [];
  /** Keys aligned with spend/mix chart label indices for click → drill */
  spendChartKeys: string[] = [];
  mixChartKeys: string[] = [];

  cashflowGrain: PeriodGrain = 'month';
  periodRows: PeriodRow[] = [];
  periodBest: PeriodRow | null = null;
  periodWorst: PeriodRow | null = null;

  constructor(
    private analyticsService: BankAnalyticsService,
    private filters: BankingFilterState,
    private ctx: BankingContextService
  ) {}

  loadAnalytics(done?: () => void) {
    this.analyticsService.getAnalytics(this.filters.buildSharedFilters()).subscribe({
      next: (data) => {
        this.analytics = data;
        this.buildCharts();
        if (data?.categories?.length) {
          this.ctx.mergeCategories(data.categories);
        }
        done?.();
      },
      error: (err) => {
        this.ctx.flash('error', err.message || 'Failed to load analytics');
        done?.();
      }
    });
  }

  loadCashSummary(done?: () => void) {
    this.analyticsService.getCashSummary().subscribe({
      next: (data) => {
        this.cashSummary = data;
        done?.();
      },
      error: () => {
        this.cashSummary = null;
        done?.();
      }
    });
  }

  buildCharts() {
    if (!this.analytics) return;
    const cats = (this.analytics.byCategory || []).slice(0, 10);
    this.categoryChartData = {
      labels: cats.map((c: any) => c.category),
      datasets: [{
        data: cats.map((c: any) => Number(c.total_debit) + Number(c.total_credit)),
        backgroundColor: BANK_CHART_COLORS
      }]
    };

    const expenseCats = (this.analytics.expenseByCategory || cats.filter((c: any) => Number(c.total_debit) > 0)).slice(0, 10);
    this.expenseChartData = {
      labels: expenseCats.map((c: any) => c.category),
      datasets: [{
        data: expenseCats.map((c: any) => Number(c.total_debit)),
        backgroundColor: BANK_CHART_COLORS
      }]
    };

    const months = this.analytics.byMonth || [];
    const recentMonths = months.slice(-24);
    this.monthlyChartData = {
      labels: recentMonths.map((m: any) => m.month),
      datasets: [
        {
          label: 'Credits',
          data: recentMonths.map((m: any) => Number(m.total_credit)),
          backgroundColor: 'rgba(16, 185, 129, 0.75)'
        },
        {
          label: 'Debits',
          data: recentMonths.map((m: any) => Number(m.total_debit)),
          backgroundColor: 'rgba(239, 68, 68, 0.75)'
        }
      ]
    };

    this.netChartData = {
      labels: recentMonths.map((m: any) => m.month),
      datasets: [{
        label: 'Net cashflow',
        data: recentMonths.map((m: any) => Number(m.net)),
        borderColor: '#0f172a',
        backgroundColor: 'rgba(15,23,42,0.08)',
        fill: true,
        tension: 0.25,
        pointRadius: 2
      }]
    };

    const series = (this.analytics.balanceSeries || []).slice(-180);
    this.balanceChartData = {
      labels: series.map((p: any) => p.date),
      datasets: [{
        data: series.map((p: any) => Number(p.balance)),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 0
      }]
    };

    this.buildPeriodCharts();
    this.buildInterestCharts();
    this.buildExploreCharts();
  }

  get categoryDrillKey(): string {
    return this.categoryDrillPath.length
      ? this.categoryDrillPath[this.categoryDrillPath.length - 1]
      : '';
  }

  setCategoryGrain(grain: CategoryGrain) {
    this.categoryGrain = grain;
    if (grain === 'leaf') {
      this.categoryDrillPath = [];
    }
    this.buildExploreCharts();
    this.buildHierarchyTable();
  }

  drillIntoCategory(key: string) {
    if (!key || this.categoryGrain === 'leaf') return;
    const row =
      this.rolledSpendRows.find((r) => r.key === key) ||
      this.rolledMixRows.find((r) => r.key === key) ||
      this.hierarchyTableRows.find((r) => r.key === key);
    if (row && !row.canDrill) return;
    if (this.categoryDrillPath[this.categoryDrillPath.length - 1] === key) return;
    this.categoryDrillPath = [...this.categoryDrillPath, key];
    this.buildExploreCharts();
    this.buildHierarchyTable();
  }

  drillToBreadcrumb(index: number) {
    if (index < 0) {
      this.categoryDrillPath = [];
    } else {
      this.categoryDrillPath = this.categoryDrillPath.slice(0, index + 1);
    }
    this.buildExploreCharts();
    this.buildHierarchyTable();
  }

  clearCategoryDrill() {
    this.categoryDrillPath = [];
    this.buildExploreCharts();
    this.buildHierarchyTable();
  }

  buildExploreCharts() {
    if (!this.analytics) return;
    const months = (this.analytics.byMonth || []).slice(-24);
    const drillKey = this.categoryDrillKey;

    this.txnVolumeChartData = {
      labels: months.map((m: any) => m.month),
      datasets: [{
        label: 'Transactions',
        data: months.map((m: any) => Number(m.txn_count) || 0),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    };

    this.flowLineChartData = {
      labels: months.map((m: any) => m.month),
      datasets: [
        {
          label: 'Credits',
          data: months.map((m: any) => Number(m.total_credit) || 0),
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 2
        },
        {
          label: 'Debits',
          data: months.map((m: any) => Number(m.total_debit) || 0),
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 2
        }
      ]
    };

    const sourceRows = (this.analytics.byCategory || []) as Array<{
      category: string;
      txn_count: number;
      total_debit: number;
      total_credit: number;
    }>;
    const rolled = rollupCategoryRows(sourceRows, this.categoryGrain, drillKey);
    this.rolledMixRows = rolled;

    const spendRows = rolled
      .filter((r) => r.total_debit > 0)
      .sort((a, b) => b.total_debit - a.total_debit)
      .slice(0, 12);
    this.rolledSpendRows = spendRows;
    this.spendChartKeys = spendRows.map((r) => r.key);
    this.spendBarChartData = {
      labels: spendRows.map((r) => r.label),
      datasets: [{
        label: 'Spend',
        data: spendRows.map((r) => r.total_debit),
        backgroundColor: spendRows.map((_, i) => BANK_CHART_COLORS[i % BANK_CHART_COLORS.length])
      }]
    };

    const mixRows = rolled.slice(0, 10);
    this.mixChartKeys = mixRows.map((r) => r.key);
    this.chartsMixChartData = {
      labels: mixRows.map((r) => r.label),
      datasets: [{
        data: mixRows.map((r) => r.total_debit + r.total_credit),
        backgroundColor: BANK_CHART_COLORS
      }]
    };

    const catMonthRows = rollupCategoryMonthRows(
      this.analytics.byCategoryMonth || [],
      this.categoryGrain,
      drillKey
    );
    const debitByCat: Record<string, number> = {};
    for (const row of catMonthRows) {
      debitByCat[row.category] = (debitByCat[row.category] || 0) + (Number(row.total_debit) || 0);
    }
    const topCats = Object.entries(debitByCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => cat);

    const monthLabels = [
      ...new Set(catMonthRows.map((r) => r.month).filter(Boolean).sort())
    ].slice(-24) as string[];

    const lookup = new Map<string, number>();
    for (const row of catMonthRows) {
      lookup.set(`${row.month}::${row.category}`, Number(row.total_debit) || 0);
    }

    this.categoryTrendChartData = {
      labels: monthLabels,
      datasets: topCats.map((cat, i) => ({
        label: formatCategoryLabel(cat),
        data: monthLabels.map((m) => lookup.get(`${m}::${cat}`) || 0),
        borderColor: BANK_CHART_COLORS[i % BANK_CHART_COLORS.length],
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 2
      }))
    };

    this.buildHierarchyTable();
  }

  buildHierarchyTable() {
    if (!this.analytics) {
      this.hierarchyTableRows = [];
      return;
    }
    const sourceRows = (this.analytics.byCategory || []) as Array<{
      category: string;
      txn_count: number;
      total_debit: number;
      total_credit: number;
    }>;
    this.hierarchyTableRows = rollupCategoryRows(
      sourceRows,
      this.categoryGrain,
      this.categoryDrillKey
    );
  }

  setCashflowGrain(grain: PeriodGrain) {
    this.cashflowGrain = grain;
    this.buildPeriodCharts();
  }

  buildPeriodCharts() {
    const months = this.analytics?.byMonth || [];
    this.periodRows = this.aggregatePeriods(months, this.cashflowGrain);

    this.periodChartData = {
      labels: this.periodRows.map((r) => r.label),
      datasets: [
        {
          label: 'Credits',
          data: this.periodRows.map((r) => r.total_credit),
          backgroundColor: 'rgba(16, 185, 129, 0.8)'
        },
        {
          label: 'Debits',
          data: this.periodRows.map((r) => r.total_debit),
          backgroundColor: 'rgba(239, 68, 68, 0.8)'
        }
      ]
    };

    this.periodNetChartData = {
      labels: this.periodRows.map((r) => r.label),
      datasets: [{
        label: 'Net',
        data: this.periodRows.map((r) => r.net),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 3
      }]
    };

    if (this.periodRows.length) {
      this.periodBest = [...this.periodRows].sort((a, b) => b.net - a.net)[0];
      this.periodWorst = [...this.periodRows].sort((a, b) => a.net - b.net)[0];
    } else {
      this.periodBest = null;
      this.periodWorst = null;
    }
  }

  buildInterestCharts() {
    const rows = this.analytics?.interestByMonth || [];
    this.interestChartData = {
      labels: rows.map((r: any) => r.month),
      datasets: [
        {
          label: 'Interest earned',
          data: rows.map((r: any) => Number(r.interest) || 0),
          backgroundColor: 'rgba(16, 185, 129, 0.8)'
        },
        {
          label: 'TDS / tax',
          data: rows.map((r: any) => Number(r.tax) || 0),
          backgroundColor: 'rgba(245, 158, 11, 0.85)'
        },
        {
          label: 'FD booked',
          data: rows.map((r: any) => Number(r.fd_booked) || 0),
          backgroundColor: 'rgba(99, 102, 241, 0.8)'
        }
      ]
    };
  }

  aggregatePeriods(months: any[], grain: PeriodGrain): PeriodRow[] {
    if (!months?.length) return [];
    if (grain === 'month') {
      return months.map((m: any) => ({
        key: m.month,
        label: m.month,
        total_debit: Number(m.total_debit) || 0,
        total_credit: Number(m.total_credit) || 0,
        net: Number(m.net) || 0,
        txn_count: Number(m.txn_count) || 0
      }));
    }

    const map = new Map<string, PeriodRow>();
    for (const m of months) {
      const ym = String(m.month || '');
      const [y, mo] = ym.split('-').map(Number);
      if (!y || !mo) continue;
      let key = '';
      let label = '';
      if (grain === 'year') {
        key = String(y);
        label = String(y);
      } else {
        const q = Math.ceil(mo / 3);
        key = `${y}-Q${q}`;
        label = `${y} Q${q}`;
      }
      const row = map.get(key) || {
        key,
        label,
        total_debit: 0,
        total_credit: 0,
        net: 0,
        txn_count: 0
      };
      row.total_debit += Number(m.total_debit) || 0;
      row.total_credit += Number(m.total_credit) || 0;
      row.net += Number(m.net) || 0;
      row.txn_count += Number(m.txn_count) || 0;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  categoryPct(amount: number): number {
    const total = Number(this.analytics?.summary?.total_debit) || 0;
    if (!total) return 0;
    return (Number(amount) / total) * 100;
  }
}
