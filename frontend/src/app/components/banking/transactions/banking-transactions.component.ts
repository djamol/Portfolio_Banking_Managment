import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankImportService } from '../../../services/banking/bank-import.service';
import { BankTransaction } from '../../../services/banking/banking.models';
import { BankTransactionsService } from '../../../services/banking/bank-transactions.service';
import { formatCat, formatMoney, toIsoDate } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-transactions',
  templateUrl: './banking-transactions.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-transactions.component.css'],
  standalone: false
})
export class BankingTransactionsComponent implements OnInit, OnDestroy {
  transactions: BankTransaction[] = [];
  txnTotal = 0;
  txnTotals = { total_debit: 0, total_credit: 0, net_cashflow: 0 };
  txnLoading = false;
  exporting = false;

  selectedIds = new Set<number>();
  selectedSummaryCache = { count: 0, debit: 0, credit: 0 };
  categoryEditTxnId: number | null = null;
  bulkCategory = '';
  expandedTxnId: number | null = null;
  recategorizeMode: 'auto_only' | 'uncategorized' | 'all' = 'auto_only';
  jumpPage: number | null = null;

  showManualTxn = false;
  manualTxn: Partial<BankTransaction> = this.emptyManualTxn();

  readonly pageSizeOptions = [25, 50, 100, 200];
  readonly sortOptions = [
    { value: 'date_desc', label: 'Newest first' },
    { value: 'date_asc', label: 'Oldest first' },
    { value: 'debit_desc', label: 'Largest debit' },
    { value: 'debit_asc', label: 'Smallest debit' },
    { value: 'credit_desc', label: 'Largest credit' },
    { value: 'credit_asc', label: 'Smallest credit' },
    { value: 'amount_desc', label: 'Largest amount' },
    { value: 'amount_asc', label: 'Smallest amount' },
    { value: 'balance_desc', label: 'Balance high → low' },
    { value: 'balance_asc', label: 'Balance low → high' },
    { value: 'account_asc', label: 'Account A→Z' },
    { value: 'account_desc', label: 'Account Z→A' },
    { value: 'category_asc', label: 'Category A→Z' },
    { value: 'category_desc', label: 'Category Z→A' },
    { value: 'narration_asc', label: 'Narration A→Z' },
    { value: 'narration_desc', label: 'Narration Z→A' }
  ];
  readonly sortableColumns: Array<{ key: string; label: string; class?: string }> = [
    { key: 'date', label: 'Date' },
    { key: 'account', label: 'Account' },
    { key: 'narration', label: 'Narration' },
    { key: 'withdrawal', label: 'Withdrawal', class: 'num' },
    { key: 'deposit', label: 'Deposit', class: 'num' },
    { key: 'balance', label: 'Balance', class: 'num' },
    { key: 'category', label: 'Category' }
  ];
  private readonly columnSortKey: Record<string, string> = {
    date: 'date',
    account: 'account',
    narration: 'narration',
    withdrawal: 'debit',
    deposit: 'credit',
    balance: 'balance',
    category: 'category'
  };

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public filters: BankingFilterState,
    private txnService: BankTransactionsService,
    private importService: BankImportService,
    private analyticsState: BankingAnalyticsState
  ) {}

  ngOnInit() {
    this.loadTransactions();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadTransactions());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get currentPage(): number {
    return Math.floor(this.filters.filterOffset / this.filters.filterLimit) + 1;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.txnTotal / this.filters.filterLimit));
  }

  get pageFrom(): number {
    if (!this.txnTotal) return 0;
    return this.filters.filterOffset + 1;
  }

  get pageTo(): number {
    return Math.min(this.filters.filterOffset + this.transactions.length, this.txnTotal);
  }

  get sortColumn(): string {
    const base = this.filters.filterSort.replace(/_(asc|desc)$/, '');
    if (base === 'debit') return 'withdrawal';
    if (base === 'credit') return 'deposit';
    return base || 'date';
  }

  get sortDir(): 'asc' | 'desc' {
    return this.filters.filterSort.endsWith('_asc') ? 'asc' : 'desc';
  }

  get selectedSummary(): { count: number; debit: number; credit: number } {
    return this.selectedSummaryCache;
  }

  emptyManualTxn(): Partial<BankTransaction> {
    return {
      account_id: undefined,
      txn_date: toIsoDate(new Date()),
      narration: '',
      withdrawal: 0,
      deposit: 0,
      category: '',
      tags: '',
      notes: ''
    };
  }

  loadTransactions() {
    this.txnLoading = true;
    this.txnService.getTransactions(this.filters.buildTxnFilters()).subscribe({
      next: (res) => {
        this.transactions = res.rows;
        this.txnTotal = res.total;
        this.txnTotals = {
          total_debit: Number(res.total_debit) || 0,
          total_credit: Number(res.total_credit) || 0,
          net_cashflow: Number(res.net_cashflow) || 0
        };
        this.selectedIds.clear();
        this.refreshSelectedSummary();
        this.categoryEditTxnId = null;
        this.expandedTxnId = null;
        this.txnLoading = false;
      },
      error: (err) => {
        this.txnLoading = false;
        this.ctx.flash('error', err.message || 'Failed to load transactions');
      }
    });
  }

  trackTxn(_: number, t: BankTransaction): number {
    return t.id;
  }

  requestExportPanel() {
    this.ctx.requestExportPanel(true);
  }

  exportStatement(format: 'xlsx' | 'pdf' = 'xlsx', useTxnFilters = false) {
    this.exporting = true;
    const filterPayload = useTxnFilters
      ? this.filters.buildSharedFilters()
      : this.filters.buildSharedFilters();
    this.importService.exportTransactions(filterPayload, { format, layout: 'statement' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Acct_Statement_${toIsoDate(new Date())}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting = false;
        this.ctx.flash('success', `Exported bank statement (${format.toUpperCase()})`);
      },
      error: async (err) => {
        this.exporting = false;
        let msg = 'Export failed';
        try {
          if (err.error instanceof Blob) {
            const text = await err.error.text();
            msg = JSON.parse(text).error || msg;
          } else {
            msg = err.message || msg;
          }
        } catch {
          /* ignore */
        }
        this.ctx.flash('error', msg);
      }
    });
  }

  quickFilter(kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear') {
    if (kind === 'clear') {
      this.filters.filterCategories = [];
      this.filters.filterCategory = '';
      this.filters.filterFlow = '';
      this.filters.filterQ = '';
    } else if (kind === 'uncategorized') {
      this.filters.filterCategories = [
        'Uncategorized',
        'Expense_Other_Debit',
        'Income_Other_Credit',
        'Expense_Peer_UPI',
        'Income_Peer_UPI'
      ];
      this.filters.filterCategory = '';
      this.filters.filterFlow = '';
    } else if (kind === 'interest') {
      this.filters.filterCategories = this.ctx.categories.filter(
        (c) => c === 'Interest Income' || c.startsWith('Income_Interest')
      );
      if (!this.filters.filterCategories.length) {
        this.filters.filterCategories = ['Income_Interest_Bank', 'Income_Interest_Bond', 'Interest Income'];
      }
      this.filters.filterCategory = '';
      this.filters.filterFlow = '';
    } else if (kind === 'debit') {
      this.filters.filterFlow = 'debit';
      this.filters.filterCategories = [];
      this.filters.filterCategory = '';
    } else if (kind === 'credit') {
      this.filters.filterFlow = 'credit';
      this.filters.filterCategories = [];
      this.filters.filterCategory = '';
    }
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
  }

  isInterestFilterActive(): boolean {
    return (
      this.filters.filterCategories.length > 0 &&
      this.filters.filterCategories.every((c) => c === 'Interest Income' || c.startsWith('Income_Interest'))
    );
  }

  isUncategorizedFilterActive(): boolean {
    const set = new Set([
      'Uncategorized',
      'Expense_Other_Debit',
      'Income_Other_Credit',
      'Expense_Peer_UPI',
      'Income_Peer_UPI'
    ]);
    return this.filters.filterCategories.length > 0 && this.filters.filterCategories.every((c) => set.has(c));
  }

  goToPage(page: number) {
    const p = Math.min(Math.max(1, page), this.totalPages);
    this.filters.filterOffset = (p - 1) * this.filters.filterLimit;
    this.loadTransactions();
  }

  nextPage() {
    if (this.currentPage < this.totalPages) this.goToPage(this.currentPage + 1);
  }

  prevPage() {
    if (this.currentPage > 1) this.goToPage(this.currentPage - 1);
  }

  changePageSize() {
    this.filters.filterLimit = Math.min(200, Number(this.filters.filterLimit) || 50);
    this.filters.filterOffset = 0;
    localStorage.setItem('bank-txn-page-size', String(this.filters.filterLimit));
    this.loadTransactions();
  }

  changeSort() {
    this.filters.filterOffset = 0;
    this.loadTransactions();
  }

  sortByColumn(column: string) {
    const key = this.columnSortKey[column] || column;
    if (this.sortColumn === column) {
      this.filters.filterSort = `${key}_${this.sortDir === 'asc' ? 'desc' : 'asc'}`;
    } else {
      const defaultDesc =
        column === 'date' || column === 'withdrawal' || column === 'deposit' || column === 'balance';
      this.filters.filterSort = `${key}_${defaultDesc ? 'desc' : 'asc'}`;
    }
    this.filters.filterOffset = 0;
    this.loadTransactions();
  }

  sortIndicator(column: string): string {
    if (this.sortColumn !== column) return '↕';
    return this.sortDir === 'asc' ? '▲' : '▼';
  }

  isSorted(column: string): boolean {
    return this.sortColumn === column;
  }

  jumpToPage() {
    if (!this.jumpPage) return;
    this.goToPage(Number(this.jumpPage));
  }

  toggleSelect(id: number) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.refreshSelectedSummary();
  }

  toggleSelectAll() {
    if (this.selectedIds.size === this.transactions.length) this.selectedIds.clear();
    else this.transactions.forEach((t) => this.selectedIds.add(t.id));
    this.refreshSelectedSummary();
  }

  private refreshSelectedSummary() {
    let debit = 0;
    let credit = 0;
    for (const t of this.transactions) {
      if (!this.selectedIds.has(t.id)) continue;
      debit += Number(t.withdrawal) || 0;
      credit += Number(t.deposit) || 0;
    }
    this.selectedSummaryCache = { count: this.selectedIds.size, debit, credit };
  }

  bulkDelete() {
    if (!this.selectedIds.size) return;
    if (!confirm(`Delete ${this.selectedIds.size} selected transactions?`)) return;
    this.txnService.bulkDelete([...this.selectedIds]).subscribe({
      next: (n) => {
        this.ctx.flash('success', `Deleted ${n} transactions`);
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Bulk delete failed')
    });
  }

  applyBulkCategory() {
    if (!this.bulkCategory || !this.selectedIds.size) return;
    this.txnService.bulkCategorize([...this.selectedIds], this.bulkCategory).subscribe({
      next: (n) => {
        this.ctx.flash('success', `Updated category on ${n} transactions`);
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Bulk update failed')
    });
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
          this.loadTransactions();
          this.analyticsState.loadAnalytics();
        },
        error: (err) => this.ctx.flash('error', err.message || 'Recategorize failed')
      });
  }

  openCategoryEditor(txn: BankTransaction, event: Event) {
    event.stopPropagation();
    this.categoryEditTxnId = txn.id;
  }

  closeCategoryEditor() {
    this.categoryEditTxnId = null;
  }

  onRowCategoryPicked(txn: BankTransaction, category: string) {
    this.categoryEditTxnId = null;
    this.updateRowCategory(txn, category);
  }

  updateRowCategory(txn: BankTransaction, category: string) {
    this.txnService.updateTransaction(txn.id, { category: category || null }).subscribe({
      next: () => {
        txn.category = category || null;
        txn.category_source = 'manual';
      },
      error: (err) => this.ctx.flash('error', err.message || 'Update failed')
    });
  }

  toggleExpand(id: number) {
    this.expandedTxnId = this.expandedTxnId === id ? null : id;
  }

  saveTxnDetails(txn: BankTransaction) {
    this.txnService
      .updateTransaction(txn.id, {
        tags: txn.tags || null,
        notes: txn.notes || null,
        payee: txn.payee || null,
        category: txn.category || undefined
      })
      .subscribe({
        next: (row) => {
          if (row) Object.assign(txn, row);
          this.ctx.flash('success', 'Transaction details saved');
        },
        error: (err) => this.ctx.flash('error', err.message || 'Save failed')
      });
  }

  openManualTxn() {
    this.manualTxn = this.emptyManualTxn();
    if (this.filters.filterAccountId) this.manualTxn.account_id = Number(this.filters.filterAccountId);
    else if (this.ctx.activeAccounts[0]) this.manualTxn.account_id = this.ctx.activeAccounts[0].id;
    this.showManualTxn = true;
  }

  saveManualTxn() {
    if (!this.manualTxn.account_id || !this.manualTxn.txn_date) {
      this.ctx.flash('error', 'Account and date are required');
      return;
    }
    this.txnService.createTransaction(this.manualTxn).subscribe({
      next: () => {
        this.showManualTxn = false;
        this.ctx.flash('success', 'Manual transaction added');
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => this.ctx.flash('error', err.error?.error || err.message || 'Create failed')
    });
  }

  deleteTxn(txn: BankTransaction) {
    if (!confirm('Delete this transaction?')) return;
    this.txnService.deleteTransaction(txn.id).subscribe({
      next: () => {
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Delete failed')
    });
  }

  formatMoney = formatMoney;
  formatCat = formatCat;
}
