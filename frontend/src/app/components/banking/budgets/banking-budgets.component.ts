import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankBudget } from '../../../services/banking/banking.models';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import { formatCat, formatMoney } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-budgets',
  templateUrl: './banking-budgets.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-budgets.component.css'],
  standalone: false
})
export class BankingBudgetsComponent implements OnInit, OnDestroy {
  budgets: BankBudget[] = [];
  budgetMonth = new Date().toISOString().slice(0, 7);
  editingId: number | null = null;
  budgetForm: BankBudget = this.emptyForm();
  copying = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public filters: BankingFilterState,
    private rulesService: BankRulesService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadBudgets();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadBudgets());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  emptyForm(): BankBudget {
    return {
      category: '',
      amount: 0,
      period_month: this.budgetMonth || new Date().toISOString().slice(0, 7),
      account_id: null,
      notes: ''
    };
  }

  previousMonth(): string {
    return this.filters.shiftMonthKey(this.budgetMonth, -1);
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
    if (!this.editingId) {
      this.budgetForm.period_month = this.budgetMonth;
    }
    this.loadBudgets();
  }

  startEdit(b: BankBudget, event?: Event) {
    event?.stopPropagation();
    if (!b.id) return;
    this.editingId = b.id;
    this.budgetForm = {
      id: b.id,
      category: b.category,
      amount: Number(b.amount) || 0,
      period_month: b.period_month || this.budgetMonth,
      account_id: b.account_id ?? null,
      notes: b.notes || ''
    };
  }

  cancelEdit() {
    this.editingId = null;
    this.budgetForm = this.emptyForm();
  }

  saveBudget() {
    if (!this.budgetForm.category || this.budgetForm.amount == null) {
      this.ctx.flash('error', 'Category and amount required');
      return;
    }
    const payload: BankBudget = {
      ...this.budgetForm,
      period_month: this.budgetForm.period_month || this.budgetMonth,
      account_id: this.budgetForm.account_id || null,
      notes: this.budgetForm.notes || null
    };
    const req$ =
      this.editingId != null
        ? this.rulesService.updateBudget(this.editingId, payload)
        : this.rulesService.saveBudget(payload);
    req$.subscribe({
      next: () => {
        this.ctx.flash('success', this.editingId != null ? 'Budget updated' : 'Budget saved');
        this.cancelEdit();
        this.loadBudgets();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Budget save failed')
    });
  }

  deleteBudget(b: BankBudget, event?: Event) {
    event?.stopPropagation();
    if (!b.id || !confirm(`Delete budget for ${b.category}?`)) return;
    this.rulesService.deleteBudget(b.id).subscribe({
      next: () => {
        if (this.editingId === b.id) this.cancelEdit();
        this.loadBudgets();
        this.ctx.flash('success', 'Budget deleted');
      },
      error: (err) => this.ctx.flash('error', err.message || 'Delete failed')
    });
  }

  copyFromPreviousMonth() {
    const from = this.previousMonth();
    const to = this.budgetMonth;
    if (
      !confirm(
        `Copy budgets from ${from} into ${to}? Categories that already exist this month are kept as-is.`
      )
    ) {
      return;
    }
    this.copying = true;
    this.rulesService.copyBudgets(from, to).subscribe({
      next: (r) => {
        this.copying = false;
        if (!r.source_count) {
          this.ctx.flash('info', `No budgets found for ${from}`);
          return;
        }
        this.ctx.flash('success', `Copied ${r.copied} budget(s), skipped ${r.skipped} existing`);
        this.loadBudgets();
      },
      error: (err) => {
        this.copying = false;
        this.ctx.flash('error', err.message || 'Copy failed');
      }
    });
  }

  openBudgetTxns(b: BankBudget) {
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
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Showing ${formatCat(b.category)} for ${month}`);
  }

  budgetBarWidth(pct: number | null | undefined): number {
    const n = Number(pct) || 0;
    return Math.max(0, Math.min(100, n));
  }

  overspendCount(): number {
    return this.budgets.filter((b) => (Number(b.pct) || 0) >= 100).length;
  }

  totalBudgeted(): number {
    return this.budgets.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  }

  totalSpent(): number {
    return this.budgets.reduce((s, b) => s + (Number(b.spent) || 0), 0);
  }

  totalRemaining(): number {
    return this.totalBudgeted() - this.totalSpent();
  }

  formatMoney = formatMoney;
  formatCat = formatCat;
}
