import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankAccount } from '../../../services/banking/banking.models';
import { BankAccountsService } from '../../../services/banking/bank-accounts.service';
import { formatCurrency } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

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

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    private filters: BankingFilterState,
    private accountsService: BankAccountsService
  ) {}

  ngOnInit() {
    this.ctx.loadAccounts();
    this.filters.refreshRequested$.pipe(takeUntil(this.destroy$)).subscribe(() => this.ctx.loadAccounts());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  emptyAccountForm(): Partial<BankAccount> {
    return {
      bank_name: 'HDFC',
      account_name: '',
      account_number: '',
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
        this.filters.requestRefresh();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Delete failed')
    });
  }

  formatCurrency = formatCurrency;
}
