import { Component, OnInit } from '@angular/core';
import { AnalyticsService, DeltaRow, InsightsResponse, ValueSeriesResponse } from '../../services/analytics.service';
import { BankAnalyticsService } from '../../services/banking/bank-analytics.service';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { getIndianAmountBreakdown, IndianAmountBreakdown } from '../../utils/indian-number.util';
import { MATURITY_HELPER_TYPES, parseMaturityDateObject } from '../../utils/maturity-notes.util';
import {
  computeBucketsFromHoldings,
  isExcelLegacy,
  isFunded,
  NetWorthBucket
} from '../../utils/net-worth.util';

const GOAL_STORAGE_KEY = 'asset-tracker-goal-amount';
const LARGE_FD_MATURITY_THRESHOLD = 500000;

type SummaryRow = {
  id: number;
  website_app_name: string;
  investment_type: string;
  sub_type_name: string | null;
  sub_type_category: string | null;
  amount: number;
  investment_date: Date;
  notes?: string | null;
};

type MaturityItem = {
  id: number;
  name: string;
  type: string;
  amount: number;
  maturityDate: Date;
  daysLeft: number;
  source: 'notes' | 'estimate';
};

type LargestHolding = {
  id: number;
  title: string;
  meta: string;
  amount: number;
  pct: number;
};

type MoverPlatformGroup = {
  platform: string;
  delta: number;
  items: DeltaRow[];
};

type PlatformConcentrationGroup = {
  platform: string;
  amount: number;
  pct: number;
  items: SummaryRow[];
};

type LiquidityAccount = {
  id: number;
  bank_name: string;
  account_name: string;
  latest_balance: number;
  stale: boolean;
  is_credit_card: boolean;
};

type AttentionChip = {
  label: string;
  route: string | string[];
  tone: 'info' | 'warn' | 'danger';
};

type LastMonthFlow = {
  label: string;
  spend: number;
  income: number;
  net: number;
};

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  standalone: false
})
export class DashboardComponent implements OnInit {
  loading = true;
  errorMessage = '';
  bankCashError = '';

  totalAmount = 0;
  fundedCount = 0;
  zeroCount = 0;
  insights: InsightsResponse | null = null;
  daysSinceSnapshot: number | null = null;

  buckets: NetWorthBucket = { invested: 0, fds: 0, cash: 0, realEstate: 0, total: 0 };
  bucketBreakdown: IndianAmountBreakdown | null = null;
  investedBreakdown: IndianAmountBreakdown | null = null;
  fdsBreakdown: IndianAmountBreakdown | null = null;
  cashBreakdown: IndianAmountBreakdown | null = null;
  realEstateBreakdown: IndianAmountBreakdown | null = null;

  summaryRows: SummaryRow[] = [];
  liquidityAccounts: LiquidityAccount[] = [];
  creditCardAccounts: Array<{ bank_name: string; account_name: string; last_txn_date?: string | null }> = [];
  savingBankSnapshotNote = false;
  lastMonthFlow: LastMonthFlow | null = null;
  attentionChips: AttentionChip[] = [];

  platformGroups: PlatformConcentrationGroup[] = [];
  expandedPlatform: string | null = null;
  top3ConcentrationPct = 0;
  platformCount = 0;

  gainerPlatforms: MoverPlatformGroup[] = [];
  loserPlatforms: MoverPlatformGroup[] = [];
  expandedGainerPlatform: string | null = null;
  expandedLoserPlatform: string | null = null;
  moversFrom = '';
  moversTo = '';
  moversLoading = false;
  totalGain = 0;
  totalLoss = 0;
  gainerCount = 0;
  loserCount = 0;

  maturityItems: MaturityItem[] = [];
  largestHoldings: LargestHolding[] = [];
  largestHoldingPct = 0;
  largestHoldingAmount = 0;
  largestHoldingLabel = '';

  combinedNetWorth = 0;
  combinedBreakdown: IndianAmountBreakdown | null = null;
  goalAmount: number | null = null;
  goalProgressPercent = 0;
  goalRemaining = 0;

  private useLiveBankCash = false;

  allocationChartData: ChartConfiguration<'doughnut'>['data'] = {
    labels: ['Invested', 'FDs', 'Cash', 'Real estate'],
    datasets: [{
      data: [0, 0, 0, 0],
      backgroundColor: [
        'rgba(59, 130, 246, 0.85)',
        'rgba(245, 158, 11, 0.85)',
        'rgba(16, 185, 129, 0.85)',
        'rgba(118, 75, 162, 0.85)'
      ]
    }]
  };

  sparklineChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };

  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = Number(ctx.parsed) || 0;
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + (Number(b) || 0), 0);
            const pct = total > 0 ? (value / total) * 100 : 0;
            return `${ctx.label}: ₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${pct.toFixed(1)}%)`;
          }
        }
      }
    }
  };

  sparklineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            `₹${(ctx.parsed.y ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        }
      }
    },
    scales: {
      x: { ticks: { maxTicksLimit: 6 } },
      y: {
        ticks: {
          callback: (value) => '₹' + Number(value).toLocaleString('en-IN')
        }
      }
    }
  };

  constructor(
    private analyticsService: AnalyticsService,
    private bankAnalytics: BankAnalyticsService
  ) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.errorMessage = '';
    this.bankCashError = '';
    this.useLiveBankCash = false;
    this.loadGoal();
    this.platformGroups = [];
    this.expandedPlatform = null;
    this.top3ConcentrationPct = 0;
    this.platformCount = 0;
    this.gainerPlatforms = [];
    this.loserPlatforms = [];
    this.expandedGainerPlatform = null;
    this.expandedLoserPlatform = null;
    this.totalGain = 0;
    this.totalLoss = 0;
    this.gainerCount = 0;
    this.loserCount = 0;
    this.attentionChips = [];
    this.lastMonthFlow = null;
    this.liquidityAccounts = [];

    this.loadBankCash();
    this.loadLastMonthBankFlow();
    this.loadInvestmentCashflowCheck();

    let pending = 4;
    const done = () => {
      pending -= 1;
      if (pending <= 0) this.loading = false;
    };

    this.analyticsService.getTotal().subscribe({
      next: (res) => {
        this.totalAmount = this.toNumber(res.data?.total_amount);
        done();
      },
      error: () => {
        this.errorMessage = 'Failed to load portfolio totals.';
        done();
      }
    });

    this.analyticsService.getInsights().subscribe({
      next: (res) => {
        this.insights = res.data;
        this.daysSinceSnapshot = res.data?.daysSinceLatestSnapshot ?? null;
        const from = this.dateKey(res.data?.prevDate);
        const to = this.dateKey(res.data?.latestDate);
        if (from && to && from !== to) {
          this.moversFrom = from;
          this.moversTo = to;
          this.loadMovers();
        }
        done();
      },
      error: () => done()
    });

    const from = this.monthsAgoKey(12);
    this.analyticsService.getValueSeriesFiltered({ from }).subscribe({
      next: (res) => {
        this.buildSparkline(res.data);
        if (!this.moversFrom || !this.moversTo) {
          this.setupDeltaDates(res.data);
          if (this.moversFrom && this.moversTo) {
            this.loadMovers();
          }
        }
        done();
      },
      error: () => done()
    });

    this.analyticsService.getSummaryTable().subscribe({
      next: (res) => {
        this.summaryRows = (res.data || []).map((item: any) => ({
          id: Number(item.id),
          website_app_name: item.website_app_name,
          investment_type: item.investment_type,
          sub_type_name: item.sub_type_name,
          sub_type_category: item.sub_type_category,
          amount: this.toNumber(item.amount),
          investment_date: new Date(item.investment_date),
          notes: item.notes ?? null
        }));
        this.fundedCount = this.summaryRows.filter((r) => isFunded(r.amount)).length;
        this.zeroCount = this.summaryRows.length - this.fundedCount;
        this.recomputeBuckets();
        this.buildLargestHoldings();
        this.buildMaturityWatch();
        this.buildPlatformConcentration();
        this.buildAttentionChips();
        done();
      },
      error: () => done()
    });
  }

  togglePlatform(platform: string) {
    this.expandedPlatform = this.expandedPlatform === platform ? null : platform;
  }

  holdingLabel(row: SummaryRow): string {
    return [row.investment_type, row.sub_type_name, row.sub_type_category]
      .map((part) => (part == null ? '' : String(part).trim()))
      .filter(Boolean)
      .join(' · ') || 'Unknown';
  }

  applyMoversDates() {
    if (!this.moversFrom || !this.moversTo) return;
    if (this.moversFrom > this.moversTo) {
      const tmp = this.moversFrom;
      this.moversFrom = this.moversTo;
      this.moversTo = tmp;
    }
    this.loadMovers();
  }

  freshnessTone(): string {
    if (this.daysSinceSnapshot === null) return 'neutral';
    if (this.daysSinceSnapshot <= 7) return 'good';
    if (this.daysSinceSnapshot <= 21) return 'warn';
    return 'bad';
  }

  toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  moverItemLabel(row: DeltaRow): string {
    return [row.investment_type, row.sub_type_name, row.sub_type_category]
      .map((part) => (part == null ? '' : String(part).trim()))
      .filter(Boolean)
      .join(' · ') || 'Unknown';
  }

  toggleGainerPlatform(platform: string) {
    this.expandedGainerPlatform = this.expandedGainerPlatform === platform ? null : platform;
  }

  toggleLoserPlatform(platform: string) {
    this.expandedLoserPlatform = this.expandedLoserPlatform === platform ? null : platform;
  }

  private fundedRows(): SummaryRow[] {
    return this.summaryRows.filter((r) => isFunded(r.amount) && !isExcelLegacy(r));
  }

  private recomputeBuckets() {
    const liveCash = this.buckets.cash;
    this.buckets = computeBucketsFromHoldings(
      this.summaryRows,
      liveCash,
      this.useLiveBankCash
    );
    this.savingBankSnapshotNote =
      this.useLiveBankCash &&
      this.summaryRows.some(
        (r) => r.investment_type === 'Saving Bank Balance' && isFunded(r.amount)
      );
    this.combinedNetWorth = this.buckets.total;
    this.combinedBreakdown = getIndianAmountBreakdown(this.combinedNetWorth);
    this.bucketBreakdown = this.combinedBreakdown;
    this.investedBreakdown = getIndianAmountBreakdown(this.buckets.invested);
    this.fdsBreakdown = getIndianAmountBreakdown(this.buckets.fds);
    this.cashBreakdown = getIndianAmountBreakdown(this.buckets.cash);
    this.realEstateBreakdown = getIndianAmountBreakdown(this.buckets.realEstate);
    const bucketEntries: [string, number][] = [
      ['Invested', this.buckets.invested],
      ['FDs', this.buckets.fds],
      ['Cash', this.buckets.cash],
      ['Real estate', this.buckets.realEstate]
    ];
    const entries = bucketEntries.filter((entry) => entry[1] > 0);
    this.allocationChartData = {
      labels: entries.map(([l]) => l),
      datasets: [{
        ...this.allocationChartData.datasets[0],
        data: entries.map(([, v]) => v)
      }]
    };
    if (this.summaryRows.length) {
      this.buildLargestHoldings();
      this.buildPlatformConcentration();
    }
    this.updateGoalProgress();
  }

  private groupByPlatform(rows: DeltaRow[], sortDesc: boolean): MoverPlatformGroup[] {
    const map = new Map<string, MoverPlatformGroup>();
    for (const row of rows) {
      const platform = String(row.website_app_name || '').trim() || 'Unknown';
      let group = map.get(platform);
      if (!group) {
        group = { platform, delta: 0, items: [] };
        map.set(platform, group);
      }
      group.delta += this.toNumber(row.delta);
      group.items.push(row);
    }
    for (const group of map.values()) {
      group.items.sort((a, b) =>
        sortDesc
          ? this.toNumber(b.delta) - this.toNumber(a.delta)
          : this.toNumber(a.delta) - this.toNumber(b.delta)
      );
    }
    return [...map.values()].sort((a, b) =>
      sortDesc ? b.delta - a.delta : a.delta - b.delta
    );
  }

  private loadMovers() {
    if (!this.moversFrom || !this.moversTo) return;
    this.moversLoading = true;
    this.analyticsService.getDelta(this.moversFrom, this.moversTo).subscribe({
      next: (res) => {
        const rows = (res.data || []).filter((r) => this.toNumber(r.delta) !== 0);
        const gainers = [...rows]
          .filter((r) => this.toNumber(r.delta) > 0)
          .sort((a, b) => this.toNumber(b.delta) - this.toNumber(a.delta));
        const losers = [...rows]
          .filter((r) => this.toNumber(r.delta) < 0)
          .sort((a, b) => this.toNumber(a.delta) - this.toNumber(b.delta));
        this.totalGain = gainers.reduce((s, r) => s + this.toNumber(r.delta), 0);
        this.totalLoss = losers.reduce((s, r) => s + Math.abs(this.toNumber(r.delta)), 0);
        this.gainerCount = gainers.length;
        this.loserCount = losers.length;
        this.gainerPlatforms = this.groupByPlatform(gainers, true);
        this.loserPlatforms = this.groupByPlatform(losers, false);
        this.expandedGainerPlatform = null;
        this.expandedLoserPlatform = null;
        this.moversLoading = false;
      },
      error: () => {
        this.gainerPlatforms = [];
        this.loserPlatforms = [];
        this.expandedGainerPlatform = null;
        this.expandedLoserPlatform = null;
        this.totalGain = 0;
        this.totalLoss = 0;
        this.gainerCount = 0;
        this.loserCount = 0;
        this.moversLoading = false;
      }
    });
  }

  private buildSparkline(payload: ValueSeriesResponse | undefined) {
    const rows = payload?.rows || [];
    if (!rows.length || payload?.mode === 'series') {
      const byDate = new Map<string, number>();
      for (const row of rows) {
        const key = String(row.change_date).slice(0, 10);
        byDate.set(key, (byDate.get(key) ?? 0) + this.toNumber(row.total_value));
      }
      const dates = [...byDate.keys()].sort();
      this.sparklineChartData = {
        labels: dates.map((d) => this.formatLabel(d)),
        datasets: [{
          label: 'Portfolio',
          data: dates.map((d) => byDate.get(d) ?? 0),
          borderColor: 'rgba(59, 130, 246, 1)',
          backgroundColor: 'rgba(59, 130, 246, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4
        }]
      };
      return;
    }

    const sorted = [...rows].sort(
      (a, b) => new Date(a.change_date).getTime() - new Date(b.change_date).getTime()
    );
    this.sparklineChartData = {
      labels: sorted.map((r) => this.formatLabel(String(r.change_date))),
      datasets: [{
        label: 'Portfolio',
        data: sorted.map((r) => this.toNumber(r.total_value)),
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    };
  }

  private setupDeltaDates(payload: ValueSeriesResponse | undefined) {
    const dates = [...new Set((payload?.rows || []).map((r) => this.dateKey(r.change_date)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    if (dates.length >= 2) {
      this.moversFrom = dates[dates.length - 2];
      this.moversTo = dates[dates.length - 1];
    } else if (dates.length === 1) {
      this.moversFrom = dates[0];
      this.moversTo = dates[0];
    }
  }

  private dateKey(value: unknown): string {
    if (value == null || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
    return s.slice(0, 10);
  }

  private buildPlatformConcentration() {
    const map = new Map<string, PlatformConcentrationGroup>();
    for (const row of this.fundedRows()) {
      const platform = String(row.website_app_name || '').trim() || 'Unknown';
      let group = map.get(platform);
      if (!group) {
        group = { platform, amount: 0, pct: 0, items: [] };
        map.set(platform, group);
      }
      group.amount += row.amount;
      group.items.push(row);
    }
    const portfolioBase = this.buckets.total > 0 ? this.buckets.total : this.fundedRows().reduce((s, r) => s + r.amount, 0);
    const groups = [...map.values()]
      .map((g) => {
        g.items = [...g.items].sort((a, b) => b.amount - a.amount);
        g.pct = portfolioBase > 0 ? (g.amount / portfolioBase) * 100 : 0;
        return g;
      })
      .sort((a, b) => b.amount - a.amount);
    this.platformGroups = groups;
    this.platformCount = groups.length;
    const top3 = groups.slice(0, 3).reduce((s, g) => s + g.amount, 0);
    this.top3ConcentrationPct = portfolioBase > 0 ? (top3 / portfolioBase) * 100 : 0;
    if (this.expandedPlatform && !groups.some((g) => g.platform === this.expandedPlatform)) {
      this.expandedPlatform = null;
    }
  }

  private buildLargestHoldings() {
    const portfolioBase = this.buckets.total > 0
      ? this.buckets.total
      : this.fundedRows().reduce((s, r) => s + r.amount, 0);
    const rows = [...this.fundedRows()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12)
      .map((row) => ({
        id: row.id,
        title: row.sub_type_name || row.website_app_name || 'Unknown',
        meta: [row.website_app_name, row.investment_type, row.sub_type_category]
          .map((p) => (p == null ? '' : String(p).trim()))
          .filter(Boolean)
          .join(' · '),
        amount: row.amount,
        pct: portfolioBase > 0 ? (row.amount / portfolioBase) * 100 : 0
      }));
    this.largestHoldings = rows;
    const top = rows[0];
    this.largestHoldingAmount = top?.amount ?? 0;
    this.largestHoldingPct = top?.pct ?? 0;
    this.largestHoldingLabel = top?.title ?? '';
  }

  private buildMaturityWatch() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items: MaturityItem[] = [];

    for (const row of this.fundedRows()) {
      if (!MATURITY_HELPER_TYPES.includes(row.investment_type)) continue;

      const fromNotes = parseMaturityDateObject(row.notes);
      if (fromNotes) {
        const daysLeft = Math.round((fromNotes.getTime() - today.getTime()) / 86400000);
        if (daysLeft >= -30 && daysLeft <= 365) {
          items.push({
            id: row.id,
            name: `${row.website_app_name} · ${row.sub_type_name || row.investment_type}`,
            type: row.investment_type,
            amount: row.amount,
            maturityDate: fromNotes,
            daysLeft,
            source: 'notes'
          });
        }
        continue;
      }

      if (!row.investment_date || Number.isNaN(row.investment_date.getTime())) continue;
      const months = this.estimateTenorMonths(row);
      if (!months) continue;
      const maturity = new Date(row.investment_date);
      maturity.setMonth(maturity.getMonth() + months);
      const daysLeft = Math.round((maturity.getTime() - today.getTime()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 180) {
        items.push({
          id: row.id,
          name: `${row.website_app_name} · ${row.sub_type_name || row.investment_type}`,
          type: row.investment_type,
          amount: row.amount,
          maturityDate: maturity,
          daysLeft,
          source: 'estimate'
        });
      }
    }

    this.maturityItems = items.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 8);
  }

  private estimateTenorMonths(row: SummaryRow): number | null {
    const cat = (row.sub_type_category || '').toLowerCase();
    if (cat.includes('short')) return 12;
    if (cat.includes('medium')) return 36;
    if (cat.includes('long') || row.investment_type === 'PPF' || row.investment_type === 'EPF') return 60;
    if (row.investment_type === 'FD') return 12;
    if (row.investment_type === 'Bond') return 36;
    return null;
  }

  private monthsAgoKey(months: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private lastCalendarMonthRange(): { from: string; to: string; label: string } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    const label = start.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return { from: this.dateKey(start), to: this.dateKey(end), label };
  }

  private loadBankCash() {
    this.bankAnalytics.getCashSummary().subscribe({
      next: (data) => {
        this.useLiveBankCash = true;
        const inr = (data?.totals_by_currency || []).find(
          (t) => String(t.currency || 'INR').toUpperCase() === 'INR'
        );
        const cashInr = this.toNumber(inr?.total);
        this.buckets = { ...this.buckets, cash: cashInr };
        this.liquidityAccounts = (data?.accounts || [])
          .filter((a) => a.is_active && !a.is_credit_card)
          .map((a) => ({
            id: a.id,
            bank_name: a.bank_name,
            account_name: a.account_name,
            latest_balance: this.toNumber(a.latest_balance),
            stale: !!a.stale,
            is_credit_card: !!a.is_credit_card
          }))
          .sort((a, b) => b.latest_balance - a.latest_balance);
        this.creditCardAccounts = (data?.accounts || [])
          .filter((a) => a.is_active && a.is_credit_card)
          .map((a) => ({
            bank_name: a.bank_name,
            account_name: a.account_name,
            last_txn_date: a.last_txn_date
          }));
        this.recomputeBuckets();
        this.buildAttentionChips();
      },
      error: () => {
        this.bankCashError = 'Could not load live bank balances — using portfolio cash snapshots only.';
        this.useLiveBankCash = false;
        this.recomputeBuckets();
        this.buildAttentionChips();
      }
    });
  }

  private loadLastMonthBankFlow() {
    const range = this.lastCalendarMonthRange();
    this.bankAnalytics
      .getAnalytics({ from: range.from, to: range.to, exclude_transfers: true })
      .subscribe({
        next: (data) => {
          const summary = data?.summary;
          if (!summary) return;
          this.lastMonthFlow = {
            label: range.label,
            spend: this.toNumber(summary.total_debit),
            income: this.toNumber(summary.total_credit),
            net: this.toNumber(summary.net_cashflow)
          };
        },
        error: () => {
          this.lastMonthFlow = null;
        }
      });
  }

  private loadInvestmentCashflowCheck() {
    this.analyticsService.getCashflowsByMonth().subscribe({
      next: (res) => {
        const rows = res.data || [];
        if (!rows.length) {
          this.buildAttentionChips(true);
        }
      },
      error: () => { /* non-blocking */ }
    });
  }

  private buildAttentionChips(investmentCashflowsEmpty = false) {
    const chips: AttentionChip[] = [];

    if (this.zeroCount > 0) {
      chips.push({
        label: `${this.zeroCount} zero-amount holdings`,
        route: '/investments',
        tone: 'info'
      });
    }

    const staleAccounts = this.liquidityAccounts.filter((a) => a.stale);
    if (staleAccounts.length) {
      chips.push({
        label: `${staleAccounts.length} stale bank account(s)`,
        route: '/banking/accounts',
        tone: 'warn'
      });
    }

    const ccLag = this.creditCardAccounts.filter((a) => {
      if (!a.last_txn_date) return true;
      const d = new Date(`${String(a.last_txn_date).slice(0, 10)}T00:00:00`);
      if (Number.isNaN(d.getTime())) return true;
      const days = Math.round((Date.now() - d.getTime()) / 86400000);
      return days > 90;
    });
    if (ccLag.length) {
      chips.push({
        label: `${ccLag.length} credit card(s) need fresh statement`,
        route: '/banking/import',
        tone: 'warn'
      });
    }

    const largeFdNoMaturity = this.summaryRows.filter(
      (r) =>
        r.investment_type === 'FD' &&
        isFunded(r.amount) &&
        r.amount >= LARGE_FD_MATURITY_THRESHOLD &&
        !parseMaturityDateObject(r.notes)
    );
    if (largeFdNoMaturity.length) {
      chips.push({
        label: `${largeFdNoMaturity.length} large FD(s) missing maturity date`,
        route: '/investments',
        tone: 'warn'
      });
    }

    if (investmentCashflowsEmpty) {
      chips.push({
        label: 'No investment cashflows recorded',
        route: '/cashflows',
        tone: 'info'
      });
    }

    this.attentionChips = chips;
  }

  private loadGoal() {
    try {
      const raw = localStorage.getItem(GOAL_STORAGE_KEY);
      const value = raw ? Number(raw) : NaN;
      this.goalAmount = Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      this.goalAmount = null;
    }
    this.updateGoalProgress();
  }

  private updateGoalProgress() {
    if (!this.goalAmount || this.goalAmount <= 0) {
      this.goalProgressPercent = 0;
      this.goalRemaining = 0;
      return;
    }
    this.goalProgressPercent = Math.min(100, (this.combinedNetWorth / this.goalAmount) * 100);
    this.goalRemaining = Math.max(0, this.goalAmount - this.combinedNetWorth);
  }

  private formatLabel(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }
}
