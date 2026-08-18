import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankBudget } from '../../../services/banking/banking.models';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import {
  barOptions,
  doughnutOptions
} from '../shared/banking-chart.util';
import {
  formatCurrency,
  formatMoney
} from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-overview',
  templateUrl: './banking-overview.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-overview.component.css'],
  standalone: false
})
export class BankingOverviewComponent implements OnInit, OnDestroy {
  budgets: BankBudget[] = [];
  budgetMonth = new Date().toISOString().slice(0, 7);
  forecast: any = null;
  budgetForm: BankBudget = {
    category: '',
    amount: 0,
    period_month: new Date().toISOString().slice(0, 7),
    account_id: null,
    notes: ''
  };

  readonly doughnutOptions = doughnutOptions;
  readonly barOptions = barOptions;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
    private filters: BankingFilterState,
    private rulesService: BankRulesService,
    private analyticsService: BankAnalyticsService
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

  loadForecast() {
    const accountId = this.filters.filterAccountId ? Number(this.filters.filterAccountId) : undefined;
    this.analyticsService.getForecast(accountId).subscribe({
      next: (data) => (this.forecast = data),
      error: () => (this.forecast = null)
    });
  }

  loadBudgets() {
    const month = this.budgetMonth || new Date().toISOString().slice(0, 7);
    this.budgetForm.period_month = this.budgetForm.period_month || month;
    this.rulesService
      .getBudgetStatus(month, { exclude_transfers: this.filters.excludeTransfers })
      .subscribe({
        next: (rows) => (this.budgets = rows),
        error: () => (this.budgets = [])
      });
  }

  onBudgetMonthChange() {
    this.budgetForm.period_month = this.budgetMonth;
    this.loadBudgets();
  }

  saveBudget() {
    if (!this.budgetForm.category || !this.budgetForm.amount) {
      this.ctx.flash('error', 'Category and amount required');
      return;
    }
    const payload: BankBudget = {
      ...this.budgetForm,
      period_month: this.budgetForm.period_month || this.budgetMonth,
      account_id: this.budgetForm.account_id || null,
      notes: this.budgetForm.notes || null
    };
    this.rulesService.saveBudget(payload).subscribe({
      next: () => {
        this.ctx.flash('success', 'Budget saved');
        this.budgetForm = {
          category: '',
          amount: 0,
          period_month: this.budgetMonth,
          account_id: null,
          notes: ''
        };
        this.loadBudgets();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Budget save failed')
    });
  }

  deleteBudget(b: BankBudget) {
    if (!b.id || !confirm(`Delete budget for ${b.category}?`)) return;
    this.rulesService.deleteBudget(b.id).subscribe({
      next: () => {
        this.loadBudgets();
        this.ctx.flash('success', 'Budget deleted');
      },
      error: (err) => this.ctx.flash('error', err.message || 'Delete failed')
    });
  }

  totalBalance(): number {
    return this.ctx.activeAccounts.reduce((s, a) => s + (Number(a.latest_balance) || 0), 0);
  }

  budgetBarWidth(pct: number | null | undefined): number {
    const n = Number(pct) || 0;
    return Math.max(0, Math.min(100, n));
  }

  formatMoney = formatMoney;
  formatCurrency = formatCurrency;
}
