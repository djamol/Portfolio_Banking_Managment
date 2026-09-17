import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { EMPTY, Subject, merge, switchMap, takeUntil } from 'rxjs';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { BankTransaction, DEFAULT_BANK_CATEGORIES } from '../../../services/banking/banking.models';
import { BankTransactionsService } from '../../../services/banking/bank-transactions.service';
import {
  defaultIncomeCategories,
  matchSelectedCategories,
  rollupCategoryMonthRows
} from '../../../utils/category-rollup.util';
import { formatCategoryLabel } from '../../../utils/category-tree.util';
import {
  BANK_CHART_COLORS,
  doughnutOptions,
  horizontalBarOptions,
  netLineOptions
} from '../shared/banking-chart.util';
import { formatCat, formatMoney, formatPct } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';
import {
  AmountPeriodRow,
  FlowHighlights,
  MonthBucket,
  buildFlowHighlights,
  formatYearMonthLabel,
  rankMonths,
  rankYears
} from '../shared/flow-highlights.util';

const INCOME_CATS_KEY = 'bank-income-categories';
const TOP_TXN_LIMIT = 10;
const TOP_MONTHS = 12;

export type IncomeTableRow = {
  category: string;
  label: string;
  total_credit: number;
  txn_count: number;
  pct: number;
  leaves: string[];
};

@Component({
  selector: 'app-banking-income',
  templateUrl: './banking-income.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-income.component.css'],
  standalone: false
})
export class BankingIncomeComponent implements OnInit, OnDestroy {
  readonly doughnutOptions = doughnutOptions;
  readonly netLineOptions = netLineOptions;
  readonly horizontalBarOptions = horizontalBarOptions;

  /** Credit-only analytics payload (does not share Charts/Summary state). */
  incomeAnalytics: any = null;
  incomeCategories: string[] = [];
  incomeChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  incomeTrendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  monthRankChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  incomeTableRows: IncomeTableRow[] = [];
  monthRankRows: AmountPeriodRow[] = [];
  yearRankRows: AmountPeriodRow[] = [];
  highlights: FlowHighlights | null = null;
  topTransactions: BankTransaction[] = [];
  topTxnsLoading = false;
  totalIncome = 0;
  totalTxnCount = 0;
  avgTxn = 0;
  loading = false;

  private readonly destroy$ = new Subject<void>();
  private readonly topTxnLeaves$ = new Subject<string[]>();

  constructor(
    public ctx: BankingContextService,
    private analyticsService: BankAnalyticsService,
    private txnService: BankTransactionsService,
    private filters: BankingFilterState,
    private router: Router
  ) {}

  ngOnInit() {
    const saved = this.loadSavedIncomeCategories();
    this.incomeCategories =
      saved === null ? defaultIncomeCategories(this.incomePickerOptions) : saved;
    if (saved === null && this.incomeCategories.length) {
      this.persistIncomeCategories();
    }
    this.topTxnLeaves$
      .pipe(
        takeUntil(this.destroy$),
        switchMap((leaves) => {
          if (!leaves.length) {
            this.topTransactions = [];
            this.topTxnsLoading = false;
            return EMPTY;
          }
          this.topTxnsLoading = true;
          return this.txnService.getTransactions({
            ...this.filters.buildSharedFilters(),
            flow: 'credit',
            category: leaves.join(','),
            sort: 'credit_desc',
            limit: TOP_TXN_LIMIT,
            offset: 0
          });
        })
      )
      .subscribe({
        next: (res) => {
          this.topTransactions = res.rows || [];
          this.topTxnsLoading = false;
        },
        error: () => {
          this.topTransactions = [];
          this.topTxnsLoading = false;
        }
      });
    this.loadIncomeAnalytics();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadIncomeAnalytics());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Fetch analytics with flow=credit so category totals are deposits only.
   * Expense categories with only withdrawals will not contribute amounts.
   */
  private loadIncomeAnalytics() {
    this.loading = true;
    this.analyticsService
      .getAnalytics({ ...this.filters.buildSharedFilters(), flow: 'credit' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.incomeAnalytics = data;
          if (data?.categories?.length) {
            this.ctx.mergeCategories(data.categories);
          }
          this.rebuildIncomeViews();
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.ctx.flash('error', err.message || 'Failed to load income analytics');
        }
      });
  }

  get incomePickerOptions(): string[] {
    const fromAnalytics = this.incomeAnalytics?.categories || [];
    return [...new Set([...DEFAULT_BANK_CATEGORIES, ...this.ctx.categories, ...fromAnalytics])].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  onIncomeCategoriesChange(selected: string[]) {
    this.incomeCategories = selected || [];
    this.persistIncomeCategories();
    this.rebuildIncomeViews();
  }

  resetIncomeDefaults() {
    this.incomeCategories = defaultIncomeCategories(this.incomePickerOptions);
    this.persistIncomeCategories();
    this.rebuildIncomeViews();
  }

  openIncomeCategory(row: IncomeTableRow) {
    const leaves = row.leaves.length ? row.leaves : [row.category];
    this.filters.filterCategories = [...leaves];
    this.filters.filterCategory = leaves.length === 1 ? leaves[0] : '';
    this.filters.filterFlow = 'credit';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Showing credit transactions for ${row.label}`);
  }

  openPeriod(row: AmountPeriodRow) {
    this.filters.applyPeriodRange({ key: row.key, label: row.label }, row.grain);
    this.ctx.flash('info', `Filtered to ${row.label}`);
  }

  openTopTxn(t: BankTransaction) {
    const date = String(t.txn_date || '').slice(0, 10);
    const q = String(t.payee || t.narration || '').trim().slice(0, 48);
    if (date) {
      this.filters.applyTxnDay(date, q);
      this.filters.filterFlow = 'credit';
      this.router.navigate(['/banking/transactions']);
      this.ctx.flash('info', `Showing ${date}`);
      return;
    }
    if (t.category) {
      this.openIncomeCategory({
        category: t.category,
        label: formatCategoryLabel(t.category),
        total_credit: Number(t.deposit) || 0,
        txn_count: 1,
        pct: 0,
        leaves: [t.category]
      });
    }
  }

  rebuildIncomeViews() {
    const analytics = this.incomeAnalytics;
    if (!analytics) {
      this.clearViews();
      return;
    }

    const selected = this.incomeCategories;
    if (!selected.length) {
      this.clearViews();
      return;
    }

    const byCategory = (analytics.byCategory || []) as Array<{
      category: string;
      txn_count: number;
      total_debit: number;
      total_credit: number;
    }>;

    // Credits only — never use total_debit even if expense categories are selected.
    const matched = byCategory
      .map((r) => ({
        category: r.category,
        txn_count: Number(r.txn_count) || 0,
        total_credit: Number(r.total_credit) || 0
      }))
      .filter((r) => matchSelectedCategories(r.category, selected) && r.total_credit > 0);

    this.totalIncome = matched.reduce((s, r) => s + r.total_credit, 0);
    this.totalTxnCount = matched.reduce((s, r) => s + r.txn_count, 0);
    this.avgTxn = this.totalTxnCount ? this.totalIncome / this.totalTxnCount : 0;

    this.incomeTableRows = matched
      .map((r) => ({
        category: r.category,
        label: formatCategoryLabel(r.category),
        total_credit: r.total_credit,
        txn_count: r.txn_count,
        pct: this.totalIncome ? (r.total_credit / this.totalIncome) * 100 : 0,
        leaves: [r.category]
      }))
      .sort((a, b) => b.total_credit - a.total_credit);

    const chartRows = this.incomeTableRows.slice(0, 12);
    this.incomeChartData = {
      labels: chartRows.map((r) => r.label),
      datasets: [{
        data: chartRows.map((r) => r.total_credit),
        backgroundColor: BANK_CHART_COLORS
      }]
    };

    const catMonth = (analytics.byCategoryMonth || [])
      .filter((r: any) => matchSelectedCategories(r.category, selected))
      .map((r: any) => ({
        month: r.month,
        category: r.category,
        txn_count: Number(r.txn_count) || 0,
        total_debit: 0,
        total_credit: Number(r.total_credit) || 0
      }))
      .filter((r: { total_credit: number }) => r.total_credit > 0);
    const rolled = rollupCategoryMonthRows(catMonth, 'leaf');
    const byMonth = new Map<string, MonthBucket>();
    for (const row of rolled) {
      const cur = byMonth.get(row.month) || { month: row.month, amount: 0, txn_count: 0 };
      cur.amount += Number(row.total_credit) || 0;
      cur.txn_count += Number(row.txn_count) || 0;
      byMonth.set(row.month, cur);
    }
    const buckets = [...byMonth.values()];
    const monthLabels = [...byMonth.keys()].sort().slice(-24);
    this.incomeTrendChartData = {
      labels: monthLabels.map((m) => formatYearMonthLabel(m)),
      datasets: [{
        label: 'Income (credits)',
        data: monthLabels.map((m) => byMonth.get(m)?.amount || 0),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    };

    this.monthRankRows = rankMonths(buckets, this.totalIncome).slice(0, TOP_MONTHS);
    this.yearRankRows = rankYears(buckets, this.totalIncome);
    this.highlights = buckets.length ? buildFlowHighlights(buckets, this.totalIncome) : null;
    const chartMonths = [...this.monthRankRows].reverse();
    this.monthRankChartData = {
      labels: chartMonths.map((r) => r.label),
      datasets: [{
        label: 'Income',
        data: chartMonths.map((r) => r.amount),
        backgroundColor: 'rgba(16, 185, 129, 0.75)'
      }]
    };

    this.topTxnLeaves$.next(this.incomeTableRows.map((r) => r.category));
  }

  private clearViews() {
    this.incomeTableRows = [];
    this.monthRankRows = [];
    this.yearRankRows = [];
    this.highlights = null;
    this.topTransactions = [];
    this.topTxnsLoading = false;
    this.totalIncome = 0;
    this.totalTxnCount = 0;
    this.avgTxn = 0;
    this.incomeChartData = { labels: [], datasets: [] };
    this.incomeTrendChartData = { labels: [], datasets: [] };
    this.monthRankChartData = { labels: [], datasets: [] };
    this.topTxnLeaves$.next([]);
  }

  /** null = never saved (use defaults); array = explicit user selection */
  private loadSavedIncomeCategories(): string[] | null {
    try {
      const raw = localStorage.getItem(INCOME_CATS_KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return null;
    }
  }

  private persistIncomeCategories() {
    localStorage.setItem(INCOME_CATS_KEY, JSON.stringify(this.incomeCategories));
  }

  formatMoney = formatMoney;
  formatPct = formatPct;
  formatCat = formatCat;
}
