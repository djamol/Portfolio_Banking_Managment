import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankImportService } from '../../../services/banking/bank-import.service';
import { BankAccount, BankTransaction, CategoryRule } from '../../../services/banking/banking.models';
import { BankAccountsService } from '../../../services/banking/bank-accounts.service';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import { BankTransactionsService } from '../../../services/banking/bank-transactions.service';
import { formatCat, formatMoney, toIsoDate } from '../shared/banking-format.util';
import { splitCategoryParts } from '../../../utils/category-tree.util';
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
  @ViewChild('txnSearch') txnSearch?: ElementRef<HTMLInputElement>;

  transactions: BankTransaction[] = [];
  txnTotal = 0;
  txnTotals = { total_debit: 0, total_credit: 0, net_cashflow: 0 };
  txnLoading = false;
  exporting = false;
  bulkWorking = false;
  recategorizing = false;
  savingManual = false;
  ruleSaving = false;

  selectedIds = new Set<number>();
  selectedSummaryCache = { count: 0, debit: 0, credit: 0 };
  categoryEditTxnId: number | null = null;
  bulkCategory = '';
  expandedTxnId: number | null = null;
  recategorizeMode: 'auto_only' | 'uncategorized' | 'all' = 'auto_only';
  jumpPage: number | null = null;
  searchDraft = '';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClickedIndex = -1;

  showManualTxn = false;
  manualTxn: Partial<BankTransaction> = this.emptyManualTxn();

  showAccountDetails = false;
  accountDetailsSaving = false;
  accountDetailsForm: Partial<BankAccount> = {};
  ruleDraft: Pick<CategoryRule, 'pattern' | 'match_field' | 'category'> = {
    pattern: '',
    match_field: 'narration',
    category: ''
  };

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
    private accountsService: BankAccountsService,
    private importService: BankImportService,
    private rulesService: BankRulesService,
    private analyticsState: BankingAnalyticsState
  ) {}

  ngOnInit() {
    this.searchDraft = this.filters.filterQ || '';
    this.ctx.loadAccounts();
    this.loadTransactions();
    this.syncAccountDetailsForm();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.searchDraft = this.filters.filterQ || '';
        this.loadTransactions();
        this.syncAccountDetailsForm();
      });
    this.ctx.accounts$.pipe(takeUntil(this.destroy$)).subscribe(() => this.syncAccountDetailsForm());
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  get filteredAccount(): BankAccount | null {
    const id = this.filters.filterAccountId ? Number(this.filters.filterAccountId) : 0;
    if (!id) return null;
    return this.ctx.accounts.find((a) => Number(a.id) === id) || null;
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

  get pageAllSelected(): boolean {
    return this.transactions.length > 0 && this.selectedIds.size === this.transactions.length;
  }

  get avgTxnSize(): number {
    if (!this.txnTotal) return 0;
    return (this.txnTotals.total_debit + this.txnTotals.total_credit) / this.txnTotal;
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
      notes: '',
      payee: ''
    };
  }

  syncAccountDetailsForm() {
    const a = this.filteredAccount;
    if (!a) {
      this.showAccountDetails = false;
      this.accountDetailsForm = {};
      return;
    }
    this.accountDetailsForm = {
      id: a.id,
      bank_name: a.bank_name,
      account_name: a.account_name,
      branch: a.branch || '',
      account_number: a.account_number || '',
      account_type: a.account_type || 'Savings',
      ifsc: a.ifsc || '',
      notes: a.notes || '',
      currency: a.currency || 'INR',
      opening_balance: a.opening_balance ?? 0,
      is_active: a.is_active
    };
  }

  toggleAccountDetails() {
    if (!this.filteredAccount) {
      this.ctx.flash('error', 'Select one account in the filter to edit account details');
      return;
    }
    this.syncAccountDetailsForm();
    this.showAccountDetails = !this.showAccountDetails;
  }

  saveAccountDetails() {
    const id = this.accountDetailsForm.id || this.filteredAccount?.id;
    if (!id) {
      this.ctx.flash('error', 'Select one account in the filter first');
      return;
    }
    if (!this.accountDetailsForm.bank_name || !this.accountDetailsForm.account_name) {
      this.ctx.flash('error', 'Bank and account name are required');
      return;
    }
    this.accountDetailsSaving = true;
    const payload: Partial<BankAccount> = {
      ...this.filteredAccount,
      ...this.accountDetailsForm,
      ifsc: String(this.accountDetailsForm.ifsc || '')
        .trim()
        .toUpperCase(),
      branch: String(this.accountDetailsForm.branch || '').trim() || null,
      account_number: String(this.accountDetailsForm.account_number || '').trim() || null
    };
    this.accountsService.updateAccount(Number(id), payload).subscribe({
      next: () => {
        this.accountDetailsSaving = false;
        this.ctx.flash('success', 'Account details saved — used in statement export');
        this.ctx.refreshCore();
        this.filters.requestRefresh();
      },
      error: (err) => {
        this.accountDetailsSaving = false;
        this.ctx.flash('error', err.message || 'Failed to save account details');
      }
    });
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
        this.lastClickedIndex = -1;
        this.refreshSelectedSummary();
        this.categoryEditTxnId = null;
        this.expandedTxnId = null;
        this.jumpPage = this.currentPage;
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

  onSearchInput() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      const q = (this.searchDraft || '').trim();
      if (q === (this.filters.filterQ || '')) return;
      this.filters.filterQ = q;
      this.filters.filterOffset = 0;
      this.filters.notifyChanged();
    }, 350);
  }

  submitSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = (this.searchDraft || '').trim();
    this.filters.filterQ = q;
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
  }

  requestExportPanel() {
    this.ctx.requestExportPanel(true);
  }

  exportStatement(format: 'xlsx' | 'pdf' = 'xlsx', _useTxnFilters = false) {
    this.exporting = true;
    this.importService
      .exportTransactions(this.filters.buildStatementExportFilters(), {
        format,
        layout: 'statement',
        applyFilters: false
      })
      .subscribe({
        next: (result) => {
          this.importService.downloadExport(result);
          this.exporting = false;
          const extra = result.truncated
            ? ' (stopped at 100,000 rows)'
            : result.rowCount
              ? ` · ${result.rowCount} txn${result.rowCount === 1 ? '' : 's'}`
              : '';
          this.ctx.flash(
            result.truncated ? 'info' : 'success',
            `Exported bank statement (${format.toUpperCase()})${extra}`
          );
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

  quickFilter(
    kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear' | 'transfers' | 'manual' | 'auto'
  ) {
    this.filters.applyQuickFilter(kind, this.ctx.categories);
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

  toggleSelect(id: number, event?: Event) {
    const idx = this.transactions.findIndex((t) => t.id === id);
    const ev = event as MouseEvent | undefined;
    if (ev?.shiftKey && this.lastClickedIndex >= 0 && idx >= 0) {
      const from = Math.min(this.lastClickedIndex, idx);
      const to = Math.max(this.lastClickedIndex, idx);
      for (let i = from; i <= to; i++) this.selectedIds.add(this.transactions[i].id);
    } else if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.lastClickedIndex = idx;
    this.refreshSelectedSummary();
  }

  toggleSelectAll() {
    if (this.pageAllSelected) this.selectedIds.clear();
    else this.transactions.forEach((t) => this.selectedIds.add(t.id));
    this.refreshSelectedSummary();
  }

  clearSelection() {
    this.selectedIds.clear();
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
    if (!this.selectedIds.size || this.bulkWorking) return;
    if (!confirm(`Delete ${this.selectedIds.size} selected transactions?`)) return;
    this.bulkWorking = true;
    this.txnService.bulkDelete([...this.selectedIds]).subscribe({
      next: (n) => {
        this.bulkWorking = false;
        this.ctx.flash('success', `Deleted ${n} transactions`);
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => {
        this.bulkWorking = false;
        this.ctx.flash('error', err.message || 'Bulk delete failed');
      }
    });
  }

  applyBulkCategory() {
    if (!this.bulkCategory || !this.selectedIds.size || this.bulkWorking) return;
    this.bulkWorking = true;
    this.txnService.bulkCategorize([...this.selectedIds], this.bulkCategory).subscribe({
      next: (n) => {
        this.bulkWorking = false;
        this.ctx.flash('success', `Updated category on ${n} transactions`);
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => {
        this.bulkWorking = false;
        this.ctx.flash('error', err.message || 'Bulk update failed');
      }
    });
  }

  recategorize() {
    if (this.recategorizing) return;
    if (
      this.recategorizeMode === 'all' &&
      !confirm('Overwrite all categories on matching transactions, including manual ones?')
    ) {
      return;
    }
    this.recategorizing = true;
    this.txnService
      .recategorize(
        this.filters.filterAccountId ? Number(this.filters.filterAccountId) : undefined,
        this.recategorizeMode
      )
      .subscribe({
        next: (n) => {
          this.recategorizing = false;
          this.ctx.flash(
            'success',
            `Auto-categorized ${n} transactions (${this.recategorizeMode.replace('_', ' ')})`
          );
          this.loadTransactions();
          this.analyticsState.loadAnalytics();
        },
        error: (err) => {
          this.recategorizing = false;
          this.ctx.flash('error', err.message || 'Recategorize failed');
        }
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
    if (this.expandedTxnId === id) {
      this.expandedTxnId = null;
      return;
    }
    this.expandedTxnId = id;
    const txn = this.transactions.find((t) => t.id === id);
    if (txn) this.prepareRuleDraft(txn);
  }

  prepareRuleDraft(txn: BankTransaction) {
    this.ruleDraft = {
      pattern: this.suggestRulePattern(txn),
      match_field: txn.payee ? 'payee' : 'narration',
      category: txn.category || ''
    };
  }

  suggestRulePattern(txn: BankTransaction): string {
    const payee = String(txn.payee || '').trim();
    if (payee.length >= 3) return payee;
    const n = String(txn.narration || '');
    const upi = n.match(/[a-zA-Z0-9._-]{3,}@[a-zA-Z]{2,}/);
    if (upi) return upi[0];
    const cleaned = n
      .replace(/\b(UPI|NEFT|IMPS|RTGS|ACH|NACH|INF|MMT|FT|CR|DR)\b/gi, ' ')
      .replace(/\d{6,}/g, ' ')
      .replace(/[^a-zA-Z0-9 @._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const token = cleaned.split(' ').find((t) => t.length >= 4);
    return token || cleaned.slice(0, 28) || n.slice(0, 28);
  }

  saveRuleFromTxn(_txn: BankTransaction) {
    if (!this.ruleDraft.pattern || !this.ruleDraft.category) {
      this.ctx.flash('error', 'Pattern and category are required to create a rule');
      return;
    }
    this.ruleSaving = true;
    this.rulesService
      .createRule({
        pattern: this.ruleDraft.pattern.trim(),
        match_field: this.ruleDraft.match_field || 'narration',
        category: this.ruleDraft.category,
        priority: 100,
        account_id: null,
        is_active: 1
      })
      .subscribe({
        next: () => {
          this.ruleSaving = false;
          this.ctx.flash('success', 'Rule saved. Run Auto-categorize to apply it to similar rows.');
        },
        error: (err) => {
          this.ruleSaving = false;
          this.ctx.flash('error', err.message || 'Failed to save rule');
        }
      });
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
    this.showAccountDetails = false;
  }

  cloneTxn(txn: BankTransaction) {
    this.manualTxn = {
      account_id: txn.account_id,
      txn_date: toIsoDate(new Date()),
      narration: txn.narration || '',
      withdrawal: txn.withdrawal || 0,
      deposit: txn.deposit || 0,
      category: txn.category || '',
      tags: txn.tags || '',
      notes: txn.notes || '',
      payee: txn.payee || ''
    };
    this.showManualTxn = true;
    this.expandedTxnId = null;
    this.ctx.flash('info', 'Cloned into the manual form — change date/amount then save');
  }

  onManualWithdrawalChange() {
    if (Number(this.manualTxn.withdrawal) > 0) this.manualTxn.deposit = 0;
  }

  onManualDepositChange() {
    if (Number(this.manualTxn.deposit) > 0) this.manualTxn.withdrawal = 0;
  }

  setManualToday() {
    this.manualTxn.txn_date = toIsoDate(new Date());
  }

  saveManualTxn() {
    if (!this.manualTxn.account_id || !this.manualTxn.txn_date) {
      this.ctx.flash('error', 'Account and date are required');
      return;
    }
    const w = Number(this.manualTxn.withdrawal) || 0;
    const d = Number(this.manualTxn.deposit) || 0;
    if (w <= 0 && d <= 0) {
      this.ctx.flash('error', 'Enter a withdrawal or a deposit');
      return;
    }
    if (w > 0 && d > 0) {
      this.ctx.flash('error', 'Use either withdrawal or deposit, not both');
      return;
    }
    this.savingManual = true;
    this.txnService.createTransaction(this.manualTxn).subscribe({
      next: () => {
        this.savingManual = false;
        this.showManualTxn = false;
        this.ctx.flash('success', 'Manual transaction added');
        this.loadTransactions();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => {
        this.savingManual = false;
        this.ctx.flash('error', err.error?.error || err.message || 'Create failed');
      }
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

  filterByPayee(payee: string | null | undefined, event?: Event) {
    event?.stopPropagation();
    const value = String(payee || '').trim();
    if (!value) return;
    this.filters.applyPayeeFilter(value);
  }

  copyText(text: string | null | undefined, event?: Event) {
    event?.stopPropagation();
    const value = String(text || '').trim();
    if (!value) return;
    navigator.clipboard.writeText(value).then(
      () => this.ctx.flash('success', 'Copied narration'),
      () => this.ctx.flash('error', 'Copy failed')
    );
  }

  accountLabel(t: BankTransaction): string {
    if (t.account_name) return `${t.bank_name} · ${t.account_name}`;
    return t.bank_name || '—';
  }

  sourceLabel(source: string | null | undefined): string {
    if (source === 'manual') return 'Manual';
    if (source === 'rule') return 'Rule';
    return 'Auto';
  }

  isTransfer(t: BankTransaction): boolean {
    const c = t.category || '';
    return !!t.linked_transfer_id || c === 'Transfer In' || c === 'Transfer Out' || c.startsWith('Transfer_');
  }

  monthKey(date: string | null | undefined): string {
    return String(date || '').slice(0, 7);
  }

  showMonthHeader(index: number): boolean {
    if (this.sortColumn !== 'date' || !this.transactions.length) return false;
    if (index === 0) return true;
    return this.monthKey(this.transactions[index].txn_date) !== this.monthKey(this.transactions[index - 1].txn_date);
  }

  monthLabel(date: string | null | undefined): string {
    const key = this.monthKey(date);
    if (!/^\d{4}-\d{2}$/.test(key)) return date || '';
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent) {
    const el = ev.target as HTMLElement | null;
    const typing = !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (ev.key === 'Escape') {
      if (this.categoryEditTxnId) {
        this.closeCategoryEditor();
        return;
      }
      if (this.expandedTxnId) {
        this.expandedTxnId = null;
        return;
      }
      if (this.showManualTxn) {
        this.showManualTxn = false;
        return;
      }
      if (this.selectedIds.size) this.clearSelection();
      return;
    }
    if (ev.key === '/' && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      this.txnSearch?.nativeElement.focus();
    }
  }

  formatMoney = formatMoney;
  formatCat = formatCat;

  catParts(category: string | null | undefined): string[] {
    return splitCategoryParts(category || '');
  }
}
