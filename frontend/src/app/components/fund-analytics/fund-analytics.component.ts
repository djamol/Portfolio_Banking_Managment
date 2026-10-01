import { Component, OnInit } from '@angular/core';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import {
  FundAnalytics,
  FundAnalyticsService,
  FundHolding,
  FundPeriod
} from '../../services/fund-analytics.service';

type TabId = 'overview' | 'holdings' | 'periods' | 'heatmap' | 'leaders' | 'charts';
type AllocationDimension = 'by_type' | 'by_platform' | 'by_category';
type SortDirection = 'asc' | 'desc';

const SERIES_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#22c55e', '#a855f7', '#64748b'
];

const POSITIVE = '#059669';
const NEGATIVE = '#dc2626';

@Component({
  selector: 'app-fund-analytics',
  templateUrl: './fund-analytics.component.html',
  styleUrls: ['./fund-analytics.component.css'],
  standalone: false
})
export class FundAnalyticsComponent implements OnInit {
  loading = false;
  error = '';
  data: FundAnalytics | null = null;

  activeTab: TabId = 'overview';
  readonly tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'holdings', label: 'Holdings' },
    { id: 'periods', label: 'Period returns' },
    { id: 'heatmap', label: 'Fund heatmap' },
    { id: 'leaders', label: 'Best & worst' },
    { id: 'charts', label: 'Charts' }
  ];

  readonly periods: { id: FundPeriod; label: string }[] = [
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'quarterly', label: 'Quarterly' },
    { id: 'half-yearly', label: 'Half-yearly' },
    { id: 'yearly', label: 'Yearly' }
  ];

  readonly quickRanges = [
    { id: '1m', label: '1M' },
    { id: '3m', label: '3M' },
    { id: '6m', label: '6M' },
    { id: 'ytd', label: 'YTD' },
    { id: 'fy', label: 'FY' },
    { id: '1y', label: '1Y' },
    { id: '3y', label: '3Y' },
    { id: 'all', label: 'All' }
  ];
  activeRange = '1y';

  from = '';
  to = '';
  period: FundPeriod = 'monthly';
  topN = 10;
  selectedTypes: string[] = [];
  selectedPlatforms: string[] = [];
  selectedCategories: string[] = [];
  search = '';

  sortKey = 'range_return_pct';
  sortDirection: SortDirection = 'desc';

  allocationDimension: AllocationDimension = 'by_type';
  compareLimit = 8;

  valueChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  indexChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  drawdownChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  periodChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  leadersChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  allocationChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  compareChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  breadthChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };

  readonly currencyLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => `₹${Number(ctx.parsed.y).toLocaleString('en-IN')}` } }
    },
    scales: { y: { ticks: { callback: (value) => '₹' + Number(value).toLocaleString('en-IN') } } }
  };

  readonly percentLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)}%` } }
    },
    scales: { y: { ticks: { callback: (value) => `${Number(value).toFixed(1)}%` } } }
  };

  readonly percentBarOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => `${Number(ctx.parsed.y).toFixed(2)}%` } }
    },
    scales: { y: { ticks: { callback: (value) => `${Number(value).toFixed(1)}%` } } }
  };

  readonly horizontalPercentOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => `${Number(ctx.parsed.x).toFixed(2)}%` } }
    },
    scales: { x: { ticks: { callback: (value) => `${Number(value).toFixed(1)}%` } } }
  };

  readonly stackedBarOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'top' } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }
  };

  readonly doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ₹${Number(ctx.parsed).toLocaleString('en-IN')}` } }
    }
  };

  constructor(private fundAnalyticsService: FundAnalyticsService) {}

  ngOnInit(): void {
    this.applyQuickRange('1y', false);
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.fundAnalyticsService
      .load({
        from: this.from || undefined,
        to: this.to || undefined,
        period: this.period,
        topN: this.topN,
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
          this.error = err?.error?.error || err?.message || 'Failed to load fund analytics';
          this.loading = false;
        }
      });
  }

  applyQuickRange(rangeId: string, reload = true): void {
    this.activeRange = rangeId;
    const today = new Date();
    const to = this.toIso(today);
    const start = new Date(today.getTime());

    switch (rangeId) {
      case '1m': start.setMonth(start.getMonth() - 1); break;
      case '3m': start.setMonth(start.getMonth() - 3); break;
      case '6m': start.setMonth(start.getMonth() - 6); break;
      case '1y': start.setFullYear(start.getFullYear() - 1); break;
      case '3y': start.setFullYear(start.getFullYear() - 3); break;
      case 'ytd': start.setMonth(0, 1); break;
      case 'fy':
        start.setFullYear(today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1, 3, 1);
        break;
      default:
        this.from = '';
        this.to = '';
        if (reload) this.load();
        return;
    }

    this.from = this.toIso(start);
    this.to = to;
    if (reload) this.load();
  }

  onPeriodChange(period: FundPeriod): void {
    this.period = period;
    this.load();
  }

  onManualDateChange(): void {
    this.activeRange = 'custom';
    this.load();
  }

  resetFilters(): void {
    this.selectedTypes = [];
    this.selectedPlatforms = [];
    this.selectedCategories = [];
    this.search = '';
    this.applyQuickRange('1y');
  }

  get filteredHoldings(): FundHolding[] {
    const rows = this.data?.holdings || [];
    const term = this.search.trim().toLowerCase();
    const matched = term
      ? rows.filter((row) =>
          [row.name, row.platform, row.category, row.scheme_code, row.investment_type]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(term)))
      : [...rows];

    const key = this.sortKey;
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    return matched.sort((a, b) => {
      const left = this.sortValue(a, key);
      const right = this.sortValue(b, key);
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction;
      }
      if (left === null) return 1;
      if (right === null) return -1;
      return (left - right) * direction;
    });
  }

  get allocationRows() {
    return this.data?.allocation[this.allocationDimension] || [];
  }

  sortBy(key: string): void {
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDirection = key === 'name' ? 'asc' : 'desc';
    }
  }

  sortIndicator(key: string): string {
    if (this.sortKey !== key) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  setAllocationDimension(dimension: AllocationDimension): void {
    this.allocationDimension = dimension;
    this.buildAllocationChart();
  }

  exportHoldingsCsv(): void {
    const rows = this.filteredHoldings;
    if (!rows.length) return;
    const header = [
      'Name', 'Type', 'Platform', 'Category', 'Scheme code', 'Units', 'NAV', 'NAV date',
      'Invested', 'Current value', 'Gain', 'Gain %', 'Range return %', '1D', '1W', '1M',
      '3M', '6M', '1Y', 'YTD', 'CAGR %', 'Volatility %', 'Max drawdown %'
    ];
    const lines = rows.map((row) => [
      row.name, row.investment_type, row.platform, row.category, row.scheme_code,
      row.units, row.nav, row.nav_date, row.invested_amount, row.current_value, row.gain,
      row.gain_pct, row.range_return_pct, row.trailing?.d1, row.trailing?.w1, row.trailing?.m1,
      row.trailing?.m3, row.trailing?.m6, row.trailing?.y1, row.trailing?.ytd,
      row.cagr_pct, row.volatility_pct, row.max_drawdown_pct
    ]);
    const csv = [header, ...lines]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `mf-etf-analytics-${this.period}-${this.to || 'latest'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  formatCurrency(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  formatPercent(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const num = Number(value);
    return `${num > 0 ? '+' : ''}${num.toFixed(digits)}%`;
  }

  formatNumber(value: number | null | undefined, digits = 4): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits });
  }

  formatDate(value: string | null | undefined): string {
    return value ? value : '—';
  }

  trendClass(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'flat';
    if (Number(value) > 0) return 'up';
    if (Number(value) < 0) return 'down';
    return 'flat';
  }

  /** Background tint for the fund x period heatmap. */
  heatStyle(value: number | null | undefined): { [key: string]: string } {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return { background: 'transparent', color: 'var(--app-muted)' };
    }
    const num = Number(value);
    const intensity = Math.min(Math.abs(num) / 10, 1);
    const alpha = 0.08 + intensity * 0.52;
    const rgb = num >= 0 ? '5, 150, 105' : '220, 38, 38';
    return {
      background: `rgba(${rgb}, ${alpha.toFixed(2)})`,
      color: intensity > 0.6 ? '#ffffff' : 'var(--app-ink)'
    };
  }

  private sortValue(row: FundHolding, key: string): number | string | null {
    if (key.startsWith('trailing.')) {
      const field = key.split('.')[1] as keyof FundHolding['trailing'];
      const value = row.trailing?.[field];
      return value === undefined ? null : value;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number' || typeof value === 'string') return value;
    return null;
  }

  private toIso(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  private buildCharts(): void {
    const data = this.data;
    if (!data) return;

    const labels = data.portfolio_series.map((point) => point.date);

    this.valueChartData = {
      labels,
      datasets: [{
        label: 'Portfolio value',
        data: data.portfolio_series.map((point) => point.value),
        borderColor: SERIES_COLORS[0],
        backgroundColor: 'rgba(59, 130, 246, 0.14)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    };

    this.indexChartData = {
      labels,
      datasets: [{
        label: 'Indexed NAV performance (base 100)',
        data: data.portfolio_series.map((point) => point.index),
        borderColor: SERIES_COLORS[1],
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    };

    this.drawdownChartData = {
      labels,
      datasets: [{
        label: 'Drawdown',
        data: data.portfolio_series.map((point) => point.drawdown_pct),
        borderColor: NEGATIVE,
        backgroundColor: 'rgba(220, 38, 38, 0.16)',
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2
      }]
    };

    this.periodChartData = {
      labels: data.period_rows.map((row) => row.label),
      datasets: [{
        label: 'Return %',
        data: data.period_rows.map((row) => row.change_pct ?? 0),
        backgroundColor: data.period_rows.map((row) => ((row.change_pct ?? 0) >= 0 ? POSITIVE : NEGATIVE)),
        borderRadius: 4
      }]
    };

    this.breadthChartData = {
      labels: data.period_rows.map((row) => row.label),
      datasets: [
        { label: 'Advancers', data: data.period_rows.map((row) => row.advancers), backgroundColor: POSITIVE },
        { label: 'Decliners', data: data.period_rows.map((row) => row.decliners), backgroundColor: NEGATIVE }
      ]
    };

    const leaders = [...data.leaders.best, ...data.leaders.worst]
      .filter((holding, index, list) => list.findIndex((item) => item.id === holding.id) === index)
      .sort((a, b) => (b.range_return_pct ?? 0) - (a.range_return_pct ?? 0));
    this.leadersChartData = {
      labels: leaders.map((holding) => holding.name),
      datasets: [{
        label: 'Range return %',
        data: leaders.map((holding) => holding.range_return_pct ?? 0),
        backgroundColor: leaders.map((holding) => ((holding.range_return_pct ?? 0) >= 0 ? POSITIVE : NEGATIVE)),
        borderRadius: 4
      }]
    };

    const matrix = data.fund_period_matrix;
    const topFunds = [...matrix.funds]
      .sort((a, b) => this.lastReturn(b) - this.lastReturn(a))
      .slice(0, this.compareLimit);
    this.compareChartData = {
      labels: matrix.periods.map((bucket) => bucket.label),
      datasets: topFunds.map((fund, index) => ({
        label: fund.name,
        data: matrix.periods.map((bucket) => fund.returns[bucket.key] ?? null),
        borderColor: SERIES_COLORS[index % SERIES_COLORS.length],
        backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
        tension: 0.3,
        pointRadius: 2,
        borderWidth: 2,
        spanGaps: true
      }))
    };

    this.buildAllocationChart();
  }

  private lastReturn(fund: { returns: Record<string, number | null> }): number {
    const values = Object.values(fund.returns).filter((value): value is number => value !== null);
    return values.length ? values[values.length - 1] : -Infinity;
  }

  private buildAllocationChart(): void {
    const rows = this.data?.allocation[this.allocationDimension] || [];
    this.allocationChartData = {
      labels: rows.map((row) => row.key),
      datasets: [{
        data: rows.map((row) => row.value),
        backgroundColor: rows.map((_, index) => SERIES_COLORS[index % SERIES_COLORS.length]),
        borderWidth: 0
      }]
    };
  }
}
