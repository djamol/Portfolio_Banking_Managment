import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { BANK_CHART_COLORS, barOptions, doughnutOptions, netLineOptions } from '../shared/banking-chart.util';
import { formatMoney, formatPct } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

type HoldingType = 'all' | 'Mutual Fund' | 'ETF';
type HoldingSort = 'current' | 'gain' | 'gain_pct' | 'weight_pct' | 'name' | 'stale_days';
type AllocationDim = 'byCategory' | 'byGroup' | 'byPlatform' | 'byType';

@Component({
  selector: 'app-banking-mf-etf',
  templateUrl: './banking-mf-etf.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-mf-etf.component.css'],
  standalone: false
})
export class BankingMfEtfComponent implements OnInit, OnDestroy {
  readonly barOptions = barOptions;
  readonly doughnutOptions = doughnutOptions;
  readonly lineOptions = netLineOptions;
  readonly staleDays = 45;

  data: any = null;
  loading = false;
  error = '';

  holdingType: HoldingType = 'all';
  holdingSort: HoldingSort = 'current';
  holdingSortDesc = true;
  holdingSearch = '';
  allocationDim: AllocationDim = 'byCategory';
  flowGrain: 'month' | 'fy' = 'month';

  flowChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  cumulativeChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  valueChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  allocationChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  platformChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };

  private readonly destroy$ = new Subject<void>();

  constructor(
    private analytics: BankAnalyticsService,
    private ctx: BankingContextService,
    private filters: BankingFilterState,
    private router: Router
  ) {}

  ngOnInit() {
    this.load();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.load());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load() {
    this.loading = true;
    this.error = '';
    const f = this.filters.buildSharedFilters();
    this.analytics
      .getInvestmentFlows({ account_id: f['account_id'], from: f['from'], to: f['to'] })
      .subscribe({
        next: (data) => {
          this.data = data;
          this.loading = false;
          this.buildCharts();
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.error || err.message || 'Failed to load MF / ETF data';
          this.ctx.flash('error', this.error);
        }
      });
  }

  get bank() {
    return this.data?.bank;
  }

  get holdings() {
    return this.data?.holdings;
  }

  get typeSummary() {
    const s = this.holdings?.summary;
    if (!s) return null;
    if (this.holdingType === 'Mutual Fund') return s.mf;
    if (this.holdingType === 'ETF') return s.etf;
    return s;
  }

  get flowRows(): any[] {
    return (this.flowGrain === 'fy' ? this.bank?.byFy : this.bank?.byMonth) || [];
  }

  get activeSips(): any[] {
    return (this.bank?.sips || []).filter((s: any) => s.active);
  }

  get activeSipMonthly(): number {
    return this.activeSips.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }

  get dividendYieldPct(): number | null {
    const cur = this.holdings?.summary?.current;
    const div = this.bank?.summary?.dividends;
    return cur > 0 && div > 0 ? (div / cur) * 100 : null;
  }

  get visibleHoldings(): any[] {
    const q = this.holdingSearch.trim().toLowerCase();
    const list = (this.holdings?.items || []).filter(
      (i: any) =>
        (this.holdingType === 'all' || i.type === this.holdingType) &&
        (!q || `${i.name} ${i.platform} ${i.category} ${i.group}`.toLowerCase().includes(q))
    );
    const key = this.holdingSort;
    const dir = this.holdingSortDesc ? -1 : 1;
    return [...list].sort((a, b) => {
      if (key === 'name') return dir * String(a.name).localeCompare(String(b.name));
      const av = a[key] ?? -Infinity;
      const bv = b[key] ?? -Infinity;
      return dir * (av - bv);
    });
  }

  get topGainers(): any[] {
    return this.rankedByGainPct().slice(0, 5);
  }

  get topLosers(): any[] {
    return this.rankedByGainPct()
      .reverse()
      .filter((i) => i.gain_pct < 0)
      .slice(0, 5);
  }

  get allocationRows(): any[] {
    return this.holdings?.[this.allocationDim] || [];
  }

  private rankedByGainPct(): any[] {
    return (this.holdings?.items || [])
      .filter((i: any) => i.gain_pct != null && (this.holdingType === 'all' || i.type === this.holdingType))
      .sort((a: any, b: any) => b.gain_pct - a.gain_pct);
  }

  sortHoldings(key: HoldingSort) {
    if (this.holdingSort === key) {
      this.holdingSortDesc = !this.holdingSortDesc;
    } else {
      this.holdingSort = key;
      this.holdingSortDesc = key !== 'name';
    }
  }

  sortIcon(key: HoldingSort): string {
    if (this.holdingSort !== key) return '';
    return this.holdingSortDesc ? '▼' : '▲';
  }

  setHoldingType(t: HoldingType) {
    this.holdingType = t;
  }

  setAllocationDim(dim: AllocationDim) {
    this.allocationDim = dim;
    this.buildAllocationChart();
  }

  setFlowGrain(g: 'month' | 'fy') {
    this.flowGrain = g;
    this.buildFlowChart();
  }

  viewTransactions() {
    this.filters.applyQuickFilter('investment', this.ctx.categories);
    this.router.navigate(['/banking/transactions']);
  }

  openHoldings() {
    this.router.navigate(['/investments']);
  }

  openNavHistory() {
    this.router.navigate(['/mutual-fund-history']);
  }

  private buildCharts() {
    this.buildFlowChart();
    this.buildCumulativeChart();
    this.buildValueChart();
    this.buildAllocationChart();
    this.buildPlatformChart();
  }

  private buildFlowChart() {
    const rows = this.flowRows;
    this.flowChartData = {
      labels: rows.map((r: any) => r.month || r.fy),
      datasets: [
        { label: 'Invested', data: rows.map((r: any) => Number(r.invested) || 0), backgroundColor: '#3b82f6' },
        { label: 'Redeemed', data: rows.map((r: any) => Number(r.redeemed) || 0), backgroundColor: '#f59e0b' },
        { label: 'Dividends', data: rows.map((r: any) => Number(r.dividends) || 0), backgroundColor: '#10b981' }
      ]
    };
  }

  private buildCumulativeChart() {
    const rows = this.bank?.byMonth || [];
    this.cumulativeChartData = {
      labels: rows.map((r: any) => r.month),
      datasets: [
        {
          label: 'Cumulative net invested (bank)',
          data: rows.map((r: any) => Number(r.cumulative_net) || 0),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 2
        }
      ]
    };
  }

  private buildValueChart() {
    const rows = this.holdings?.history || [];
    this.valueChartData = {
      labels: rows.map((r: any) => r.date),
      datasets: [
        {
          label: 'Mutual Fund value',
          data: rows.map((r: any) => Number(r.mf_value) || 0),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 2
        },
        {
          label: 'ETF value',
          data: rows.map((r: any) => Number(r.etf_value) || 0),
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6,182,212,0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 2
        },
        {
          label: 'Invested (cost)',
          data: rows.map((r: any) => Number(r.invested) || 0),
          borderColor: '#64748b',
          borderDash: [6, 4],
          fill: false,
          tension: 0.25,
          pointRadius: 0
        }
      ]
    };
  }

  private buildAllocationChart() {
    const rows = this.allocationRows.slice(0, 10);
    this.allocationChartData = {
      labels: rows.map((r: any) => r.key),
      datasets: [{ data: rows.map((r: any) => Number(r.current) || 0), backgroundColor: BANK_CHART_COLORS }]
    };
  }

  private buildPlatformChart() {
    const rows = (this.bank?.byPlatform || []).filter((r: any) => r.invested > 0).slice(0, 10);
    this.platformChartData = {
      labels: rows.map((r: any) => r.platform),
      datasets: [{ data: rows.map((r: any) => Number(r.invested) || 0), backgroundColor: BANK_CHART_COLORS }]
    };
  }

  formatMoney = formatMoney;
  formatPct = formatPct;
}
