import { Component, OnInit } from '@angular/core';
import { AnalyticsFilters, AnalyticsService } from '../../services/analytics.service';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { INVESTMENT_TYPES } from '../../constants/investment-types.constants';
import { hasMultiSelectFilter, pruneSelections } from '../../utils/advanced-filter.util';
import { getIndianAmountBreakdown, IndianAmountBreakdown, formatIndianFull } from '../../utils/indian-number.util';

export interface AssetTrackerRow {
  date: string;
  dateLabel: string;
  amount: number;
  diffPreviousDate: number;
  diffPreviousPercent: number;
  daysSincePrevious: number | null;
  diffInL: number;
  monthsDiff: number;
  diffWithCurrent: number;
  percent: number;
  isLatest: boolean;
}

export interface AssetTrackerStats {
  currentAmount: number;
  latestSnapshotLabel: string;
  latestSnapshotAmount: number;
  firstSnapshotLabel: string;
  firstAmount: number;
  snapshotCount: number;
  totalGrowth: number;
  totalGrowthPercent: number;
  sinceLastSnapshot: number;
  sinceLastSnapshotPercent: number;
  highestAmount: number;
  highestDateLabel: string;
  lowestAmount: number;
  lowestDateLabel: string;
  cagr: number | null;
  trackingMonths: number;
  trackingDays: number;
  trackingPeriodLabel: string;
  avgPeriodChange: number;
  daysSinceLastSnapshot: number;
  drawdownFromPeak: number;
  drawdownFromPeakPercent: number;
  riseFromLow: number;
  riseFromLowPercent: number;
  positivePeriods: number;
  negativePeriods: number;
  bestPeriodLabel: string;
  bestPeriodPercent: number;
  worstPeriodLabel: string;
  worstPeriodPercent: number;
  lastPeriodChange: number;
  lastPeriodChangePercent: number;
  insights: string[];
  winRate: number;
  avgPeriodPercent: number;
  volatilityPercent: number;
  maxGapDays: number;
  avgGapDays: number;
  healthScore: number;
  healthLabel: string;
  healthHints: string[];
}

export interface MonthlyReportRow {
  monthKey: string;
  monthLabel: string;
  startAmount: number;
  endAmount: number;
  change: number;
  changePercent: number;
  snapshotCount: number;
  bestPercent: number;
  worstPercent: number;
}

export interface YearlyReportRow {
  year: string;
  startAmount: number;
  endAmount: number;
  change: number;
  changePercent: number;
  snapshotCount: number;
  bestPercent: number;
  worstPercent: number;
}

export interface AllocationSlice {
  label: string;
  value: number;
  percent: number;
}

export interface SnapshotCompare {
  fromDate: string;
  toDate: string;
  fromLabel: string;
  toLabel: string;
  fromAmount: number;
  toAmount: number;
  change: number;
  changePercent: number;
  days: number;
  annualizedPercent: number | null;
}

export interface FilterChip {
  id: string;
  label: string;
}

type SortDirection = 'asc' | 'desc';
type RangePreset = '1m' | '3m' | '6m' | '1y' | 'ytd' | 'all';
type SnapshotSortColumn = 'date' | 'amount' | 'diffPreviousDate' | 'diffPreviousPercent' | 'daysSincePrevious' | 'diffWithCurrent' | 'percent';

const GOAL_STORAGE_KEY = 'asset-tracker-goal-amount';

@Component({
  selector: 'app-asset-tracker',
  templateUrl: './asset-tracker.component.html',
  styleUrls: ['./asset-tracker.component.css'],
  standalone: false
})
export class AssetTrackerComponent implements OnInit {
  rows: AssetTrackerRow[] = [];
  displayRows: AssetTrackerRow[] = [];
  stats: AssetTrackerStats | null = null;
  currentTotalBreakdown: IndianAmountBreakdown | null = null;
  growthBreakdown: IndianAmountBreakdown | null = null;
  peakBreakdown: IndianAmountBreakdown | null = null;
  firstAmountBreakdown: IndianAmountBreakdown | null = null;
  lastSnapshotBreakdown: IndianAmountBreakdown | null = null;
  loading = false;
  errorMessage = '';
  currentAmount = 0;
  sortDirection: SortDirection = 'asc';
  filterEmptyMessage = '';

  showAdvancedFilters = false;
  applyingFilters = false;
  filterFrom = '';
  filterTo = '';
  filterPlatforms: string[] = [];
  filterTypes: string[] = [];
  filterSubTypes: string[] = [];
  filterCategories: string[] = [];
  filterMinAmount: number | null = null;
  filterMaxAmount: number | null = null;
  filterIgnoreZero = false;
  /** When true (default), hide Period % / Growth vs Current points above 400% (impossible outliers). */
  filterIgnoreExtremePercent = true;
  /** When true (default), hide Period % / Growth vs Current points at or below -100%. */
  filterIgnoreFloorPercent = true;
  private readonly extremePercentLimit = 400;
  private readonly floorPercentLimit = -100;

  investmentTypes: string[] = INVESTMENT_TYPES;
  filterPlatformsOptions: string[] = [];
  filterSummaryData: any[] = [];

  private allSortedDates: string[] = [];
  private allByDate = new Map<string, number>();

  amountDiffChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  periodChangeChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  growthChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  cumulativeChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  allocationChartData: ChartConfiguration<'doughnut'>['data'] = {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        'rgba(102, 126, 234, 0.85)',
        'rgba(16, 185, 129, 0.85)',
        'rgba(245, 158, 11, 0.85)',
        'rgba(239, 68, 68, 0.85)',
        'rgba(118, 75, 162, 0.85)',
        'rgba(59, 130, 246, 0.85)',
        'rgba(236, 72, 153, 0.85)',
        'rgba(14, 165, 233, 0.85)'
      ]
    }]
  };

  monthlyReport: MonthlyReportRow[] = [];
  yearlyReport: YearlyReportRow[] = [];
  allocationBreakdown: AllocationSlice[] = [];
  activeRangePreset: RangePreset | null = null;
  goalAmount: number | null = null;
  goalInput: number | null = null;
  goalProgressPercent = 0;
  goalRemaining = 0;
  goalEtaLabel = '';
  showGoalEditor = false;
  allocationLoading = false;
  allocationEmpty = false;
  copyMessage = '';
  troughBreakdown: IndianAmountBreakdown | null = null;

  compareFrom = '';
  compareTo = '';
  snapshotSearch = '';
  tableSortBy: SnapshotSortColumn = 'date';
  snapshotPage = 1;
  snapshotPageSize = 25;
  snapshotTotalPages = 0;
  pagedDisplayRows: AssetTrackerRow[] = [];

  private readonly inrTooltip = (value: number) =>
    '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  amountDiffChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            if (context.dataset.yAxisID === 'y1') {
              const prefix = value >= 0 ? '+' : '-';
              return `${context.dataset.label}: ${prefix}${this.inrTooltip(Math.abs(value)).slice(1)}`;
            }
            return `${context.dataset.label}: ${this.inrTooltip(value)}`;
          }
        }
      }
    },
    scales: {
      y: {
        position: 'left',
        title: { display: true, text: 'Portfolio Value' },
        ticks: { callback: (value) => '₹' + Number(value).toLocaleString('en-IN') }
      },
      y1: {
        position: 'right',
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Period Change' },
        ticks: { callback: (value) => '₹' + Number(value).toLocaleString('en-IN') }
      }
    }
  };

  periodChangeChartOptions: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            const prefix = value >= 0 ? '+' : '';
            return `${context.dataset.label}: ${prefix}${value.toFixed(2)}%`;
          }
        }
      }
    },
    scales: {
      y: {
        title: { display: true, text: '% vs Previous Snapshot' },
        ticks: { callback: (value) => `${value}%` }
      }
    }
  };

  growthChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${(context.parsed.y ?? 0).toFixed(2)}%`
        }
      }
    },
    scales: {
      y: {
        title: { display: true, text: '% Growth vs Current' },
        ticks: { callback: (value) => `${value}%` }
      }
    }
  };

  cumulativeChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${(context.parsed.y ?? 0).toFixed(2)}`
        }
      }
    },
    scales: {
      y: {
        title: { display: true, text: 'Indexed (first snapshot = 100)' },
        ticks: { callback: (value) => Number(value).toFixed(0) }
      }
    }
  };

  allocationChartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'right' },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = Number(context.parsed) || 0;
            const total = (context.dataset.data as number[]).reduce((a, b) => a + (Number(b) || 0), 0);
            const pct = total > 0 ? (value / total) * 100 : 0;
            return `${context.label}: ${this.inrTooltip(value)} (${pct.toFixed(1)}%)`;
          }
        }
      }
    }
  };

  constructor(private analyticsService: AnalyticsService) {}

  ngOnInit() {
    this.loadGoalFromStorage();
    this.loadFilterOptions();
    this.loadData();
  }

  applyRangePreset(preset: RangePreset) {
    this.activeRangePreset = preset;
    const today = new Date();
    const toKey = this.toDateKey(today);

    if (preset === 'all') {
      this.filterFrom = '';
      this.filterTo = '';
    } else if (preset === 'ytd') {
      this.filterFrom = `${today.getFullYear()}-01-01`;
      this.filterTo = toKey;
    } else {
      const months = preset === '1m' ? 1 : preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
      const from = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
      this.filterFrom = this.toDateKey(from);
      this.filterTo = toKey;
    }

    this.applyingFilters = true;
    this.loadData();
  }

  toggleGoalEditor() {
    this.showGoalEditor = !this.showGoalEditor;
    if (this.showGoalEditor) {
      this.goalInput = this.goalAmount;
    }
  }

  saveGoal() {
    const value = this.goalInput;
    if (value === null || value === undefined || Number.isNaN(value) || value <= 0) {
      this.clearGoal();
      return;
    }
    this.goalAmount = value;
    try {
      localStorage.setItem(GOAL_STORAGE_KEY, String(value));
    } catch { /* ignore */ }
    this.updateGoalProgress();
    this.showGoalEditor = false;
  }

  clearGoal() {
    this.goalAmount = null;
    this.goalInput = null;
    this.goalProgressPercent = 0;
    this.goalRemaining = 0;
    this.goalEtaLabel = '';
    this.showGoalEditor = false;
    try {
      localStorage.removeItem(GOAL_STORAGE_KEY);
    } catch { /* ignore */ }
  }

  exportCsv() {
    this.exportSnapshotCsv();
  }

  exportSnapshotCsv() {
    if (!this.displayRows.length) return;

    const headers = [
      'Date',
      'Amount',
      'Diff Previous',
      'Period %',
      'Days Gap',
      'Diff in L',
      'Months to Latest',
      'Diff vs Current',
      '% vs Current'
    ];
    const lines = this.displayRows.map((row) => [
      row.date,
      row.amount.toFixed(2),
      row.diffPreviousDate.toFixed(2),
      row.diffPreviousPercent.toFixed(4),
      row.daysSincePrevious ?? '',
      row.diffInL.toFixed(4),
      row.monthsDiff,
      row.diffWithCurrent.toFixed(2),
      row.percent.toFixed(4)
    ].join(','));

    this.downloadCsv(`asset-tracker-snapshots-${this.toDateKey(new Date())}.csv`, [headers.join(','), ...lines].join('\n'));
  }

  exportMonthlyCsv() {
    if (!this.monthlyReport.length) return;
    const headers = ['Month', 'Snapshots', 'Start', 'End', 'Change', 'Change %', 'Best %', 'Worst %'];
    const lines = this.monthlyReport.map((m) => [
      m.monthLabel,
      m.snapshotCount,
      m.startAmount.toFixed(2),
      m.endAmount.toFixed(2),
      m.change.toFixed(2),
      m.changePercent.toFixed(4),
      m.bestPercent.toFixed(4),
      m.worstPercent.toFixed(4)
    ].join(','));
    this.downloadCsv(`asset-tracker-monthly-${this.toDateKey(new Date())}.csv`, [headers.join(','), ...lines].join('\n'));
  }

  exportYearlyCsv() {
    if (!this.yearlyReport.length) return;
    const headers = ['Year', 'Snapshots', 'Start', 'End', 'Change', 'Change %', 'Best %', 'Worst %'];
    const lines = this.yearlyReport.map((y) => [
      y.year,
      y.snapshotCount,
      y.startAmount.toFixed(2),
      y.endAmount.toFixed(2),
      y.change.toFixed(2),
      y.changePercent.toFixed(4),
      y.bestPercent.toFixed(4),
      y.worstPercent.toFixed(4)
    ].join(','));
    this.downloadCsv(`asset-tracker-yearly-${this.toDateKey(new Date())}.csv`, [headers.join(','), ...lines].join('\n'));
  }

  private downloadCsv(filename: string, csv: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  healthToneClass(): string {
    const score = this.stats?.healthScore ?? 0;
    if (score >= 75) return 'health-good';
    if (score >= 50) return 'health-ok';
    return 'health-low';
  }

  private loadGoalFromStorage() {
    try {
      const raw = localStorage.getItem(GOAL_STORAGE_KEY);
      if (!raw) return;
      const value = parseFloat(raw);
      if (Number.isFinite(value) && value > 0) {
        this.goalAmount = value;
        this.goalInput = value;
      }
    } catch { /* ignore */ }
  }

  private updateGoalProgress() {
    if (!this.goalAmount || this.goalAmount <= 0) {
      this.goalProgressPercent = 0;
      this.goalRemaining = 0;
      this.goalEtaLabel = '';
      return;
    }
    this.goalProgressPercent = Math.min(100, (this.currentAmount / this.goalAmount) * 100);
    this.goalRemaining = Math.max(0, this.goalAmount - this.currentAmount);
    this.goalEtaLabel = this.computeGoalEta();
  }

  refresh() {
    this.loadData();
  }

  toggleSort() {
    this.tableSortBy = 'date';
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.applySort();
  }

  onSnapshotSearch() {
    this.snapshotPage = 1;
    this.applySort();
  }

  onSnapshotPageSizeChange() {
    this.snapshotPage = 1;
    this.applySort();
  }

  onSnapshotPageChange(page: number) {
    if (page >= 1 && page <= this.snapshotTotalPages) {
      this.snapshotPage = page;
      this.applySort();
    }
  }

  onTableSort(column: SnapshotSortColumn) {
    if (this.tableSortBy === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.tableSortBy = column;
      this.sortDirection = column === 'date' ? 'desc' : 'desc';
    }
    this.snapshotPage = 1;
    this.applySort();
  }

  tableSortIcon(column: SnapshotSortColumn): string {
    if (this.tableSortBy !== column) return '↕';
    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  toggleAdvancedFilters() {
    this.showAdvancedFilters = !this.showAdvancedFilters;
  }

  get availableFilterSubTypes(): string[] {
    let source = this.filterSummaryData;
    if (this.filterTypes.length) {
      source = source.filter((item) => this.filterTypes.includes(item.investment_type));
    }
    return [...new Set(source.map((item) => item.sub_type_name))].filter(Boolean).sort();
  }

  get availableFilterCategories(): string[] {
    let source = this.filterSummaryData;
    if (this.filterTypes.length) {
      source = source.filter((item) => this.filterTypes.includes(item.investment_type));
    }
    if (this.filterSubTypes.length) {
      source = source.filter((item) => this.filterSubTypes.includes(item.sub_type_name));
    }
    return [...new Set(source.map((item) => item.sub_type_category))].filter(Boolean).sort();
  }

  hasActiveFilters(): boolean {
    return !!(
      hasMultiSelectFilter(this.filterTypes) ||
      hasMultiSelectFilter(this.filterSubTypes) ||
      hasMultiSelectFilter(this.filterCategories) ||
      hasMultiSelectFilter(this.filterPlatforms) ||
      this.filterFrom ||
      this.filterTo ||
      this.isPriceFilterActive() ||
      this.filterIgnoreZero
    );
  }

  isPriceFilterActive(): boolean {
    return (this.filterMinAmount !== null && this.filterMinAmount !== undefined && !Number.isNaN(this.filterMinAmount)) ||
      (this.filterMaxAmount !== null && this.filterMaxAmount !== undefined && !Number.isNaN(this.filterMaxAmount));
  }

  onAdvancedTypeChange() {
    this.filterSubTypes = pruneSelections(this.filterSubTypes, this.availableFilterSubTypes);
    this.filterCategories = pruneSelections(this.filterCategories, this.availableFilterCategories);
  }

  onAdvancedSubTypeChange() {
    this.filterCategories = pruneSelections(this.filterCategories, this.availableFilterCategories);
  }

  getAnalyticsFilters(): AnalyticsFilters {
    return {
      from: this.filterFrom || undefined,
      to: this.filterTo || undefined,
      platform: this.filterPlatforms,
      type: this.filterTypes,
      subType: this.filterSubTypes,
      category: this.filterCategories,
      minAmount: this.filterMinAmount,
      maxAmount: this.filterMaxAmount,
      ignoreZero: this.filterIgnoreZero
    };
  }

  applyFilters() {
    this.activeRangePreset = null;
    this.applyingFilters = true;
    this.loadData();
  }

  clearFilters() {
    this.filterPlatforms = [];
    this.filterTypes = [];
    this.filterSubTypes = [];
    this.filterCategories = [];
    this.filterFrom = '';
    this.filterTo = '';
    this.filterMinAmount = null;
    this.filterMaxAmount = null;
    this.filterIgnoreZero = false;
    this.filterIgnoreExtremePercent = true;
    this.filterIgnoreFloorPercent = true;
    this.filterEmptyMessage = '';
    this.activeRangePreset = 'all';
    this.applyingFilters = true;
    this.loadData();
  }

  onIgnoreChartPercentChange() {
    this.buildCharts();
  }

  loadFilterOptions() {
    this.analyticsService.getSummaryTable().subscribe({
      next: (response) => {
        if (response.data) {
          this.filterSummaryData = response.data;
          this.filterPlatformsOptions = [...new Set(response.data.map((item: any) => item.website_app_name))]
            .filter(Boolean)
            .sort();
        }
      },
      error: (error) => console.error('Error loading filter options:', error)
    });
  }

  loadData() {
    this.loading = true;
    this.errorMessage = '';
    this.filterEmptyMessage = '';
    const filters = this.getAnalyticsFilters();
    const hasScopedFilters = this.hasScopedFilters();

    this.analyticsService.getValueSeriesFiltered(filters).subscribe({
      next: (response) => {
        const rawRows = response.data?.rows || [];
        const byDate = new Map<string, number>();

        for (const row of rawRows) {
          if (!row.change_date) continue;
          const dateKey = this.normalizeDateKey(row.change_date);
          if (!dateKey) continue;
          const amount = this.toNumber(row.total_value);
          byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + amount);
        }

        const sortedDates = [...byDate.keys()].sort(
          (a, b) => this.parseDateKey(a).getTime() - this.parseDateKey(b).getTime()
        );

        this.allSortedDates = sortedDates;
        this.allByDate = byDate;

        if (sortedDates.length === 0) {
          this.allSortedDates = [];
          this.allByDate = new Map();
          this.currentAmount = 0;
          this.clearView();
          this.filterEmptyMessage = this.hasActiveFilters()
            ? 'No snapshots found for the selected filters.'
            : '';
          this.finishLoading();
          return;
        }

        const latestDate = sortedDates[sortedDates.length - 1];
        const latestSnapshotAmount = byDate.get(latestDate) ?? 0;

        if (hasScopedFilters) {
          this.currentAmount = latestSnapshotAmount;
          this.rebuildFromStoredData();
          this.finishLoading();
          return;
        }

        this.analyticsService.getTotal().subscribe({
          next: (totalResponse) => {
            const liveTotal = this.toNumber(totalResponse.data?.total_amount);
            this.currentAmount = liveTotal > 0 ? liveTotal : latestSnapshotAmount;
            this.rebuildFromStoredData();
            this.finishLoading();
          },
          error: () => {
            this.currentAmount = latestSnapshotAmount;
            this.rebuildFromStoredData();
            this.finishLoading();
          }
        });
      },
      error: (error) => {
        console.error('Error loading asset tracker data:', error);
        this.errorMessage = 'Failed to load asset tracker data. ' + (error.message || 'Please check if backend is running.');
        this.finishLoading();
      }
    });
  }

  private hasScopedFilters(): boolean {
    return !!(
      hasMultiSelectFilter(this.filterTypes) ||
      hasMultiSelectFilter(this.filterSubTypes) ||
      hasMultiSelectFilter(this.filterCategories) ||
      hasMultiSelectFilter(this.filterPlatforms) ||
      this.isPriceFilterActive() ||
      this.filterIgnoreZero
    );
  }

  private finishLoading() {
    this.loading = false;
    this.applyingFilters = false;
  }

  private rebuildFromStoredData() {
    if (this.allSortedDates.length === 0) {
      this.clearView();
      return;
    }

    this.filterEmptyMessage = '';
    const latestInView = this.allSortedDates[this.allSortedDates.length - 1];
    this.buildRows(this.allSortedDates, this.allByDate, latestInView);
    this.updateGoalProgress();
    this.loadAllocation();
  }

  private clearView() {
    this.rows = [];
    this.displayRows = [];
    this.stats = null;
    this.monthlyReport = [];
    this.yearlyReport = [];
    this.allocationBreakdown = [];
    this.currentTotalBreakdown = null;
    this.growthBreakdown = null;
    this.peakBreakdown = null;
    this.troughBreakdown = null;
    this.firstAmountBreakdown = null;
    this.lastSnapshotBreakdown = null;
    this.goalProgressPercent = 0;
    this.goalRemaining = 0;
    this.goalEtaLabel = '';
    this.allocationEmpty = true;
    this.allocationChartData = {
      labels: [],
      datasets: [{
        ...this.allocationChartData.datasets[0],
        data: []
      }]
    };
    this.buildCharts();
  }

  private loadAllocation() {
    this.allocationLoading = true;
    this.allocationEmpty = false;
    this.analyticsService.getAllocationLatestFiltered(this.getAnalyticsFilters()).subscribe({
      next: (response) => {
        const rows = response.data || [];
        if (!rows.length) {
          this.allocationEmpty = true;
          this.allocationBreakdown = [];
          this.allocationChartData = {
            labels: [],
            datasets: [{
              ...this.allocationChartData.datasets[0],
              data: []
            }]
          };
        } else {
          const sorted = [...rows].sort(
            (a, b) => this.toNumber(b.value) - this.toNumber(a.value)
          );
          const total = sorted.reduce((sum, r) => sum + this.toNumber(r.value), 0);
          this.allocationEmpty = false;
          this.allocationBreakdown = sorted.map((r) => {
            const value = this.toNumber(r.value);
            return {
              label: r.investment_type,
              value,
              percent: total > 0 ? (value / total) * 100 : 0
            };
          });
          this.allocationChartData = {
            labels: sorted.map((r) => r.investment_type),
            datasets: [{
              ...this.allocationChartData.datasets[0],
              data: sorted.map((r) => this.toNumber(r.value))
            }]
          };
        }
        this.allocationLoading = false;
      },
      error: () => {
        this.allocationEmpty = true;
        this.allocationBreakdown = [];
        this.allocationLoading = false;
      }
    });
  }

  private buildRows(sortedDates: string[], byDate: Map<string, number>, latestDate: string) {
    this.rows = sortedDates.map((dateKey, index) => {
      const amount = byDate.get(dateKey) ?? 0;
      const prevAmount = index > 0 ? (byDate.get(sortedDates[index - 1]) ?? 0) : 0;
      const prevDateKey = index > 0 ? sortedDates[index - 1] : null;
      const diffPreviousDate = index === 0 ? 0 : amount - prevAmount;
      const diffPreviousPercent = index === 0 || prevAmount === 0
        ? 0
        : (diffPreviousDate / prevAmount) * 100;
      const daysSincePrevious = prevDateKey
        ? this.daysBetween(this.parseDateKey(prevDateKey), this.parseDateKey(dateKey))
        : null;
      const diffWithCurrent = this.currentAmount - amount;
      const diffInL = diffWithCurrent / 100000;
      const monthsDiff = this.monthsBetween(this.parseDateKey(dateKey), this.parseDateKey(latestDate));
      const percent = amount !== 0 ? (diffWithCurrent / amount) * 100 : 0;

      return {
        date: dateKey,
        dateLabel: this.formatDateLabel(dateKey),
        amount,
        diffPreviousDate,
        diffPreviousPercent,
        daysSincePrevious,
        diffInL,
        monthsDiff,
        diffWithCurrent,
        percent,
        isLatest: dateKey === latestDate
      };
    });

    this.computeStats(latestDate);
    this.buildMonthlyReport();
    this.buildYearlyReport();
    this.syncCompareDates();
    this.currentTotalBreakdown = getIndianAmountBreakdown(this.currentAmount);
    this.growthBreakdown = getIndianAmountBreakdown(this.stats?.totalGrowth ?? 0);
    this.peakBreakdown = getIndianAmountBreakdown(this.stats?.highestAmount ?? 0);
    this.troughBreakdown = getIndianAmountBreakdown(this.stats?.lowestAmount ?? 0);
    this.firstAmountBreakdown = getIndianAmountBreakdown(this.stats?.firstAmount ?? 0);
    this.lastSnapshotBreakdown = getIndianAmountBreakdown(this.stats?.latestSnapshotAmount ?? 0);
    this.snapshotPage = 1;
    this.applySort();
    this.buildCharts();
  }

  private computeStats(latestDate: string) {
    if (this.rows.length === 0) {
      this.stats = null;
      return;
    }

    const first = this.rows[0];
    const latest = this.rows[this.rows.length - 1];
    const amounts = this.rows.map((r) => r.amount);
    const highest = Math.max(...amounts);
    const lowest = Math.min(...amounts);
    const highestRow = this.rows.find((r) => r.amount === highest)!;
    const lowestRow = this.rows.find((r) => r.amount === lowest)!;

    const periodRows = this.rows.slice(1);
    const periodChanges = periodRows.map((r) => r.diffPreviousDate);
    const periodPercents = periodRows.map((r) => r.diffPreviousPercent);
    const avgPeriodChange = periodChanges.length
      ? periodChanges.reduce((a, b) => a + b, 0) / periodChanges.length
      : 0;
    const avgPeriodPercent = periodPercents.length
      ? periodPercents.reduce((a, b) => a + b, 0) / periodPercents.length
      : 0;

    let volatilityPercent = 0;
    if (periodPercents.length > 1) {
      const variance = periodPercents.reduce((sum, p) => sum + Math.pow(p - avgPeriodPercent, 2), 0)
        / periodPercents.length;
      volatilityPercent = Math.sqrt(variance);
    }

    const positivePeriods = periodRows.filter((r) => r.diffPreviousDate > 0).length;
    const negativePeriods = periodRows.filter((r) => r.diffPreviousDate < 0).length;
    const totalPeriods = periodRows.length;
    const winRate = totalPeriods > 0 ? (positivePeriods / totalPeriods) * 100 : 0;

    const gaps = periodRows
      .map((r) => r.daysSincePrevious)
      .filter((d): d is number => d !== null);
    const maxGapDays = gaps.length ? Math.max(...gaps) : 0;
    const avgGapDays = gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : 0;

    let bestPeriod = periodRows.length > 0 ? periodRows[0] : null;
    let worstPeriod = periodRows.length > 0 ? periodRows[0] : null;
    for (const row of periodRows) {
      if (bestPeriod && row.diffPreviousPercent > bestPeriod.diffPreviousPercent) bestPeriod = row;
      if (worstPeriod && row.diffPreviousPercent < worstPeriod.diffPreviousPercent) worstPeriod = row;
    }

    const trackingMonths = Math.max(1, this.monthsBetween(
      this.parseDateKey(first.date),
      this.parseDateKey(latestDate)
    ));
    const trackingDays = this.daysBetween(
      this.parseDateKey(first.date),
      this.parseDateKey(latestDate)
    );
    const daysSinceLastSnapshot = this.daysBetween(
      this.parseDateKey(latestDate),
      new Date()
    );

    let cagr: number | null = null;
    if (first.amount > 0 && trackingMonths > 0) {
      const years = trackingMonths / 12;
      cagr = (Math.pow(this.currentAmount / first.amount, 1 / years) - 1) * 100;
    }

    const sinceLastSnapshot = this.currentAmount - latest.amount;
    const sinceLastSnapshotPercent = latest.amount !== 0
      ? (sinceLastSnapshot / latest.amount) * 100
      : 0;

    const totalGrowth = this.currentAmount - first.amount;
    const totalGrowthPercent = first.amount !== 0
      ? (totalGrowth / first.amount) * 100
      : 0;

    const drawdownFromPeak = this.currentAmount - highest;
    const drawdownFromPeakPercent = highest !== 0 ? (drawdownFromPeak / highest) * 100 : 0;
    const riseFromLow = this.currentAmount - lowest;
    const riseFromLowPercent = lowest !== 0 ? (riseFromLow / lowest) * 100 : 0;

    const lastPeriodChange = latest.diffPreviousDate;
    const lastPeriodChangePercent = latest.diffPreviousPercent;

    const insights = this.buildInsights({
      totalGrowthPercent,
      firstSnapshotLabel: first.dateLabel,
      drawdownFromPeakPercent,
      highestDateLabel: highestRow.dateLabel,
      sinceLastSnapshot,
      latestSnapshotLabel: latest.dateLabel,
      daysSinceLastSnapshot,
      positivePeriods,
      negativePeriods,
      snapshotCount: this.rows.length,
      trackingPeriodLabel: `${first.dateLabel} → ${latest.dateLabel}`,
      bestPeriodLabel: bestPeriod?.dateLabel ?? '',
      bestPeriodPercent: bestPeriod?.diffPreviousPercent ?? 0,
      worstPeriodLabel: worstPeriod?.dateLabel ?? '',
      worstPeriodPercent: worstPeriod?.diffPreviousPercent ?? 0,
      cagr,
      winRate,
      volatilityPercent,
      maxGapDays
    });

    const { healthScore, healthLabel, healthHints } = this.computeHealthScore({
      winRate,
      daysSinceLastSnapshot,
      drawdownFromPeakPercent,
      volatilityPercent,
      maxGapDays,
      avgGapDays,
      snapshotCount: this.rows.length
    });

    this.stats = {
      currentAmount: this.currentAmount,
      latestSnapshotLabel: latest.dateLabel,
      latestSnapshotAmount: latest.amount,
      firstSnapshotLabel: first.dateLabel,
      firstAmount: first.amount,
      snapshotCount: this.rows.length,
      totalGrowth,
      totalGrowthPercent,
      sinceLastSnapshot,
      sinceLastSnapshotPercent,
      highestAmount: highest,
      highestDateLabel: highestRow.dateLabel,
      lowestAmount: lowest,
      lowestDateLabel: lowestRow.dateLabel,
      cagr,
      trackingMonths,
      trackingDays,
      trackingPeriodLabel: `${first.dateLabel} → ${latest.dateLabel}`,
      avgPeriodChange,
      daysSinceLastSnapshot,
      drawdownFromPeak,
      drawdownFromPeakPercent,
      riseFromLow,
      riseFromLowPercent,
      positivePeriods,
      negativePeriods,
      bestPeriodLabel: bestPeriod?.dateLabel ?? '—',
      bestPeriodPercent: bestPeriod?.diffPreviousPercent ?? 0,
      worstPeriodLabel: worstPeriod?.dateLabel ?? '—',
      worstPeriodPercent: worstPeriod?.diffPreviousPercent ?? 0,
      lastPeriodChange,
      lastPeriodChangePercent,
      insights,
      winRate,
      avgPeriodPercent,
      volatilityPercent,
      maxGapDays,
      avgGapDays,
      healthScore,
      healthLabel,
      healthHints
    };
  }

  private buildInsights(ctx: {
    totalGrowthPercent: number;
    firstSnapshotLabel: string;
    drawdownFromPeakPercent: number;
    highestDateLabel: string;
    sinceLastSnapshot: number;
    latestSnapshotLabel: string;
    daysSinceLastSnapshot: number;
    positivePeriods: number;
    negativePeriods: number;
    snapshotCount: number;
    trackingPeriodLabel: string;
    bestPeriodLabel: string;
    bestPeriodPercent: number;
    worstPeriodLabel: string;
    worstPeriodPercent: number;
    cagr: number | null;
    winRate: number;
    volatilityPercent: number;
    maxGapDays: number;
  }): string[] {
    const insights: string[] = [];

    if (ctx.totalGrowthPercent > 0) {
      insights.push(`Portfolio grew ${ctx.totalGrowthPercent.toFixed(2)}% since first snapshot (${ctx.firstSnapshotLabel}).`);
    } else if (ctx.totalGrowthPercent < 0) {
      insights.push(`Portfolio is down ${Math.abs(ctx.totalGrowthPercent).toFixed(2)}% since first snapshot (${ctx.firstSnapshotLabel}).`);
    } else {
      insights.push(`Portfolio is flat since first snapshot (${ctx.firstSnapshotLabel}).`);
    }

    if (ctx.drawdownFromPeakPercent < -0.01) {
      insights.push(`Currently ${Math.abs(ctx.drawdownFromPeakPercent).toFixed(2)}% below peak on ${ctx.highestDateLabel}.`);
    } else if (Math.abs(ctx.drawdownFromPeakPercent) <= 0.01) {
      insights.push(`At all-time high — peak recorded on ${ctx.highestDateLabel}.`);
    }

    if (Math.abs(ctx.sinceLastSnapshot) < 0.01) {
      insights.push(`Live total matches latest snapshot (${ctx.latestSnapshotLabel}) — ${ctx.daysSinceLastSnapshot} day(s) ago.`);
    } else if (ctx.sinceLastSnapshot > 0) {
      insights.push(`Live total is ₹${ctx.sinceLastSnapshot.toLocaleString('en-IN')} above last snapshot (${ctx.latestSnapshotLabel}).`);
    } else {
      insights.push(`Live total is ₹${Math.abs(ctx.sinceLastSnapshot).toLocaleString('en-IN')} below last snapshot (${ctx.latestSnapshotLabel}).`);
    }

    const totalPeriods = ctx.snapshotCount - 1;
    if (totalPeriods > 0) {
      insights.push(
        `${ctx.positivePeriods} up / ${ctx.negativePeriods} down periods · win rate ${ctx.winRate.toFixed(0)}% · vol ${ctx.volatilityPercent.toFixed(1)}%.`
      );
    }

    if (ctx.maxGapDays >= 45) {
      insights.push(`Largest snapshot gap is ${ctx.maxGapDays} days — denser history improves trend accuracy.`);
    }

    if (ctx.bestPeriodPercent > 0 && ctx.bestPeriodLabel) {
      insights.push(`Best period: +${ctx.bestPeriodPercent.toFixed(2)}% on ${ctx.bestPeriodLabel}.`);
    }
    if (ctx.worstPeriodPercent < 0 && ctx.worstPeriodLabel) {
      insights.push(`Worst period: ${ctx.worstPeriodPercent.toFixed(2)}% on ${ctx.worstPeriodLabel}.`);
    }

    if (ctx.cagr !== null) {
      insights.push(`Tracking ${ctx.trackingPeriodLabel} (${ctx.snapshotCount} snapshots).`);
    }

    return insights;
  }

  private computeHealthScore(ctx: {
    winRate: number;
    daysSinceLastSnapshot: number;
    drawdownFromPeakPercent: number;
    volatilityPercent: number;
    maxGapDays: number;
    avgGapDays: number;
    snapshotCount: number;
  }): { healthScore: number; healthLabel: string; healthHints: string[] } {
    let score = 0;
    const hints: string[] = [];

    // Win rate (0–30)
    const winPts = Math.min(30, (ctx.winRate / 100) * 30);
    score += winPts;
    if (ctx.winRate < 45) hints.push('More down periods than usual — review recent movers.');

    // Freshness (0–25)
    let freshPts = 0;
    if (ctx.daysSinceLastSnapshot <= 7) freshPts = 25;
    else if (ctx.daysSinceLastSnapshot <= 21) freshPts = 18;
    else if (ctx.daysSinceLastSnapshot <= 45) freshPts = 10;
    else freshPts = 3;
    score += freshPts;
    if (ctx.daysSinceLastSnapshot > 14) {
      hints.push(`Last snapshot was ${ctx.daysSinceLastSnapshot} days ago — add a fresh entry.`);
    }

    // Drawdown resilience (0–25)
    const dd = Math.abs(Math.min(0, ctx.drawdownFromPeakPercent));
    let ddPts = 25;
    if (dd > 20) ddPts = 5;
    else if (dd > 10) ddPts = 12;
    else if (dd > 5) ddPts = 18;
    else if (dd > 1) ddPts = 22;
    score += ddPts;
    if (dd > 5) hints.push(`${dd.toFixed(1)}% below peak — watch recovery path.`);

    // Consistency / cadence (0–20)
    let cadencePts = 20;
    if (ctx.maxGapDays > 60) cadencePts = 6;
    else if (ctx.maxGapDays > 35) cadencePts = 12;
    else if (ctx.avgGapDays > 20) cadencePts = 14;
    if (ctx.volatilityPercent > 15) cadencePts = Math.max(4, cadencePts - 6);
    score += cadencePts;
    if (ctx.snapshotCount < 4) hints.push('Few snapshots yet — score stabilizes with more history.');

    score = Math.round(Math.max(0, Math.min(100, score)));
    let healthLabel = 'Needs attention';
    if (score >= 75) healthLabel = 'Strong';
    else if (score >= 50) healthLabel = 'Steady';

    if (hints.length === 0) {
      hints.push('Tracking looks healthy — keep a regular snapshot cadence.');
    }

    return { healthScore: score, healthLabel, healthHints: hints.slice(0, 3) };
  }

  private buildMonthlyReport() {
    if (this.rows.length === 0) {
      this.monthlyReport = [];
      return;
    }

    const byMonth = new Map<string, AssetTrackerRow[]>();
    for (const row of this.rows) {
      const key = row.date.slice(0, 7);
      const list = byMonth.get(key) ?? [];
      list.push(row);
      byMonth.set(key, list);
    }

    const keys = [...byMonth.keys()].sort();
    this.monthlyReport = keys.map((monthKey) => {
      const monthRows = byMonth.get(monthKey)!;
      const startAmount = monthRows[0].amount;
      const endAmount = monthRows[monthRows.length - 1].amount;
      const change = endAmount - startAmount;
      const changePercent = startAmount !== 0 ? (change / startAmount) * 100 : 0;
      const periodPercents = monthRows
        .filter((r) => r.diffPreviousPercent !== 0 || r.daysSincePrevious !== null)
        .map((r) => r.diffPreviousPercent);
      const bestPercent = periodPercents.length ? Math.max(...periodPercents) : 0;
      const worstPercent = periodPercents.length ? Math.min(...periodPercents) : 0;
      const [year, month] = monthKey.split('-').map(Number);
      const labelDate = new Date(year, month - 1, 1);
      const monthLabel = labelDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

      return {
        monthKey,
        monthLabel,
        startAmount,
        endAmount,
        change,
        changePercent,
        snapshotCount: monthRows.length,
        bestPercent,
        worstPercent
      };
    }).reverse();
  }

  private buildYearlyReport() {
    if (this.rows.length === 0) {
      this.yearlyReport = [];
      return;
    }

    const byYear = new Map<string, AssetTrackerRow[]>();
    for (const row of this.rows) {
      const key = row.date.slice(0, 4);
      const list = byYear.get(key) ?? [];
      list.push(row);
      byYear.set(key, list);
    }

    const keys = [...byYear.keys()].sort();
    this.yearlyReport = keys.map((year) => {
      const yearRows = byYear.get(year)!;
      const startAmount = yearRows[0].amount;
      const endAmount = yearRows[yearRows.length - 1].amount;
      const change = endAmount - startAmount;
      const changePercent = startAmount !== 0 ? (change / startAmount) * 100 : 0;
      const periodPercents = yearRows
        .filter((r) => r.diffPreviousPercent !== 0 || r.daysSincePrevious !== null)
        .map((r) => r.diffPreviousPercent);
      return {
        year,
        startAmount,
        endAmount,
        change,
        changePercent,
        snapshotCount: yearRows.length,
        bestPercent: periodPercents.length ? Math.max(...periodPercents) : 0,
        worstPercent: periodPercents.length ? Math.min(...periodPercents) : 0
      };
    }).reverse();
  }

  private applySort() {
    const query = this.snapshotSearch.trim().toLowerCase();
    let rows = [...this.rows];
    if (query) {
      rows = rows.filter((row) =>
        row.dateLabel.toLowerCase().includes(query) ||
        row.date.includes(query) ||
        String(Math.round(row.amount)).includes(query)
      );
    }

    const column = this.tableSortBy;
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (column === 'date') {
        return (this.parseDateKey(a.date).getTime() - this.parseDateKey(b.date).getTime()) * direction;
      }
      const av = Number(a[column]) || 0;
      const bv = Number(b[column]) || 0;
      return (av - bv) * direction;
    });

    this.displayRows = rows;
    this.snapshotTotalPages = Math.max(1, Math.ceil(rows.length / this.snapshotPageSize));
    if (this.snapshotPage > this.snapshotTotalPages) {
      this.snapshotPage = this.snapshotTotalPages;
    }
    if (!rows.length) {
      this.snapshotTotalPages = 0;
      this.pagedDisplayRows = [];
      return;
    }
    const start = (this.snapshotPage - 1) * this.snapshotPageSize;
    this.pagedDisplayRows = rows.slice(start, start + this.snapshotPageSize);
  }

  private buildCharts() {
    const chronological = [...this.rows];
    const labels = chronological.map((row) => row.dateLabel);

    this.amountDiffChartData = {
      labels,
      datasets: [
        {
          label: 'Portfolio Value',
          data: chronological.map((row) => row.amount),
          borderColor: 'rgba(14, 165, 233, 1)',
          backgroundColor: 'rgba(14, 165, 233, 0.12)',
          tension: 0.3,
          fill: true,
          pointRadius: 3,
          yAxisID: 'y'
        },
        {
          label: 'Period Change',
          data: chronological.map((row) => row.diffPreviousDate),
          borderColor: 'rgba(30, 64, 175, 1)',
          backgroundColor: 'rgba(30, 64, 175, 0.08)',
          tension: 0.3,
          fill: false,
          pointRadius: 2,
          yAxisID: 'y1'
        }
      ]
    };

    const periodRows = chronological
      .filter((_, i) => i > 0)
      .filter((row) => !this.shouldIgnoreChartPercent(row.diffPreviousPercent));
    const periodPercents = periodRows.map((row) => row.diffPreviousPercent);
    const rollingWindow = 3;
    const rollingAvg = periodPercents.map((_, index) => {
      const start = Math.max(0, index - rollingWindow + 1);
      const slice = periodPercents.slice(start, index + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    this.periodChangeChartData = {
      labels: periodRows.map((row) => row.dateLabel),
      datasets: [
        {
          type: 'bar',
          label: 'Period % Change',
          data: periodPercents,
          backgroundColor: periodRows.map((row) =>
            row.diffPreviousPercent >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
          ),
          borderColor: periodRows.map((row) =>
            row.diffPreviousPercent >= 0 ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)'
          ),
          borderWidth: 1,
          order: 2
        } as any,
        {
          type: 'line',
          label: '3-period avg',
          data: rollingAvg,
          borderColor: 'rgba(30, 64, 175, 1)',
          backgroundColor: 'rgba(30, 64, 175, 0.1)',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          order: 1
        } as any
      ]
    };

    const growthRows = chronological.filter((row) => !this.shouldIgnoreChartPercent(row.percent));
    this.growthChartData = {
      labels: growthRows.map((row) => row.dateLabel),
      datasets: [{
        label: 'Growth vs Current (%)',
        data: growthRows.map((row) => row.percent),
        borderColor: 'rgba(118, 75, 162, 1)',
        backgroundColor: 'rgba(118, 75, 162, 0.12)',
        tension: 0.35,
        fill: true,
        pointRadius: 3
      }]
    };

    const firstAmount = chronological[0]?.amount ?? 0;
    const indexed = chronological.map((row) =>
      firstAmount > 0 ? (row.amount / firstAmount) * 100 : 100
    );
    this.cumulativeChartData = {
      labels,
      datasets: [
        {
          label: 'Wealth Index (base 100)',
          data: indexed,
          borderColor: 'rgba(16, 185, 129, 1)',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 3
        },
        {
          label: 'Baseline',
          data: labels.map(() => 100),
          borderColor: 'rgba(148, 163, 184, 0.9)',
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0
        }
      ]
    };
  }

  private shouldIgnoreChartPercent(value: number): boolean {
    if (this.filterIgnoreExtremePercent && value > this.extremePercentLimit) return true;
    if (this.filterIgnoreFloorPercent && value <= this.floorPercentLimit) return true;
    return false;
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private normalizeDateKey(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      return this.toDateKey(value);
    }

    const str = String(value).trim();
    const dateOnlyMatch = str.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnlyMatch) return dateOnlyMatch[1];

    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) return this.toDateKey(parsed);

    return '';
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateKey(dateKey: string): Date {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDateLabel(dateKey: string): string {
    const d = this.parseDateKey(dateKey);
    if (Number.isNaN(d.getTime())) return dateKey;
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleDateString('en-GB', { month: 'short' });
    return `${day}/${month}/${d.getFullYear()}`;
  }

  private monthsBetween(from: Date, to: Date): number {
    const years = to.getFullYear() - from.getFullYear();
    const months = to.getMonth() - from.getMonth();
    return Math.max(0, years * 12 + months);
  }

  private daysBetween(from: Date, to: Date): number {
    const ms = to.getTime() - from.getTime();
    return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
  }

  isNegative(value: number): boolean {
    return value < 0;
  }

  isPositive(value: number): boolean {
    return value > 0;
  }

  getIndianBreakdown(value: number): IndianAmountBreakdown {
    return getIndianAmountBreakdown(value);
  }

  formatSignedAmount(value: number): string {
    const amount = Number(value) || 0;
    if (Math.abs(amount) < 0.005) return getIndianAmountBreakdown(0).primaryDisplay;
    const sign = amount > 0 ? '+' : '';
    return `${sign}${getIndianAmountBreakdown(amount).primaryDisplay}`;
  }

  formatFullInr(value: number): string {
    const amount = Number(value) || 0;
    const sign = amount < 0 ? '-' : '';
    return `${sign}₹${formatIndianFull(amount)}`;
  }

  private computeGoalEta(): string {
    if (!this.goalAmount || this.currentAmount <= 0) return '';
    if (this.currentAmount >= this.goalAmount) return 'Goal reached';
    const cagr = this.stats?.cagr;
    if (cagr !== null && cagr !== undefined && cagr > 0.1) {
      const years = Math.log(this.goalAmount / this.currentAmount) / Math.log(1 + cagr / 100);
      if (Number.isFinite(years) && years > 0 && years < 80) {
        const eta = new Date();
        eta.setMonth(eta.getMonth() + Math.round(years * 12));
        return `At current CAGR, around ${eta.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
      }
    }
    const avgChange = this.stats?.avgPeriodChange ?? 0;
    const avgGap = this.stats?.avgGapDays ?? 0;
    if (avgChange > 0 && avgGap > 0) {
      const periods = (this.goalAmount - this.currentAmount) / avgChange;
      const days = Math.round(periods * avgGap);
      if (days > 0 && days < 365 * 40) {
        const eta = new Date();
        eta.setDate(eta.getDate() + days);
        return `At recent pace, around ${eta.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
      }
    }
    return 'Need sustained positive growth to estimate a date';
  }

  suggestedGoals(): number[] {
    if (this.currentAmount <= 0) return [1_00_000, 10_00_000, 1_00_00_000];
    const nextLakh = Math.ceil((this.currentAmount + 1) / 1_00_000) * 1_00_000;
    const next5L = Math.ceil((this.currentAmount + 1) / 5_00_000) * 5_00_000;
    const nextCr = Math.ceil((this.currentAmount + 1) / 1_00_00_000) * 1_00_00_000;
    return [...new Set([nextLakh, next5L, nextCr].filter((v) => v > this.currentAmount))].slice(0, 3);
  }

  applySuggestedGoal(amount: number) {
    this.goalInput = amount;
    this.saveGoal();
  }

  get activeFilterChips(): FilterChip[] {
    const chips: FilterChip[] = [];
    if (this.filterFrom) chips.push({ id: 'from', label: `From ${this.filterFrom}` });
    if (this.filterTo) chips.push({ id: 'to', label: `To ${this.filterTo}` });
    if (this.filterTypes.length) chips.push({ id: 'types', label: `Types: ${this.filterTypes.join(', ')}` });
    if (this.filterSubTypes.length) chips.push({ id: 'subTypes', label: `Sub types: ${this.filterSubTypes.join(', ')}` });
    if (this.filterCategories.length) chips.push({ id: 'categories', label: `Categories: ${this.filterCategories.join(', ')}` });
    if (this.filterPlatforms.length) chips.push({ id: 'platforms', label: `Platforms: ${this.filterPlatforms.join(', ')}` });
    if (this.filterMinAmount != null && !Number.isNaN(this.filterMinAmount)) {
      chips.push({ id: 'min', label: `Min ₹${this.filterMinAmount}` });
    }
    if (this.filterMaxAmount != null && !Number.isNaN(this.filterMaxAmount)) {
      chips.push({ id: 'max', label: `Max ₹${this.filterMaxAmount}` });
    }
    if (this.filterIgnoreZero) chips.push({ id: 'zero', label: 'Ignore 0 value' });
    return chips;
  }

  removeFilterChip(id: string) {
    if (id === 'from') this.filterFrom = '';
    if (id === 'to') this.filterTo = '';
    if (id === 'types') this.filterTypes = [];
    if (id === 'subTypes') this.filterSubTypes = [];
    if (id === 'categories') this.filterCategories = [];
    if (id === 'platforms') this.filterPlatforms = [];
    if (id === 'min') this.filterMinAmount = null;
    if (id === 'max') this.filterMaxAmount = null;
    if (id === 'zero') this.filterIgnoreZero = false;
    this.activeRangePreset = null;
    this.applyingFilters = true;
    this.loadData();
  }

  private syncCompareDates() {
    if (!this.rows.length) {
      this.compareFrom = '';
      this.compareTo = '';
      return;
    }
    const keys = this.rows.map((r) => r.date);
    if (!keys.includes(this.compareFrom)) this.compareFrom = keys[0];
    if (!keys.includes(this.compareTo)) this.compareTo = keys[keys.length - 1];
  }

  get snapshotCompare(): SnapshotCompare | null {
    if (!this.compareFrom || !this.compareTo) return null;
    const fromRow = this.rows.find((r) => r.date === this.compareFrom);
    const toRow = this.rows.find((r) => r.date === this.compareTo);
    if (!fromRow || !toRow) return null;
    const [start, end] = fromRow.date <= toRow.date ? [fromRow, toRow] : [toRow, fromRow];
    const change = end.amount - start.amount;
    const changePercent = start.amount !== 0 ? (change / start.amount) * 100 : 0;
    const days = this.daysBetween(this.parseDateKey(start.date), this.parseDateKey(end.date));
    let annualizedPercent: number | null = null;
    if (start.amount > 0 && days >= 30) {
      const years = days / 365;
      annualizedPercent = (Math.pow(end.amount / start.amount, 1 / years) - 1) * 100;
    }
    return {
      fromDate: start.date,
      toDate: end.date,
      fromLabel: start.dateLabel,
      toLabel: end.dateLabel,
      fromAmount: start.amount,
      toAmount: end.amount,
      change,
      changePercent,
      days,
      annualizedPercent
    };
  }

  isPeakRow(row: AssetTrackerRow): boolean {
    return !!this.stats && row.amount === this.stats.highestAmount;
  }

  isTroughRow(row: AssetTrackerRow): boolean {
    return !!this.stats && row.amount === this.stats.lowestAmount;
  }

  get bestMonthKey(): string {
    if (!this.monthlyReport.length) return '';
    return this.monthlyReport.reduce((best, row) =>
      row.changePercent > best.changePercent ? row : best
    ).monthKey;
  }

  get worstMonthKey(): string {
    if (!this.monthlyReport.length) return '';
    return this.monthlyReport.reduce((worst, row) =>
      row.changePercent < worst.changePercent ? row : worst
    ).monthKey;
  }

  get snapshotRangeLabel(): string {
    if (!this.displayRows.length) return 'No snapshots';
    const start = (this.snapshotPage - 1) * this.snapshotPageSize + 1;
    const end = Math.min(this.snapshotPage * this.snapshotPageSize, this.displayRows.length);
    return `${start}–${end} of ${this.displayRows.length}`;
  }

  isStale(): boolean {
    return (this.stats?.daysSinceLastSnapshot ?? 0) > 14;
  }

  scrollToSection(id: string) {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  copySummary() {
    if (!this.stats) return;
    const lines = [
      `Asset Tracker summary (${this.toDateKey(new Date())})`,
      `Current: ${this.formatFullInr(this.currentAmount)}`,
      `Growth: ${this.formatSignedAmount(this.stats.totalGrowth)} (${this.stats.totalGrowthPercent.toFixed(2)}%)`,
      this.stats.cagr !== null ? `CAGR: ${this.stats.cagr.toFixed(2)}%` : '',
      `Peak: ${this.formatFullInr(this.stats.highestAmount)} on ${this.stats.highestDateLabel}`,
      `Low: ${this.formatFullInr(this.stats.lowestAmount)} on ${this.stats.lowestDateLabel}`,
      `Snapshots: ${this.stats.snapshotCount} · win ${this.stats.winRate.toFixed(0)}%`,
      this.goalAmount ? `Goal: ${this.formatFullInr(this.goalAmount)} (${this.goalProgressPercent.toFixed(1)}%)` : '',
      '',
      ...this.stats.insights
    ].filter(Boolean);
    const text = lines.join('\n');
    const done = () => {
      this.copyMessage = 'Summary copied';
      setTimeout(() => {
        if (this.copyMessage === 'Summary copied') this.copyMessage = '';
      }, 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done));
    } else {
      this.fallbackCopy(text, done);
    }
  }

  private fallbackCopy(text: string, done: () => void) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch { /* ignore */ }
    document.body.removeChild(area);
  }
}
