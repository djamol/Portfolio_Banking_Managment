import { Component, OnInit } from '@angular/core';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import {
  FundAllocationRow,
  FundAnalytics,
  FundAnalyticsService,
  FundHolding,
  FundPeriod
} from '../../services/fund-analytics.service';

type TabId = 'overview' | 'holdings' | 'periods' | 'heatmap' | 'leaders' | 'risk' | 'calendar' | 'charts';
type AllocationDimension = 'by_type' | 'by_platform' | 'by_category';
type CalendarBasis = 'calendar_returns' | 'financial_year_returns';
type SortDirection = 'asc' | 'desc';

interface StoredPreferences {
  period?: FundPeriod;
  activeRange?: string;
  from?: string;
  to?: string;
  types?: string[];
  platforms?: string[];
  categories?: string[];
  topN?: number;
  riskFreePct?: number;
  benchmarkId?: number | null;
  activeTab?: TabId;
}

const PREFS_KEY = 'fundAnalytics.prefs';

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
    { id: 'risk', label: 'Risk' },
    { id: 'calendar', label: 'Calendar' },
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
  riskFreePct = 6;
  benchmarkId: number | null = null;
  selectedTypes: string[] = [];
  selectedPlatforms: string[] = [];
  selectedCategories: string[] = [];
  search = '';
  onlyWithHistory = false;

  sortKey = 'range_return_pct';
  sortDirection: SortDirection = 'desc';
  expandedId: number | null = null;

  allocationDimension: AllocationDimension = 'by_type';
  calendarBasis: CalendarBasis = 'calendar_returns';
  compareLimit = 8;

  valueChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  indexChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  drawdownChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  rollingChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  periodChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  leadersChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  moversChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  allocationChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  compareChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  breadthChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  riskScatterData: ChartConfiguration<'scatter'>['data'] = { datasets: [] };

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

  readonly indexLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)}` } }
    }
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

  readonly scatterOptions: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const raw = ctx.raw as { label?: string; x: number; y: number };
            return `${raw.label}: risk ${raw.x.toFixed(1)}% · return ${raw.y.toFixed(1)}%`;
          }
        }
      }
    },
    scales: {
      x: {
        title: { display: true, text: 'Volatility (annualised %)' },
        ticks: { callback: (value) => `${Number(value).toFixed(0)}%` }
      },
      y: {
        title: { display: true, text: 'Return over range (%)' },
        ticks: { callback: (value) => `${Number(value).toFixed(0)}%` }
      }
    }
  };

  constructor(private fundAnalyticsService: FundAnalyticsService) {}

  ngOnInit(): void {
    if (!this.restorePreferences()) this.applyQuickRange('1y', false);
    this.load();
  }

  load(refresh = false): void {
    this.loading = true;
    this.error = '';
    this.savePreferences();
    this.fundAnalyticsService
      .load({
        from: this.from || undefined,
        to: this.to || undefined,
        period: this.period,
        topN: this.topN,
        riskFreePct: this.riskFreePct,
        benchmarkId: this.benchmarkId,
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
          this.error = err?.error?.error || err?.message || 'Failed to load fund analytics';
          this.loading = false;
        }
      });
  }

  applyQuickRange(rangeId: string, reload = true): void {
    this.activeRange = rangeId;
    const today = new Date();
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
    this.to = this.toIso(today);
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
    this.benchmarkId = null;
    this.riskFreePct = 6;
    this.topN = 10;
    this.search = '';
    this.onlyWithHistory = false;
    this.applyQuickRange('1y');
  }

  get filteredHoldings(): FundHolding[] {
    const rows = this.data?.holdings || [];
    const term = this.search.trim().toLowerCase();
    let matched = term
      ? rows.filter((row) =>
          [row.name, row.platform, row.category, row.scheme_code, row.investment_type]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(term)))
      : [...rows];
    if (this.onlyWithHistory) matched = matched.filter((row) => row.has_history);

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

  get allocationRows(): FundAllocationRow[] {
    return this.data?.allocation[this.allocationDimension] || [];
  }

  /** Union of calendar/FY buckets across funds, newest last. */
  get calendarColumns(): string[] {
    const keys = new Set<string>();
    for (const holding of this.data?.holdings || []) {
      for (const row of holding[this.calendarBasis] || []) keys.add(row.label);
    }
    return [...keys].sort();
  }

  calendarValue(holding: FundHolding, label: string): number | null {
    return (holding[this.calendarBasis] || []).find((row) => row.label === label)?.pct ?? null;
  }

  get calendarHoldings(): FundHolding[] {
    return (this.data?.holdings || []).filter((holding) => (holding[this.calendarBasis] || []).length);
  }

  get expandedHolding(): FundHolding | null {
    if (this.expandedId === null) return null;
    return (this.data?.holdings || []).find((holding) => holding.id === this.expandedId) || null;
  }

  toggleExpanded(holding: FundHolding): void {
    this.expandedId = this.expandedId === holding.id ? null : holding.id;
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

  setBenchmark(value: number | null): void {
    this.benchmarkId = value ? Number(value) : null;
    this.load();
  }

  exportHoldingsCsv(): void {
    const rows = this.filteredHoldings;
    if (!rows.length) return;
    const header = [
      'Name', 'Type', 'Platform', 'Category', 'Scheme code', 'Units', 'NAV', 'NAV date', 'Stale days',
      'Invested', 'Current value', 'Weight %', 'Gain', 'Gain %', 'XIRR %', 'Range return %',
      '1D', '1W', '1M', '3M', '6M', '1Y', '3Y (ann.)', 'YTD', 'FY', 'CAGR %',
      'Volatility %', 'Downside %', 'Sharpe', 'Sortino', 'Beta', 'Correlation', 'Max drawdown %', 'Up days %'
    ];
    const lines = rows.map((row) => [
      row.name, row.investment_type, row.platform, row.category, row.scheme_code,
      row.units, row.nav, row.nav_date, row.stale_days, row.invested_amount, row.current_value,
      row.weight_pct, row.gain, row.gain_pct, row.xirr_pct, row.range_return_pct,
      row.trailing?.d1, row.trailing?.w1, row.trailing?.m1, row.trailing?.m3, row.trailing?.m6,
      row.trailing?.y1, row.trailing?.y3, row.trailing?.ytd, row.trailing?.fy, row.cagr_pct,
      row.volatility_pct, row.downside_pct, row.sharpe, row.sortino, row.beta, row.correlation,
      row.max_drawdown_pct, row.positive_days_pct
    ]);
    this.downloadCsv(
      [header, ...lines],
      `mf-etf-holdings-${this.period}-${this.data?.as_of || 'latest'}.csv`
    );
  }

  exportPeriodsCsv(): void {
    const rows = this.data?.period_rows || [];
    if (!rows.length) return;
    const header = ['Period', 'Start', 'End', 'Return %', 'Start value', 'End value', 'Value change',
      'Advancers', 'Decliners', 'Best fund', 'Best %', 'Worst fund', 'Worst %'];
    const lines = rows.map((row) => [
      row.label, row.start, row.end, row.change_pct, row.start_value, row.end_value, row.value_change,
      row.advancers, row.decliners, row.best?.name, row.best?.pct, row.worst?.name, row.worst?.pct
    ]);
    this.downloadCsv([header, ...lines], `mf-etf-${this.period}-returns.csv`);
  }

  formatCurrency(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  formatPercent(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const parsed = Number(value);
    return `${parsed > 0 ? '+' : ''}${parsed.toFixed(digits)}%`;
  }

  formatNumber(value: number | null | undefined, digits = 4): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits });
  }

  formatRatio(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return Number(value).toFixed(2);
  }

  formatDate(value: string | null | undefined): string {
    return value || '—';
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
    const parsed = Number(value);
    const intensity = Math.min(Math.abs(parsed) / 10, 1);
    const alpha = 0.08 + intensity * 0.52;
    const rgb = parsed >= 0 ? '5, 150, 105' : '220, 38, 38';
    return {
      background: `rgba(${rgb}, ${alpha.toFixed(2)})`,
      color: intensity > 0.6 ? '#ffffff' : 'var(--app-ink)'
    };
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

  private sortValue(row: FundHolding, key: string): number | string | null {
    if (key.startsWith('trailing.')) {
      const field = key.split('.')[1] as keyof NonNullable<FundHolding['trailing']>;
      return row.trailing?.[field] ?? null;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number' || typeof value === 'string') return value;
    return null;
  }

  private toIso(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  private savePreferences(): void {
    const prefs: StoredPreferences = {
      period: this.period,
      activeRange: this.activeRange,
      from: this.from,
      to: this.to,
      types: this.selectedTypes,
      platforms: this.selectedPlatforms,
      categories: this.selectedCategories,
      topN: this.topN,
      riskFreePct: this.riskFreePct,
      benchmarkId: this.benchmarkId,
      activeTab: this.activeTab
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable (private mode) — filters simply do not persist
    }
  }

  private restorePreferences(): boolean {
    let prefs: StoredPreferences | null = null;
    try {
      prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    } catch {
      prefs = null;
    }
    if (!prefs) return false;

    this.period = prefs.period || this.period;
    this.activeRange = prefs.activeRange || this.activeRange;
    this.from = prefs.from || '';
    this.to = prefs.to || '';
    this.selectedTypes = prefs.types || [];
    this.selectedPlatforms = prefs.platforms || [];
    this.selectedCategories = prefs.categories || [];
    this.topN = prefs.topN || this.topN;
    this.riskFreePct = prefs.riskFreePct ?? this.riskFreePct;
    this.benchmarkId = prefs.benchmarkId ?? null;
    this.activeTab = prefs.activeTab || this.activeTab;
    return Boolean(this.from || this.to || this.activeRange === 'all');
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
      datasets: [
        {
          label: 'Portfolio (base 100)',
          data: data.portfolio_series.map((point) => point.index),
          borderColor: SERIES_COLORS[1],
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2
        },
        ...(data.benchmark
          ? [{
            label: `Benchmark: ${data.benchmark.name}`,
            data: data.benchmark.series.map((point) => point.index),
            borderColor: SERIES_COLORS[3],
            backgroundColor: 'transparent',
            borderDash: [6, 4],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2
          }]
          : [])
      ]
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

    this.rollingChartData = {
      labels,
      datasets: data.rolling_returns.map((window, index) => {
        const byDate = new Map(window.points.map((point) => [point.date, point.pct]));
        return {
          label: window.label,
          data: labels.map((date) => byDate.get(date) ?? null),
          borderColor: SERIES_COLORS[index % SERIES_COLORS.length],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true
        };
      })
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

    const movers = [...data.movers.gainers, ...data.movers.losers];
    this.moversChartData = {
      labels: movers.map((mover) => mover.name),
      datasets: [{
        label: 'Latest session %',
        data: movers.map((mover) => mover.pct),
        backgroundColor: movers.map((mover) => (mover.pct >= 0 ? POSITIVE : NEGATIVE)),
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

    this.riskScatterData = {
      datasets: [{
        label: 'Funds',
        data: data.holdings
          .filter((holding) => holding.volatility_pct !== null && holding.range_return_pct !== null)
          .map((holding) => ({
            x: holding.volatility_pct as number,
            y: holding.range_return_pct as number,
            label: holding.name
          })),
        backgroundColor: data.holdings
          .filter((holding) => holding.volatility_pct !== null && holding.range_return_pct !== null)
          .map((holding) => ((holding.range_return_pct ?? 0) >= 0 ? POSITIVE : NEGATIVE)),
        pointRadius: 6,
        pointHoverRadius: 9
      }]
    };

    this.buildAllocationChart();
  }

  private lastReturn(fund: { returns: Record<string, number | null> }): number {
    const values = Object.values(fund.returns).filter((value): value is number => value !== null);
    return values.length ? values[values.length - 1] : -Infinity;
  }

  private buildAllocationChart(): void {
    const rows = this.allocationRows;
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
