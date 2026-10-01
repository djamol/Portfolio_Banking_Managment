import { Component, OnInit } from '@angular/core';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import {
  FdAllocationRow,
  FdAnalytics,
  FdAnalyticsService,
  FdDeposit,
  FdLadderBucket
} from '../../services/fd-analytics.service';

type TabId = 'overview' | 'deposits' | 'ladder' | 'income' | 'allocation';
type LadderBasis = 'by_month' | 'by_year' | 'by_financial_year';
type AllocationDimension = 'by_platform' | 'by_type' | 'by_category' | 'by_rate_band' | 'by_tenure_band' | 'by_payout';
type SortDirection = 'asc' | 'desc';

const PREFS_KEY = 'fdAnalytics.prefs';

const SERIES_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#22c55e', '#a855f7', '#64748b'
];

@Component({
  selector: 'app-fd-analytics',
  templateUrl: './fd-analytics.component.html',
  styleUrls: ['./fd-analytics.component.css'],
  standalone: false
})
export class FdAnalyticsComponent implements OnInit {
  loading = false;
  error = '';
  data: FdAnalytics | null = null;

  activeTab: TabId = 'overview';
  readonly tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'deposits', label: 'Deposits' },
    { id: 'ladder', label: 'Maturity ladder' },
    { id: 'income', label: 'Income & payouts' },
    { id: 'allocation', label: 'Allocation' }
  ];

  asOf = '';
  taxRatePct = 0;
  horizonMonths = 24;
  selectedTypes: string[] = [];
  selectedPlatforms: string[] = [];
  selectedCategories: string[] = [];
  search = '';
  hideMatured = false;

  sortKey = 'maturity_date';
  sortDirection: SortDirection = 'asc';
  expandedId: number | null = null;

  ladderBasis: LadderBasis = 'by_month';
  allocationDimension: AllocationDimension = 'by_platform';

  ladderChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  cashflowChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  projectionChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  allocationChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  rateChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  interestSplitData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };

  readonly currencyBarOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ₹${Number(ctx.parsed.y).toLocaleString('en-IN')}` } }
    },
    scales: {
      x: { stacked: true },
      y: { stacked: true, ticks: { callback: (value) => '₹' + Number(value).toLocaleString('en-IN') } }
    }
  };

  readonly currencyLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ₹${Number(ctx.parsed.y).toLocaleString('en-IN')}` } }
    },
    scales: {
      y: { stacked: true, ticks: { callback: (value) => '₹' + Number(value).toLocaleString('en-IN') } }
    }
  };

  readonly rateBarOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => `${Number(ctx.parsed.x).toFixed(2)}%` } }
    },
    scales: { x: { ticks: { callback: (value) => `${Number(value).toFixed(1)}%` } } }
  };

  readonly doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ₹${Number(ctx.parsed).toLocaleString('en-IN')}` } }
    }
  };

  constructor(private fdAnalyticsService: FdAnalyticsService) {}

  ngOnInit(): void {
    this.restorePreferences();
    this.load();
  }

  load(refresh = false): void {
    this.loading = true;
    this.error = '';
    this.savePreferences();
    this.fdAnalyticsService
      .load({
        asOf: this.asOf || undefined,
        taxRatePct: this.taxRatePct,
        horizonMonths: this.horizonMonths,
        refresh,
        types: this.selectedTypes,
        platforms: this.selectedPlatforms,
        categories: this.selectedCategories
      })
      .subscribe({
        next: (data) => {
          this.data = data;
          this.buildCharts();
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.error || err?.message || 'Failed to load deposit analytics';
          this.loading = false;
        }
      });
  }

  resetFilters(): void {
    this.selectedTypes = [];
    this.selectedPlatforms = [];
    this.selectedCategories = [];
    this.asOf = '';
    this.taxRatePct = 0;
    this.horizonMonths = 24;
    this.search = '';
    this.hideMatured = false;
    this.load();
  }

  get filteredDeposits(): FdDeposit[] {
    const rows = this.data?.deposits || [];
    const term = this.search.trim().toLowerCase();
    let matched = term
      ? rows.filter((row) =>
          [row.name, row.platform, row.category, row.investment_type, row.payout_frequency]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(term)))
      : [...rows];
    if (this.hideMatured) {
      matched = matched.filter((row) => !row.matured && !row.is_closed && (row.current_value ?? 0) > 0);
    }

    const key = this.sortKey;
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    return matched.sort((a, b) => {
      const left = (a as unknown as Record<string, unknown>)[key];
      const right = (b as unknown as Record<string, unknown>)[key];
      const leftEmpty = left === null || left === undefined || left === '';
      const rightEmpty = right === null || right === undefined || right === '';
      if (leftEmpty && rightEmpty) return 0;
      if (leftEmpty) return 1;
      if (rightEmpty) return -1;
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction;
      }
      return (Number(left) - Number(right)) * direction;
    });
  }

  get upcomingMaturities(): FdDeposit[] {
    const rows = this.data?.deposits || [];
    const term = this.search.trim().toLowerCase();
    const asOf = this.data?.as_of || new Date().toISOString().slice(0, 10);
    let matched = rows.filter(
      (row) => !row.is_closed && (row.current_value ?? 0) > 0 && row.maturity_date && row.maturity_date >= asOf
    );
    if (term) {
      matched = matched.filter((row) =>
        [row.name, row.platform, row.category, row.investment_type]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(term))
      );
    }
    return matched.sort((a, b) => (a.maturity_date || '').localeCompare(b.maturity_date || ''));
  }

  get ladderBuckets(): FdLadderBucket[] {
    return this.data?.ladder[this.ladderBasis] || [];
  }

  get allocationRows(): FdAllocationRow[] {
    return this.data?.allocation[this.allocationDimension] || [];
  }

  setLadderBasis(basis: LadderBasis): void {
    this.ladderBasis = basis;
    this.buildLadderChart();
  }

  setAllocationDimension(dimension: AllocationDimension): void {
    this.allocationDimension = dimension;
    this.buildAllocationCharts();
  }

  toggleExpanded(deposit: FdDeposit): void {
    this.expandedId = this.expandedId === deposit.id ? null : deposit.id;
  }

  sortBy(key: string): void {
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDirection = ['name', 'platform', 'maturity_date', 'investment_date'].includes(key) ? 'asc' : 'desc';
    }
  }

  sortIndicator(key: string): string {
    if (this.sortKey !== key) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  exportDepositsCsv(): void {
    const rows = this.filteredDeposits;
    if (!rows.length) return;
    const header = [
      'Name', 'Type', 'Platform', 'Category', 'Start', 'Maturity', 'Tenure (months)', 'Rate %',
      'Post-tax rate %', 'Payout', 'Compounding', 'Principal', 'Current value', 'Maturity amount',
      'Total interest', 'Accrued', 'Received', 'Pending', 'Periodic payout', 'Annual income',
      'Days to maturity', 'Progress %', 'Matured'
    ];
    const lines = rows.map((row) => [
      row.name, row.investment_type, row.platform, row.category, row.investment_date, row.maturity_date,
      row.tenure_months, row.interest_rate, row.post_tax_rate_pct, row.payout_frequency, row.compounding,
      row.principal, row.current_value, row.maturity_amount, row.total_interest, row.accrued_interest,
      row.received_interest, row.pending_interest, row.periodic_payout, row.annual_income,
      row.days_to_maturity, row.progress_pct, row.matured ? 'yes' : 'no'
    ]);
    this.downloadCsv([header, ...lines], `deposits-${this.data?.as_of || 'latest'}.csv`);
  }

  exportLadderCsv(): void {
    const rows = this.ladderBuckets;
    if (!rows.length) return;
    const header = ['Bucket', 'Deposits', 'Principal', 'Maturity amount', 'Interest'];
    const lines = rows.map((row) => [row.label, row.count, row.principal, row.maturity_amount, row.interest]);
    this.downloadCsv([header, ...lines], `maturity-ladder-${this.ladderBasis}.csv`);
  }

  formatCurrency(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  formatPercent(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `${Number(value).toFixed(digits)}%`;
  }

  formatNumber(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits });
  }

  formatDate(value: string | null | undefined): string {
    return value || '—';
  }

  /** Human countdown for a maturity date. */
  maturityLabel(deposit: FdDeposit): string {
    if (deposit.is_closed || (deposit.current_value ?? 0) <= 0) return 'Closed';
    if (!deposit.maturity_date) return 'No maturity set';
    const days = deposit.days_to_maturity;
    if (days === null) return deposit.maturity_date;
    if (days < 0) return `Matured ${Math.abs(days)}d ago`;
    if (days === 0) return 'Matures today';
    if (days < 60) return `in ${days}d`;
    return `in ${Math.round(days / 30.44)} months`;
  }

  maturityClass(deposit: FdDeposit): string {
    if (deposit.is_closed || (deposit.current_value ?? 0) <= 0) return 'muted';
    if (!deposit.maturity_date) return 'flat';
    if (deposit.matured) return 'down';
    if ((deposit.days_to_maturity ?? 999) <= 30) return 'warn';
    return 'flat';
  }

  private downloadCsv(rows: unknown[][], filename: string): void {
    const csv = rows
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private savePreferences(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        asOf: this.asOf,
        taxRatePct: this.taxRatePct,
        horizonMonths: this.horizonMonths,
        types: this.selectedTypes,
        platforms: this.selectedPlatforms,
        categories: this.selectedCategories,
        activeTab: this.activeTab,
        ladderBasis: this.ladderBasis,
        allocationDimension: this.allocationDimension
      }));
    } catch {
      // storage unavailable — filters simply do not persist
    }
  }

  private restorePreferences(): void {
    let prefs: Record<string, unknown> | null = null;
    try {
      prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    } catch {
      prefs = null;
    }
    if (!prefs) return;
    this.asOf = (prefs['asOf'] as string) || '';
    this.taxRatePct = (prefs['taxRatePct'] as number) ?? 0;
    this.horizonMonths = (prefs['horizonMonths'] as number) || 24;
    this.selectedTypes = (prefs['types'] as string[]) || [];
    this.selectedPlatforms = (prefs['platforms'] as string[]) || [];
    this.selectedCategories = (prefs['categories'] as string[]) || [];
    this.activeTab = (prefs['activeTab'] as TabId) || 'overview';
    this.ladderBasis = (prefs['ladderBasis'] as LadderBasis) || 'by_month';
    this.allocationDimension = (prefs['allocationDimension'] as AllocationDimension) || 'by_platform';
  }

  private buildCharts(): void {
    const data = this.data;
    if (!data) return;

    this.cashflowChartData = {
      labels: data.cashflow_calendar.map((month) => month.label),
      datasets: [
        {
          label: 'Interest payouts',
          data: data.cashflow_calendar.map((month) => month.interest),
          backgroundColor: '#10b981',
          borderRadius: 4
        },
        {
          label: 'Maturity proceeds',
          data: data.cashflow_calendar.map((month) => month.maturity),
          backgroundColor: '#3b82f6',
          borderRadius: 4
        }
      ]
    };

    this.projectionChartData = {
      labels: data.value_projection.map((point) => point.label),
      datasets: [
        {
          label: 'Locked in deposits',
          data: data.value_projection.map((point) => point.locked),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.25)',
          fill: 'origin',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Released at maturity',
          data: data.value_projection.map((point) => point.released),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.25)',
          fill: '-1',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    };

    const rated = [...data.allocation.by_platform]
      .filter((row) => row.avg_rate_pct !== null)
      .sort((a, b) => (b.avg_rate_pct ?? 0) - (a.avg_rate_pct ?? 0));
    this.rateChartData = {
      labels: rated.map((row) => row.key),
      datasets: [{
        label: 'Average rate',
        data: rated.map((row) => row.avg_rate_pct ?? 0),
        backgroundColor: rated.map((_, index) => SERIES_COLORS[index % SERIES_COLORS.length]),
        borderRadius: 4
      }]
    };

    this.interestSplitData = {
      labels: ['Accrued (unrealised)', 'Received (paid out)', 'Pending'],
      datasets: [{
        data: [
          data.summary.accrued_interest,
          data.summary.received_interest,
          data.summary.pending_interest
        ],
        backgroundColor: ['#10b981', '#3b82f6', '#cbd5e1'],
        borderWidth: 0
      }]
    };

    this.buildLadderChart();
    this.buildAllocationCharts();
  }

  private buildLadderChart(): void {
    const buckets = this.ladderBuckets;
    this.ladderChartData = {
      labels: buckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Principal',
          data: buckets.map((bucket) => bucket.principal),
          backgroundColor: '#3b82f6',
          borderRadius: 4
        },
        {
          label: 'Interest',
          data: buckets.map((bucket) => bucket.interest),
          backgroundColor: '#10b981',
          borderRadius: 4
        }
      ]
    };
  }

  private buildAllocationCharts(): void {
    const rows = this.allocationRows;
    this.allocationChartData = {
      labels: rows.map((row) => row.key),
      datasets: [{
        data: rows.map((row) => row.current_value),
        backgroundColor: rows.map((_, index) => SERIES_COLORS[index % SERIES_COLORS.length]),
        borderWidth: 0
      }]
    };
  }
}
