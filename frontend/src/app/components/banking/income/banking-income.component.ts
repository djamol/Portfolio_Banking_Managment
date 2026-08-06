import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { Subject, merge, takeUntil } from 'rxjs';
import { DEFAULT_BANK_CATEGORIES } from '../../../services/banking/banking.models';
import {
  defaultIncomeCategories,
  matchSelectedCategories,
  rollupCategoryMonthRows
} from '../../../utils/category-rollup.util';
import { formatCategoryLabel } from '../../../utils/category-tree.util';
import { BANK_CHART_COLORS, doughnutOptions, netLineOptions } from '../shared/banking-chart.util';
import { formatCat, formatMoney, formatPct } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

const INCOME_CATS_KEY = 'bank-income-categories';

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

  incomeCategories: string[] = [];
  incomeChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  incomeTrendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  incomeTableRows: IncomeTableRow[] = [];
  totalIncome = 0;
  totalTxnCount = 0;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
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
    this.analyticsState.loadAnalytics(() => this.rebuildIncomeViews());
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.analyticsState.loadAnalytics(() => this.rebuildIncomeViews());
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get incomePickerOptions(): string[] {
    const fromAnalytics = this.analyticsState.analytics?.categories || [];
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
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Showing transactions for ${row.label}`);
  }

  rebuildIncomeViews() {
    const analytics = this.analyticsState.analytics;
    if (!analytics) {
      this.incomeTableRows = [];
      this.totalIncome = 0;
      this.totalTxnCount = 0;
      this.incomeChartData = { labels: [], datasets: [] };
      this.incomeTrendChartData = { labels: [], datasets: [] };
      return;
    }

    const selected = this.incomeCategories;
    if (!selected.length) {
      this.incomeTableRows = [];
      this.totalIncome = 0;
      this.totalTxnCount = 0;
      this.incomeChartData = { labels: [], datasets: [] };
      this.incomeTrendChartData = { labels: [], datasets: [] };
      return;
    }

    const byCategory = (analytics.byCategory || []) as Array<{
      category: string;
      txn_count: number;
      total_debit: number;
      total_credit: number;
    }>;

    const matched = byCategory.filter(
      (r) => matchSelectedCategories(r.category, selected) && Number(r.total_credit) > 0
    );

    this.totalIncome = matched.reduce((s, r) => s + (Number(r.total_credit) || 0), 0);
    this.totalTxnCount = matched.reduce((s, r) => s + (Number(r.txn_count) || 0), 0);

    this.incomeTableRows = matched
      .map((r) => ({
        category: r.category,
        label: formatCategoryLabel(r.category),
        total_credit: Number(r.total_credit) || 0,
        txn_count: Number(r.txn_count) || 0,
        pct: this.totalIncome ? ((Number(r.total_credit) || 0) / this.totalIncome) * 100 : 0,
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

    const catMonth = (analytics.byCategoryMonth || []).filter((r: any) =>
      matchSelectedCategories(r.category, selected)
    );
    const rolled = rollupCategoryMonthRows(catMonth, 'leaf');
    const byMonth = new Map<string, number>();
    for (const row of rolled) {
      byMonth.set(row.month, (byMonth.get(row.month) || 0) + (Number(row.total_credit) || 0));
    }
    const monthLabels = [...byMonth.keys()].sort().slice(-24);
    this.incomeTrendChartData = {
      labels: monthLabels,
      datasets: [{
        label: 'Income',
        data: monthLabels.map((m) => byMonth.get(m) || 0),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    };
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
