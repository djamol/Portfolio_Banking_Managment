import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankBudget } from '../../../services/banking/banking.models';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import { formatMoney } from '../shared/banking-format.util';
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

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    private filters: BankingFilterState,
    private rulesService: BankRulesService
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

  startEdit(b: BankBudget) {
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

  deleteBudget(b: BankBudget) {
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

  budgetBarWidth(pct: number | null | undefined): number {
    const n = Number(pct) || 0;
    return Math.max(0, Math.min(100, n));
  }

  overspendCount(): number {
    return this.budgets.filter((b) => (Number(b.pct) || 0) >= 100).length;
  }

  formatMoney = formatMoney;
}
