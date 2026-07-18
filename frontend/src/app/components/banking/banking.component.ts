import { Component, OnInit } from '@angular/core';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import {
  BankAccount,
  BankingService,
  BankTransaction
} from '../../services/banking.service';

type TabId = 'overview' | 'accounts' | 'import' | 'transactions' | 'analytics';

@Component({
  selector: 'app-banking',
  templateUrl: './banking.component.html',
  styleUrls: ['./banking.component.css'],
  standalone: false
})
export class BankingComponent implements OnInit {
  activeTab: TabId = 'overview';
  loading = false;
  message = '';
  messageType: 'success' | 'error' | 'info' = 'info';

  accounts: BankAccount[] = [];
  transactions: BankTransaction[] = [];
  txnTotal = 0;
  categories: string[] = [];
  analytics: any = null;

  // filters
  filterAccountId: number | '' = '';
  filterFrom = '';
  filterTo = '';
  filterCategory = '';
  filterFlow = '';
  filterQ = '';
  filterLimit = 100;

  // account form
  showAccountForm = false;
  editingAccount: BankAccount | null = null;
  accountForm: Partial<BankAccount> = this.emptyAccountForm();

  // import
  importAccountId: number | '' = '';
  importBankHint = '';
  importFile: File | null = null;
  importPreview: any = null;
  importing = false;
  lastImportResult: any = null;

  // selection / categorize
  selectedIds = new Set<number>();
  bulkCategory = '';

  categoryChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  monthlyChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  balanceChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };

  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = Number(ctx.parsed) || 0;
            return `${ctx.label}: ₹${value.toLocaleString('en-IN')}`;
          }
        }
      }
    }
  };

  barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: {
        ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
      }
    }
  };

  lineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
      }
    }
  };

  readonly bankOptions = ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'Other'];
  readonly defaultCategories = [
    'Interest Income',
    'TDS / Tax',
    'Fixed Deposit',
    'Salary / Income',
    'UPI',
    'ATM / Cash',
    'Card Payment',
    'Bill Payment',
    'Recharge',
    'Shopping / Online',
    'Investment / Broker',
    'Transfer In',
    'Transfer Out',
    'Cheque',
    'Bank Charges',
    'PayPal / International',
    'Income / Credit',
    'Expense / Debit',
    'Uncategorized'
  ];

  constructor(private bankingService: BankingService) {}

  ngOnInit() {
    this.refreshAll();
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

  setTab(tab: TabId) {
    this.activeTab = tab;
    if (tab === 'transactions') this.loadTransactions();
    if (tab === 'analytics' || tab === 'overview') this.loadAnalytics();
  }

  refreshAll() {
    this.loading = true;
    this.message = '';
    let pending = 3;
    const done = () => {
      pending -= 1;
      if (pending <= 0) this.loading = false;
    };

    this.bankingService.getAccounts().subscribe({
      next: (rows) => {
        this.accounts = rows;
        if (!this.importAccountId && rows.length) this.importAccountId = rows[0].id;
        done();
      },
      error: (err) => {
        this.flash('error', err.message || 'Failed to load accounts');
        done();
      }
    });

    this.bankingService.getCategories().subscribe({
      next: (cats) => {
        this.categories = [...new Set([...this.defaultCategories, ...cats])].sort();
        done();
      },
      error: () => done()
    });

    this.loadAnalytics(done);
  }

  loadTransactions(done?: () => void) {
    const filters: Record<string, any> = {
      limit: this.filterLimit,
      offset: 0
    };
    if (this.filterAccountId) filters['account_id'] = this.filterAccountId;
    if (this.filterFrom) filters['from'] = this.filterFrom;
    if (this.filterTo) filters['to'] = this.filterTo;
    if (this.filterCategory) filters['category'] = this.filterCategory;
    if (this.filterFlow) filters['flow'] = this.filterFlow;
    if (this.filterQ) filters['q'] = this.filterQ;

    this.bankingService.getTransactions(filters).subscribe({
      next: (res) => {
        this.transactions = res.rows;
        this.txnTotal = res.total;
        this.selectedIds.clear();
        done?.();
      },
      error: (err) => {
        this.flash('error', err.message || 'Failed to load transactions');
        done?.();
      }
    });
  }

  loadAnalytics(done?: () => void) {
    const filters: Record<string, any> = {};
    if (this.filterAccountId) filters['account_id'] = this.filterAccountId;
    if (this.filterFrom) filters['from'] = this.filterFrom;
    if (this.filterTo) filters['to'] = this.filterTo;

    this.bankingService.getAnalytics(filters).subscribe({
      next: (data) => {
        this.analytics = data;
        this.buildCharts();
        if (data?.categories?.length) {
          this.categories = [...new Set([...this.defaultCategories, ...data.categories])].sort();
        }
        done?.();
      },
      error: (err) => {
        this.flash('error', err.message || 'Failed to load analytics');
        done?.();
      }
    });
  }

  buildCharts() {
    if (!this.analytics) return;

    const cats = (this.analytics.byCategory || []).slice(0, 10);
    this.categoryChartData = {
      labels: cats.map((c: any) => c.category),
      datasets: [{
        data: cats.map((c: any) => Number(c.total_debit) + Number(c.total_credit)),
        backgroundColor: [
          '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
          '#06b6d4', '#ec4899', '#22c55e', '#a855f7', '#64748b'
        ]
      }]
    };

    const months = this.analytics.byMonth || [];
    this.monthlyChartData = {
      labels: months.map((m: any) => m.month),
      datasets: [
        {
          label: 'Credits',
          data: months.map((m: any) => Number(m.total_credit)),
          backgroundColor: 'rgba(16, 185, 129, 0.75)'
        },
        {
          label: 'Debits',
          data: months.map((m: any) => Number(m.total_debit)),
          backgroundColor: 'rgba(239, 68, 68, 0.75)'
        }
      ]
    };

    // Keep balance chart readable: sample last ~120 points
    const series = (this.analytics.balanceSeries || []).slice(-120);
    this.balanceChartData = {
      labels: series.map((p: any) => p.date),
      datasets: [{
        data: series.map((p: any) => Number(p.balance)),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 0
      }]
    };
  }

  applyFilters() {
    this.loadTransactions();
    this.loadAnalytics();
  }

  clearFilters() {
    this.filterAccountId = '';
    this.filterFrom = '';
    this.filterTo = '';
    this.filterCategory = '';
    this.filterFlow = '';
    this.filterQ = '';
    this.applyFilters();
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
      this.flash('error', 'Bank name and account name are required');
      return;
    }
    const req = this.editingAccount
      ? this.bankingService.updateAccount(this.editingAccount.id, this.accountForm)
      : this.bankingService.createAccount(this.accountForm);

    req.subscribe({
      next: () => {
        this.showAccountForm = false;
        this.flash('success', this.editingAccount ? 'Account updated' : 'Account created');
        this.refreshAll();
      },
      error: (err) => this.flash('error', err.message || 'Save failed')
    });
  }

  deleteAccount(account: BankAccount) {
    if (!confirm(`Delete ${account.bank_name} – ${account.account_name} and all its transactions?`)) return;
    this.bankingService.deleteAccount(account.id).subscribe({
      next: () => {
        this.flash('success', 'Account deleted');
        this.refreshAll();
      },
      error: (err) => this.flash('error', err.message || 'Delete failed')
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.importFile = input.files?.[0] || null;
    this.importPreview = null;
    this.lastImportResult = null;
  }

  previewImport() {
    if (!this.importFile) {
      this.flash('error', 'Choose a statement file first');
      return;
    }
    if (!this.importAccountId) {
      this.flash('error', 'Select a target account before preview');
      return;
    }
    this.importing = true;
    const account = this.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.importBankHint || account?.bank_name || '';
    this.bankingService
      .previewStatement(this.importFile, Number(this.importAccountId), hint || undefined)
      .subscribe({
        next: (data) => {
          this.importPreview = data;
          this.importing = false;
          const existing = data.existing_count ?? 0;
          const neu = data.new_count ?? data.count ?? 0;
          this.flash(
            'info',
            `${data.bank}: ${data.count} in file · ${existing} already exist · ${neu} new`
          );
        },
        error: (err) => {
          this.importing = false;
          this.flash('error', err.message || 'Preview failed');
        }
      });
  }

  runImport() {
    if (!this.importFile || !this.importAccountId) {
      this.flash('error', 'Select an account and a statement file');
      return;
    }
    this.importing = true;
    const account = this.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.importBankHint || account?.bank_name || '';
    this.bankingService.importStatement(Number(this.importAccountId), this.importFile, hint).subscribe({
      next: (data) => {
        this.lastImportResult = data;
        this.importing = false;
        this.flash(
          'success',
          `Imported ${data.inserted} new · skipped ${data.skipped} duplicates · parsed ${data.parsed}`
        );
        this.refreshAll();
        this.loadTransactions();
      },
      error: (err) => {
        this.importing = false;
        this.flash('error', err.message || 'Import failed');
      }
    });
  }

  toggleSelect(id: number) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  toggleSelectAll() {
    if (this.selectedIds.size === this.transactions.length) {
      this.selectedIds.clear();
      return;
    }
    this.transactions.forEach((t) => this.selectedIds.add(t.id));
  }

  applyBulkCategory() {
    if (!this.bulkCategory || !this.selectedIds.size) return;
    this.bankingService.bulkCategorize([...this.selectedIds], this.bulkCategory).subscribe({
      next: (n) => {
        this.flash('success', `Updated category on ${n} transactions`);
        this.loadTransactions();
        this.loadAnalytics();
      },
      error: (err) => this.flash('error', err.message || 'Bulk update failed')
    });
  }

  updateRowCategory(txn: BankTransaction, category: string) {
    this.bankingService.updateTransaction(txn.id, { category }).subscribe({
      next: () => {
        txn.category = category;
      },
      error: (err) => this.flash('error', err.message || 'Update failed')
    });
  }

  recategorize() {
    this.bankingService
      .recategorize(this.filterAccountId ? Number(this.filterAccountId) : undefined)
      .subscribe({
        next: (n) => {
          this.flash('success', `Auto-categorized ${n} transactions`);
          this.loadTransactions();
          this.loadAnalytics();
        },
        error: (err) => this.flash('error', err.message || 'Recategorize failed')
      });
  }

  deleteTxn(txn: BankTransaction) {
    if (!confirm('Delete this transaction?')) return;
    this.bankingService.deleteTransaction(txn.id).subscribe({
      next: () => {
        this.loadTransactions();
        this.loadAnalytics();
      },
      error: (err) => this.flash('error', err.message || 'Delete failed')
    });
  }

  totalBalance(): number {
    return this.accounts.reduce((s, a) => s + (Number(a.latest_balance) || 0), 0);
  }

  formatMoney(value: any): string {
    const n = Number(value) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  flash(type: 'success' | 'error' | 'info', text: string) {
    this.messageType = type;
    this.message = text;
  }

  maskAccount(num?: string | null): string {
    if (!num) return '—';
    const s = String(num);
    if (s.length <= 4) return s;
    return '••••' + s.slice(-4);
  }
}
