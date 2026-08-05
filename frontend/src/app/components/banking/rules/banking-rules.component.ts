import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { CategoryRule } from '../../../services/banking/banking.models';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import { BankTransactionsService } from '../../../services/banking/bank-transactions.service';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-rules',
  templateUrl: './banking-rules.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-rules.component.css'],
  standalone: false
})
export class BankingRulesComponent implements OnInit, OnDestroy {
  rules: CategoryRule[] = [];
  ruleForm: CategoryRule = {
    pattern: '',
    match_field: 'narration',
    category: '',
    priority: 100,
    account_id: null,
    is_active: 1
  };
  showRuleForm = false;
  editingRuleId: number | null = null;
  recategorizeMode: 'auto_only' | 'uncategorized' | 'all' = 'auto_only';

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    private filters: BankingFilterState,
    private rulesService: BankRulesService,
    private txnService: BankTransactionsService,
    private analyticsState: BankingAnalyticsState
  ) {}

  ngOnInit() {
    this.loadRules();
    this.filters.refreshRequested$.pipe(takeUntil(this.destroy$)).subscribe(() => this.loadRules());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadRules() {
    this.rulesService.getRules().subscribe({
      next: (rows) => (this.rules = rows),
      error: () => (this.rules = [])
    });
  }

  openRuleForm() {
    this.editingRuleId = null;
    this.ruleForm = {
      pattern: '',
      match_field: 'narration',
      category: '',
      priority: 100,
      account_id: null,
      is_active: 1
    };
    this.showRuleForm = true;
  }

  editRule(rule: CategoryRule) {
    this.editingRuleId = rule.id || null;
    this.ruleForm = {
      pattern: rule.pattern,
      match_field: rule.match_field || 'narration',
      category: rule.category,
      priority: rule.priority ?? 100,
      account_id: rule.account_id ?? null,
      is_active: rule.is_active === 0 || rule.is_active === false ? 0 : 1
    };
    this.showRuleForm = true;
  }

  saveRule() {
    if (!this.ruleForm.pattern || !this.ruleForm.category) {
      this.ctx.flash('error', 'Pattern and category are required');
      return;
    }
    const payload: CategoryRule = {
      ...this.ruleForm,
      account_id: this.ruleForm.account_id || null,
      is_active: this.ruleForm.is_active === 0 || this.ruleForm.is_active === false ? 0 : 1
    };
    const wasEdit = !!this.editingRuleId;
    const req$ = this.editingRuleId
      ? this.rulesService.updateRule(this.editingRuleId, payload)
      : this.rulesService.createRule(payload);
    req$.subscribe({
      next: () => {
        this.showRuleForm = false;
        this.editingRuleId = null;
        this.ctx.flash('success', wasEdit ? 'Rule updated' : 'Rule created');
        this.loadRules();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Failed to save rule')
    });
  }

  toggleRuleActive(rule: CategoryRule) {
    if (!rule.id) return;
    const nextActive = rule.is_active === 0 || rule.is_active === false ? 1 : 0;
    this.rulesService
      .updateRule(rule.id, {
        pattern: rule.pattern,
        match_field: rule.match_field || 'narration',
        category: rule.category,
        priority: rule.priority ?? 100,
        account_id: rule.account_id ?? null,
        is_active: nextActive
      })
      .subscribe({
        next: () => {
          this.ctx.flash('success', nextActive ? 'Rule activated' : 'Rule deactivated');
          this.loadRules();
        },
        error: (err) => this.ctx.flash('error', err.message || 'Failed to update rule')
      });
  }

  deleteRule(rule: CategoryRule) {
    if (!rule.id || !confirm(`Delete rule "${rule.pattern}" → ${rule.category}?`)) return;
    this.rulesService.deleteRule(rule.id).subscribe({
      next: () => {
        this.ctx.flash('success', 'Rule deleted');
        this.loadRules();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Delete failed')
    });
  }

  isRuleActive(rule: CategoryRule): boolean {
    return !(rule.is_active === 0 || rule.is_active === false);
  }

  recategorize() {
    this.txnService
      .recategorize(
        this.filters.filterAccountId ? Number(this.filters.filterAccountId) : undefined,
        this.recategorizeMode
      )
      .subscribe({
        next: (n) => {
          this.ctx.flash(
            'success',
            `Auto-categorized ${n} transactions (${this.recategorizeMode.replace('_', ' ')})`
          );
          this.analyticsState.loadAnalytics();
          this.filters.requestRefresh();
        },
        error: (err) => this.ctx.flash('error', err.message || 'Recategorize failed')
      });
  }
}
