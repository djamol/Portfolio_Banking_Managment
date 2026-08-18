import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankBudget } from '../../../services/banking/banking.models';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import { barOptions, doughnutOptions } from '../shared/banking-chart.util';
import { formatCat, formatCurrency, formatMoney, formatPct } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

type ForecastOutflow = {
  payee?: string;
  amount?: number;
  next_expected?: string;
  category?: string | null;
};

type ForecastNextMonth = {
  month?: string;
  avg_credit?: number;
  avg_debit?: number;
  net?: number;
  projected_interest?: number;
};

type ForecastResponse = {
  projected_next_month?: ForecastNextMonth;
  upcoming_outflows?: ForecastOutflow[];
};

@Component({
  selector: 'app-banking-overview',
  templateUrl: './banking-overview.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-overview.component.css'],
  standalone: false
})
export class BankingOverviewComponent implements OnInit, OnDestroy {
  budgets: BankBudget[] = [];
  budgetMonth = new Date().toISOString().slice(0, 7);
  forecast: ForecastResponse | null = null;

  readonly doughnutOptions = doughnutOptions;
  readonly barOptions = barOptions;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
    public filters: BankingFilterState,
    private rulesService: BankRulesService,
    private analyticsService: BankAnalyticsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadPage();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadPage());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPage() {
    this.analyticsState.loadAnalytics();
    this.analyticsState.loadCashSummary();
    this.loadBudgets();
    this.loadForecast();
  }

  get projectedNextMonth(): ForecastNextMonth | null {
    return this.forecast?.projected_next_month || null;
  }

  get upcomingOutflows(): ForecastOutflow[] {
    return (this.forecast?.upcoming_outflows || []).slice(0, 5);
  }

  get summary() {
    return this.analyticsState.analytics?.summary || {};
  }

  get needsReviewCount(): number {
    return Number(this.summary.uncategorized_count) || 0;
  }

  get overspentBudgets(): BankBudget[] {
    return this.budgets.filter((b) => (Number(b.pct) || 0) >= 100);
  }

  get warnBudgets(): BankBudget[] {
    return this.budgets.filter((b) => {
      const pct = Number(b.pct) || 0;
      return pct >= 80 && pct < 100;
    });
  }

  get topExpenses(): any[] {
    return (this.analyticsState.analytics?.topExpenses || []).slice(0, 6);
  }

  get mom() {
    return this.analyticsState.analytics?.mom || null;
  }

  get showActionInbox(): boolean {
    return (
      this.needsReviewCount > 0 ||
      this.overspentBudgets.length > 0 ||
      this.warnBudgets.length > 0 ||
      this.upcomingOutflows.length > 0
    );
  }

  loadForecast() {
    const accountId = this.filters.filterAccountId ? Number(this.filters.filterAccountId) : undefined;
    this.analyticsService.getForecast(accountId).subscribe({
      next: (data) => (this.forecast = data),
      error: () => (this.forecast = null)
    });
  }

  loadBudgets() {
    const month = this.budgetMonth || new Date().toISOString().slice(0, 7);
    this.rulesService
      .getBudgetStatus(month, { exclude_transfers: this.filters.excludeTransfers })
      .subscribe({
        next: (rows) => (this.budgets = rows),
        error: () => (this.budgets = [])
      });
  }

  onBudgetMonthChange() {
    this.loadBudgets();
  }

  totalBalance(): number {
    return this.ctx.activeAccounts.reduce((s, a) => s + (Number(a.latest_balance) || 0), 0);
  }

  budgetBarWidth(pct: number | null | undefined): number {
    const n = Number(pct) || 0;
    return Math.max(0, Math.min(100, n));
  }

  openNeedsReview() {
    this.filters.applyQuickFilter('uncategorized');
    this.goToTransactions('Showing transactions that need review');
  }

  openFlow(kind: 'debit' | 'credit') {
    this.filters.applyQuickFilter(kind);
    this.goToTransactions(kind === 'debit' ? 'Showing debits' : 'Showing credits');
  }

  openInterest() {
    this.filters.applyQuickFilter('interest', this.ctx.categories);
    this.goToTransactions('Showing interest transactions');
  }

  openThisMonth() {
    this.filters.applyDatePreset('tm');
    this.ctx.flash('info', 'Filtered to this calendar month');
  }

  openMomMonth() {
    const month = this.mom?.current_month;
    if (!month) return;
    this.filters.applyMonthKey(month);
    this.goToTransactions(`Showing ${month}`);
  }

  openAccount(accountId: number) {
    this.filters.applyAccountFilter(accountId);
    this.goToTransactions('Filtered to that account');
  }

  openBudget(b: BankBudget) {
    const month = b.period_month || this.budgetMonth;
    this.filters.filterCategories = [b.category];
    this.filters.filterCategory = b.category;
    this.filters.filterNeedsReview = false;
    this.filters.filterTransfersOnly = false;
    this.filters.filterFlow = 'debit';
    this.filters.filterQ = '';
    this.filters.filterPayee = '';
    if (b.account_id) this.filters.filterAccountId = b.account_id;
    this.filters.applyMonthKey(month);
    this.goToTransactions(`Showing ${formatCat(b.category)} for ${month}`);
  }

  openTxnContext(t: { txn_date?: string; payee?: string; narration?: string; category?: string }) {
    const date = String(t.txn_date || '').slice(0, 10);
    const q = String(t.payee || t.narration || '').trim().slice(0, 48);
    if (date) {
      this.filters.applyTxnDay(date, q);
      this.goToTransactions(`Showing ${date}`);
      return;
    }
    if (t.category) {
      this.filters.filterCategories = [t.category];
      this.filters.filterCategory = t.category;
      this.filters.filterOffset = 0;
      this.filters.notifyChanged();
      this.goToTransactions(`Filtered by ${formatCat(t.category)}`);
    }
  }

  openPayee(payee?: string) {
    if (!payee) return;
    this.filters.applyPayeeFilter(payee);
    this.goToTransactions(`Filtered by payee: ${payee}`);
  }

  private goToTransactions(message: string) {
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', message);
  }

  formatMoney = formatMoney;
  formatCurrency = formatCurrency;
  formatPct = formatPct;
  formatCat = formatCat;
}
