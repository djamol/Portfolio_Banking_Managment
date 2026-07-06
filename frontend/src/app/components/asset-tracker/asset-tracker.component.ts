import { Component, OnInit } from '@angular/core';
import { AnalyticsService } from '../../services/analytics.service';
import { ChartConfiguration, ChartOptions } from 'chart.js';

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
  avgPeriodChange: number;
}

type SortDirection = 'asc' | 'desc';

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
  loading = false;
  errorMessage = '';
  currentAmount = 0;
  sortDirection: SortDirection = 'asc';

  amountDiffChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  periodChangeChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  growthChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };

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

  periodChangeChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            const prefix = value >= 0 ? '+' : '';
            return `Change: ${prefix}${value.toFixed(2)}%`;
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

  constructor(private analyticsService: AnalyticsService) {}

  ngOnInit() {
    this.loadData();
  }

  refresh() {
    this.loadData();
  }

  toggleSort() {
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.applySort();
  }

  loadData() {
    this.loading = true;
    this.errorMessage = '';

    this.analyticsService.getValueSeriesFiltered().subscribe({
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

        if (sortedDates.length === 0) {
          this.rows = [];
          this.displayRows = [];
          this.stats = null;
          this.currentAmount = 0;
          this.buildCharts();
          this.loading = false;
          return;
        }

        const latestDate = sortedDates[sortedDates.length - 1];
        const latestSnapshotAmount = byDate.get(latestDate) ?? 0;

        this.analyticsService.getTotal().subscribe({
          next: (totalResponse) => {
            const liveTotal = this.toNumber(totalResponse.data?.total_amount);
            this.currentAmount = liveTotal > 0 ? liveTotal : latestSnapshotAmount;
            this.buildRows(sortedDates, byDate, latestDate);
            this.loading = false;
          },
          error: () => {
            this.currentAmount = latestSnapshotAmount;
            this.buildRows(sortedDates, byDate, latestDate);
            this.loading = false;
          }
        });
      },
      error: (error) => {
        console.error('Error loading asset tracker data:', error);
        this.errorMessage = 'Failed to load asset tracker data. ' + (error.message || 'Please check if backend is running.');
        this.loading = false;
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

    const periodChanges = this.rows.slice(1).map((r) => r.diffPreviousDate);
    const avgPeriodChange = periodChanges.length
      ? periodChanges.reduce((a, b) => a + b, 0) / periodChanges.length
      : 0;

    const trackingMonths = Math.max(1, this.monthsBetween(
      this.parseDateKey(first.date),
      this.parseDateKey(latestDate)
    ));

    let cagr: number | null = null;
    if (first.amount > 0 && trackingMonths > 0) {
      const years = trackingMonths / 12;
      cagr = (Math.pow(this.currentAmount / first.amount, 1 / years) - 1) * 100;
    }

    const sinceLastSnapshot = this.currentAmount - latest.amount;
    const sinceLastSnapshotPercent = latest.amount !== 0
      ? (sinceLastSnapshot / latest.amount) * 100
      : 0;

    this.stats = {
      currentAmount: this.currentAmount,
      latestSnapshotLabel: latest.dateLabel,
      firstSnapshotLabel: first.dateLabel,
      firstAmount: first.amount,
      snapshotCount: this.rows.length,
      totalGrowth: this.currentAmount - first.amount,
      totalGrowthPercent: first.amount !== 0
        ? ((this.currentAmount - first.amount) / first.amount) * 100
        : 0,
      sinceLastSnapshot,
      sinceLastSnapshotPercent,
      highestAmount: highest,
      highestDateLabel: highestRow.dateLabel,
      lowestAmount: lowest,
      lowestDateLabel: lowestRow.dateLabel,
      cagr,
      trackingMonths,
      avgPeriodChange
    };
  }

  private applySort() {
    this.displayRows = [...this.rows].sort((a, b) => {
      const diff = this.parseDateKey(a.date).getTime() - this.parseDateKey(b.date).getTime();
      return this.sortDirection === 'asc' ? diff : -diff;
    });
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

    const periodRows = chronological.filter((_, i) => i > 0);
    this.periodChangeChartData = {
      labels: periodRows.map((row) => row.dateLabel),
      datasets: [{
        label: 'Period % Change',
        data: periodRows.map((row) => row.diffPreviousPercent),
        backgroundColor: periodRows.map((row) =>
          row.diffPreviousPercent >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
        ),
        borderColor: periodRows.map((row) =>
          row.diffPreviousPercent >= 0 ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)'
        ),
        borderWidth: 1
      }]
    };

    this.growthChartData = {
      labels,
      datasets: [{
        label: 'Growth vs Current (%)',
        data: chronological.map((row) => row.percent),
        borderColor: 'rgba(118, 75, 162, 1)',
        backgroundColor: 'rgba(118, 75, 162, 0.12)',
        tension: 0.35,
        fill: true,
        pointRadius: 3
      }]
    };
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
}
