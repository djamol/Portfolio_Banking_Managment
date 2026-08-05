import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { DatePreset } from '../../../services/banking/banking.models';

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
    if (this.filterCategories.length) {
      filters['category'] = this.filterCategories.join(',');
    } else if (this.filterCategory) {
      filters['category'] = this.filterCategory;
    }
    if (this.filterMinAmount !== '' && this.filterMinAmount != null) {
      filters['min_amount'] = this.filterMinAmount;
    }
    if (this.filterMaxAmount !== '' && this.filterMaxAmount != null) {
      filters['max_amount'] = this.filterMaxAmount;
    }
    if (this.excludeTransfers) filters['exclude_transfers'] = '1';
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
    this.filterOffset = 0;
    this.notifyChanged();
  }

  toggleAdvancedFilters() {
    this.showAdvancedFilters = !this.showAdvancedFilters;
  }
}
