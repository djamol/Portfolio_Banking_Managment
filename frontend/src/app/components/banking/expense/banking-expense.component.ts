import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { DEFAULT_BANK_CATEGORIES } from '../../../services/banking/banking.models';
import {
  defaultExpenseCategories,
  matchSelectedCategories,
  rollupCategoryMonthRows
} from '../../../utils/category-rollup.util';
import { formatCategoryLabel } from '../../../utils/category-tree.util';
import { BANK_CHART_COLORS, doughnutOptions, netLineOptions } from '../shared/banking-chart.util';
import { formatCat, formatMoney, formatPct } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

const EXPENSE_CATS_KEY = 'bank-expense-categories';

export type ExpenseTableRow = {
  category: string;
  label: string;
  total_debit: number;
  txn_count: number;
  pct: number;
  leaves: string[];
};

@Component({
  selector: 'app-banking-expense',
  templateUrl: './banking-expense.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-expense.component.css'],
  standalone: false
})
export class BankingExpenseComponent implements OnInit, OnDestroy {
  readonly doughnutOptions = doughnutOptions;
  readonly netLineOptions = netLineOptions;

  /** Debit-only analytics payload (does not share Charts/Summary state). */
  expenseAnalytics: any = null;
  expenseCategories: string[] = [];
  expenseChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  expenseTrendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  expenseTableRows: ExpenseTableRow[] = [];
  totalExpense = 0;
  totalTxnCount = 0;
  loading = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    private analyticsService: BankAnalyticsService,
    private filters: BankingFilterState,
    private router: Router
  ) {}

  ngOnInit() {
    const saved = this.loadSavedExpenseCategories();
    this.expenseCategories =
      saved === null ? defaultExpenseCategories(this.expensePickerOptions) : saved;
    if (saved === null && this.expenseCategories.length) {
      this.persistExpenseCategories();
    }
    this.loadExpenseAnalytics();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadExpenseAnalytics());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Fetch analytics with flow=debit so category totals are withdrawals only.
   * Income categories with only deposits will not contribute amounts.
   */
  private loadExpenseAnalytics() {
    this.loading = true;
    this.analyticsService
      .getAnalytics({ ...this.filters.buildSharedFilters(), flow: 'debit' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.expenseAnalytics = data;
          if (data?.categories?.length) {
            this.ctx.mergeCategories(data.categories);
          }
          this.rebuildExpenseViews();
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.ctx.flash('error', err.message || 'Failed to load expense analytics');
        }
      });
  }

  get expensePickerOptions(): string[] {
    const fromAnalytics = this.expenseAnalytics?.categories || [];
    return [...new Set([...DEFAULT_BANK_CATEGORIES, ...this.ctx.categories, ...fromAnalytics])].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  onExpenseCategoriesChange(selected: string[]) {
    this.expenseCategories = selected || [];
    this.persistExpenseCategories();
    this.rebuildExpenseViews();
  }

  resetExpenseDefaults() {
    this.expenseCategories = defaultExpenseCategories(this.expensePickerOptions);
    this.persistExpenseCategories();
    this.rebuildExpenseViews();
  }

  openExpenseCategory(row: ExpenseTableRow) {
    const leaves = row.leaves.length ? row.leaves : [row.category];
    this.filters.filterCategories = [...leaves];
    this.filters.filterCategory = leaves.length === 1 ? leaves[0] : '';
    this.filters.filterFlow = 'debit';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Showing debit transactions for ${row.label}`);
  }

  rebuildExpenseViews() {
    const analytics = this.expenseAnalytics;
    if (!analytics) {
      this.clearViews();
      return;
    }

    const selected = this.expenseCategories;
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

    // Debits only — never use total_credit even if income categories are selected.
    const matched = byCategory
      .map((r) => ({
        category: r.category,
        txn_count: Number(r.txn_count) || 0,
        total_debit: Number(r.total_debit) || 0
      }))
      .filter((r) => matchSelectedCategories(r.category, selected) && r.total_debit > 0);

    this.totalExpense = matched.reduce((s, r) => s + r.total_debit, 0);
    this.totalTxnCount = matched.reduce((s, r) => s + r.txn_count, 0);

    this.expenseTableRows = matched
      .map((r) => ({
        category: r.category,
        label: formatCategoryLabel(r.category),
        total_debit: r.total_debit,
        txn_count: r.txn_count,
        pct: this.totalExpense ? (r.total_debit / this.totalExpense) * 100 : 0,
        leaves: [r.category]
      }))
      .sort((a, b) => b.total_debit - a.total_debit);

    const chartRows = this.expenseTableRows.slice(0, 12);
    this.expenseChartData = {
      labels: chartRows.map((r) => r.label),
      datasets: [{
        data: chartRows.map((r) => r.total_debit),
        backgroundColor: BANK_CHART_COLORS
      }]
    };

    const catMonth = (analytics.byCategoryMonth || [])
      .filter((r: any) => matchSelectedCategories(r.category, selected))
      .map((r: any) => ({
        month: r.month,
        category: r.category,
        txn_count: Number(r.txn_count) || 0,
        total_debit: Number(r.total_debit) || 0,
        total_credit: 0
      }))
      .filter((r: { total_debit: number }) => r.total_debit > 0);
    const rolled = rollupCategoryMonthRows(catMonth, 'leaf');
    const byMonth = new Map<string, number>();
    for (const row of rolled) {
      byMonth.set(row.month, (byMonth.get(row.month) || 0) + (Number(row.total_debit) || 0));
    }
    const monthLabels = [...byMonth.keys()].sort().slice(-24);
    this.expenseTrendChartData = {
      labels: monthLabels,
      datasets: [{
        label: 'Expense (debits)',
        data: monthLabels.map((m) => byMonth.get(m) || 0),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    };
  }

  private clearViews() {
    this.expenseTableRows = [];
    this.totalExpense = 0;
    this.totalTxnCount = 0;
    this.expenseChartData = { labels: [], datasets: [] };
    this.expenseTrendChartData = { labels: [], datasets: [] };
  }

  /** null = never saved (use defaults); array = explicit user selection */
  private loadSavedExpenseCategories(): string[] | null {
    try {
      const raw = localStorage.getItem(EXPENSE_CATS_KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return null;
    }
  }

  private persistExpenseCategories() {
    localStorage.setItem(EXPENSE_CATS_KEY, JSON.stringify(this.expenseCategories));
  }

  formatMoney = formatMoney;
  formatPct = formatPct;
  formatCat = formatCat;
}
