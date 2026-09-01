import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { BankAccount } from '../../../services/banking/banking.models';
import { BankAccountsService } from '../../../services/banking/bank-accounts.service';
import { formatCurrency } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

type AccountMeta = {
  last_txn_date?: string | null;
  stale?: boolean | number;
  is_credit_card?: boolean | number;
};

@Component({
  selector: 'app-banking-accounts',
  templateUrl: './banking-accounts.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-accounts.component.css'],
  standalone: false
})
export class BankingAccountsComponent implements OnInit, OnDestroy {
  showAccountForm = false;
  editingAccount: BankAccount | null = null;
  accountForm: Partial<BankAccount> = this.emptyAccountForm();

  readonly bankOptions = ['HDFC', 'ICICI', 'DCB', 'SBI', 'Axis', 'Kotak', 'Other'];
  readonly accountTypeOptions = [
    'Savings',
    'Current',
    'Salary',
    'Credit Card',
    'NRE',
    'NRO',
    'Fixed Deposit',
    'Other'
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
    private filters: BankingFilterState,
    private accountsService: BankAccountsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.ctx.loadAccounts();
    this.analyticsState.loadCashSummary();
    this.filters.refreshRequested$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.ctx.loadAccounts();
      this.analyticsState.loadCashSummary();
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  accountMeta(accountId: number): AccountMeta {
    const row = (this.analyticsState.cashSummary?.accounts || []).find((a) => a.id === accountId);
    return row || {};
  }

  isCreditCard(account: BankAccount): boolean {
    const meta = this.accountMeta(account.id);
    if (meta.is_credit_card != null) return !!meta.is_credit_card;
    return String(account.account_type || '').toLowerCase().includes('credit');
  }

  isStaleAccount(account: BankAccount): boolean {
    if (account.is_active === 0 || account.is_active === false) return false;
    if (this.isCreditCard(account)) return false;
    return !!this.accountMeta(account.id).stale;
  }

  ccNeedsStatement(account: BankAccount): boolean {
    if (!this.isCreditCard(account) || account.is_active === 0 || account.is_active === false) {
      return false;
    }
    const last = this.accountMeta(account.id).last_txn_date;
    if (!last) return true;
    const d = new Date(`${String(last).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return true;
    return (Date.now() - d.getTime()) / 86400000 > 90;
  }

  viewTransactions(account: BankAccount) {
    this.filters.filterAccountId = account.id;
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
  }

  openContinuity(account: BankAccount) {
    this.router.navigate(['/banking/insights'], {
      queryParams: { workflow: 'quality', accountId: account.id }
    });
  }

  openImport(account?: BankAccount) {
    if (account) {
      this.filters.filterAccountId = account.id;
      this.filters.notifyChanged();
    }
    this.router.navigate(['/banking/import']);
  }

  emptyAccountForm(): Partial<BankAccount> {
    return {
      bank_name: 'HDFC',
      account_name: '',
      account_number: '',
      branch: '',
      ifsc: '',
      account_type: 'Savings',
      currency: 'INR',
      opening_balance: 0,
      notes: '',
      is_active: 1
    };
  }

  openCreateAccount() {
    this.editingAccount = null;
    this.accountForm = this.emptyAccountForm();
    this.showAccountForm = true;
  }

  openEditAccount(account: BankAccount) {
    this.editingAccount = account;
    this.accountForm = { ...account };
    this.showAccountForm = true;
  }

  saveAccount() {
    if (!this.accountForm.bank_name || !this.accountForm.account_name) {
      this.ctx.flash('error', 'Bank name and account name are required');
      return;
    }
    const req = this.editingAccount
      ? this.accountsService.updateAccount(this.editingAccount.id, this.accountForm)
      : this.accountsService.createAccount(this.accountForm);

    req.subscribe({
      next: () => {
        this.showAccountForm = false;
        this.ctx.flash('success', this.editingAccount ? 'Account updated' : 'Account created');
        this.ctx.refreshCore();
        this.analyticsState.loadCashSummary();
        this.filters.requestRefresh();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Save failed')
    });
  }

  deleteAccount(account: BankAccount) {
    if (!confirm(`Delete ${account.bank_name} – ${account.account_name} and all its transactions?`)) return;
    this.accountsService.deleteAccount(account.id).subscribe({
      next: () => {
        this.ctx.flash('success', 'Account deleted');
        this.ctx.refreshCore();
        this.analyticsState.loadCashSummary();
        this.filters.requestRefresh();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Delete failed')
    });
  }

  formatCurrency = formatCurrency;
}
