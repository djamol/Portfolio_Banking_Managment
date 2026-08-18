import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { DatePreset, PeriodGrain } from '../../../services/banking/banking.models';

export type BankingRouteId =
  | 'overview'
  | 'accounts'
  | 'import'
  | 'transactions'
  | 'rules'
  | 'budgets'
  | 'analytics'
  | 'charts'
  | 'cashflow'
  | 'income'
  | 'expense'
  | 'interest'
  | 'insights';

@Injectable({ providedIn: 'root' })
export class BankingFilterState {
  filterAccountId: number | '' = '';
  filterFrom = '';
  filterTo = '';
  filterCategories: string[] = [];
  filterCategory = '';
  filterFlow = '';
  filterQ = '';
  filterPayee = '';
  filterMinAmount: number | '' = '';
  filterMaxAmount: number | '' = '';
  filterCategorySource: '' | 'manual' | 'auto' | 'rule' = '';
  filterNeedsReview = false;
  filterTransfersOnly = false;
  filterSort = 'date_desc';
  filterLimit = Math.min(
    200,
    Number(localStorage.getItem('bank-txn-page-size') || 50) || 50
  );
  filterOffset = 0;
  datePreset: DatePreset = 'all';
  excludeTransfers = true;
  showAdvancedFilters = false;

  private readonly changed$ = new Subject<void>();
  readonly filtersChanged$ = this.changed$.asObservable();

  private readonly refresh$ = new Subject<void>();
  readonly refreshRequested$ = this.refresh$.asObservable();

  private readonly route$ = new BehaviorSubject<BankingRouteId>('overview');
  readonly activeRoute$ = this.route$.asObservable();

  setActiveRoute(route: BankingRouteId) {
    this.route$.next(route);
  }

  get activeRoute(): BankingRouteId {
    return this.route$.value;
  }

  requestRefresh() {
    this.refresh$.next();
  }

  notifyChanged() {
    this.changed$.next();
  }

  toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  buildSharedFilters(): Record<string, any> {
    const filters: Record<string, any> = {};
    if (this.filterAccountId) filters['account_id'] = this.filterAccountId;
    if (this.filterFrom) filters['from'] = this.filterFrom;
    if (this.filterTo) filters['to'] = this.filterTo;
    if (!this.filterNeedsReview) {
      if (this.filterCategories.length) {
        filters['category'] = this.filterCategories.join(',');
      } else if (this.filterCategory) {
        filters['category'] = this.filterCategory;
      }
    }
    if (this.filterMinAmount !== '' && this.filterMinAmount != null) {
      filters['min_amount'] = this.filterMinAmount;
    }
    if (this.filterMaxAmount !== '' && this.filterMaxAmount != null) {
      filters['max_amount'] = this.filterMaxAmount;
    }
    if (this.filterTransfersOnly) {
      filters['transfers_only'] = '1';
    } else if (this.excludeTransfers) {
      filters['exclude_transfers'] = '1';
    }
    if (this.filterNeedsReview) filters['needs_review'] = '1';
    if (this.filterCategorySource) filters['category_source'] = this.filterCategorySource;
    return filters;
  }

  buildTxnFilters(forExport = false): Record<string, any> {
    const filters: Record<string, any> = {
      ...this.buildSharedFilters(),
      limit: forExport ? 5000 : this.filterLimit,
      offset: forExport ? 0 : this.filterOffset,
      sort: this.filterSort
    };
    if (this.filterFlow) filters['flow'] = this.filterFlow;
    if (this.filterQ) filters['q'] = this.filterQ;
    if (this.filterPayee) filters['payee'] = this.filterPayee;
    return filters;
  }

  get usesCategoryFilter(): boolean {
    const r = this.activeRoute;
    return (
      r === 'transactions' ||
      r === 'analytics' ||
      r === 'charts' ||
      r === 'cashflow' ||
      r === 'income' ||
      r === 'expense' ||
      r === 'insights'
    );
  }

  get showFilterBar(): boolean {
    const r = this.activeRoute;
    return (
      r === 'overview' ||
      r === 'transactions' ||
      r === 'budgets' ||
      r === 'analytics' ||
      r === 'charts' ||
      r === 'cashflow' ||
      r === 'income' ||
      r === 'expense' ||
      r === 'interest' ||
      r === 'insights'
    );
  }

  get advancedFilterCount(): number {
    let n = 0;
    if (this.filterFlow) n += 1;
    if (this.filterMinAmount !== '' && this.filterMinAmount != null) n += 1;
    if (this.filterMaxAmount !== '' && this.filterMaxAmount != null) n += 1;
    if (this.filterQ) n += 1;
    if (this.filterPayee) n += 1;
    if (this.filterCategorySource) n += 1;
    if (this.filterNeedsReview) n += 1;
    if (this.filterTransfersOnly) n += 1;
    return n;
  }

  applyDatePreset(preset: DatePreset) {
    this.datePreset = preset;
    if (preset === 'all') {
      this.filterFrom = '';
      this.filterTo = '';
    } else if (preset === 'custom') {
      return;
    } else {
      const to = new Date();
      const from = new Date();
      if (preset === '1m') from.setMonth(from.getMonth() - 1);
      if (preset === '3m') from.setMonth(from.getMonth() - 3);
      if (preset === '6m') from.setMonth(from.getMonth() - 6);
      if (preset === '1y') from.setFullYear(from.getFullYear() - 1);
      if (preset === 'ytd') {
        from.setMonth(0, 1);
      }
      this.filterFrom = this.toIsoDate(from);
      this.filterTo = this.toIsoDate(to);
    }
    this.filterOffset = 0;
    this.notifyChanged();
  }

  onManualDateChange() {
    this.datePreset = 'custom';
  }

  clearFilters() {
    this.filterAccountId = '';
    this.filterFrom = '';
    this.filterTo = '';
    this.filterCategories = [];
    this.filterCategory = '';
    this.filterFlow = '';
    this.filterQ = '';
    this.filterPayee = '';
    this.filterMinAmount = '';
    this.filterMaxAmount = '';
    this.filterCategorySource = '';
    this.filterNeedsReview = false;
    this.filterTransfersOnly = false;
    this.filterSort = 'date_desc';
    this.filterOffset = 0;
    this.datePreset = 'all';
    this.excludeTransfers = true;
    this.showAdvancedFilters = false;
    this.notifyChanged();
  }

  clearPayeeFilter() {
    this.filterPayee = '';
    this.filterOffset = 0;
    this.notifyChanged();
  }

  applyFilters() {
    this.filterOffset = 0;
    this.notifyChanged();
  }

  onCategoryFilterChange(selected: string[]) {
    this.filterCategories = selected || [];
    this.filterCategory = this.filterCategories.length === 1 ? this.filterCategories[0] : '';
    this.filterNeedsReview = false;
    this.filterTransfersOnly = false;
    this.filterOffset = 0;
    this.notifyChanged();
  }

  applyQuickFilter(
    kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear' | 'transfers' | 'manual' | 'auto',
    interestCategories: string[] = []
  ) {
    const wasTransfers = this.filterTransfersOnly;
    this.filterOffset = 0;
    this.filterNeedsReview = false;
    this.filterTransfersOnly = false;
    this.filterCategorySource = '';
    if (kind === 'clear') {
      if (wasTransfers) this.excludeTransfers = true;
      this.filterCategories = [];
      this.filterCategory = '';
      this.filterFlow = '';
    } else if (kind === 'uncategorized') {
      this.filterCategories = [];
      this.filterCategory = '';
      this.filterFlow = '';
      this.filterNeedsReview = true;
    } else if (kind === 'interest') {
      const cats = (interestCategories || []).filter(
        (c) => c === 'Interest Income' || c.startsWith('Income_Interest')
      );
      this.filterCategories = cats.length
        ? cats
        : ['Income_Interest_Bank', 'Income_Interest_Bond', 'Interest Income'];
      this.filterCategory = '';
      this.filterFlow = '';
    } else if (kind === 'debit') {
      this.filterFlow = 'debit';
      this.filterCategories = [];
      this.filterCategory = '';
    } else if (kind === 'credit') {
      this.filterFlow = 'credit';
      this.filterCategories = [];
      this.filterCategory = '';
    } else if (kind === 'transfers') {
      this.filterCategories = [];
      this.filterCategory = '';
      this.filterFlow = '';
      this.filterTransfersOnly = true;
      this.excludeTransfers = false;
    } else if (kind === 'manual') {
      this.filterCategorySource = 'manual';
    } else if (kind === 'auto') {
      this.filterCategorySource = 'auto';
    }
    this.notifyChanged();
  }

  isInterestFilterActive(): boolean {
    return (
      !this.filterNeedsReview &&
      !this.filterTransfersOnly &&
      this.filterCategories.length > 0 &&
      this.filterCategories.every((c) => c === 'Interest Income' || c.startsWith('Income_Interest'))
    );
  }

  isUncategorizedFilterActive(): boolean {
    return this.filterNeedsReview;
  }

  isTransfersFilterActive(): boolean {
    return this.filterTransfersOnly;
  }

  applyPayeeFilter(payee: string) {
    this.filterPayee = (payee || '').trim();
    this.filterOffset = 0;
    this.notifyChanged();
  }

  applyAccountFilter(accountId: number | '') {
    this.filterAccountId = accountId;
    this.filterOffset = 0;
    this.notifyChanged();
  }

  applyPeriodRange(row: { key: string; label?: string }, grain: PeriodGrain) {
    if (grain === 'month') {
      this.filterFrom = `${row.key}-01`;
      const [y, m] = row.key.split('-').map(Number);
      this.filterTo = this.toIsoDate(new Date(y, m, 0));
    } else if (grain === 'quarter') {
      const [yPart, qPart] = row.key.split('-Q');
      const y = Number(yPart);
      const q = Number(qPart);
      const startMonth = (q - 1) * 3;
      this.filterFrom = this.toIsoDate(new Date(y, startMonth, 1));
      this.filterTo = this.toIsoDate(new Date(y, startMonth + 3, 0));
    } else {
      const y = Number(row.key);
      this.filterFrom = `${y}-01-01`;
      this.filterTo = `${y}-12-31`;
    }
    this.datePreset = 'custom';
    this.filterOffset = 0;
    this.notifyChanged();
  }

  applyTxnDay(date: string, query = '') {
    this.filterFrom = date;
    this.filterTo = date;
    this.datePreset = 'custom';
    this.filterQ = query;
    this.filterPayee = '';
    this.filterNeedsReview = false;
    this.filterTransfersOnly = false;
    this.filterFlow = '';
    this.filterCategories = [];
    this.filterCategory = '';
    this.filterOffset = 0;
    this.notifyChanged();
  }

  toggleAdvancedFilters() {
    this.showAdvancedFilters = !this.showAdvancedFilters;
  }
}
