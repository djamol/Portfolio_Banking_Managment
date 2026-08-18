import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ActiveElement, ChartEvent, ChartOptions } from 'chart.js';
import { Subject, merge, takeUntil } from 'rxjs';
import { PeriodGrain, PeriodRow } from '../../../services/banking/banking.models';
import { CategoryGrain, RolledCategoryRow } from '../../../utils/category-rollup.util';
import {
  barOptions,
  doughnutOptions,
  horizontalBarOptions,
  netLineOptions
} from '../shared/banking-chart.util';
import { formatCat, formatMoney, formatPct, toIsoDate } from '../shared/banking-format.util';
import { BankingAnalyticsState, PeriodViewRow } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

type PeriodSortKey = 'key' | 'txn_count' | 'total_credit' | 'total_debit' | 'net';

@Component({
  selector: 'app-banking-analytics',
  templateUrl: './banking-analytics.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-analytics.component.css'],
  standalone: false
})
export class BankingAnalyticsComponent implements OnInit, OnDestroy {
  readonly doughnutOptions = doughnutOptions;
  readonly barOptions = barOptions;
  readonly netLineOptions = netLineOptions;
  readonly horizontalBarOptions = horizontalBarOptions;

  spendClickOptions: ChartOptions<'doughnut'> = {
    ...doughnutOptions,
    onClick: (_event: ChartEvent, elements: ActiveElement[]) => this.onSpendSliceClick(elements)
  };

  periodSort: PeriodSortKey = 'key';
  periodSortDir: 'asc' | 'desc' = 'asc';

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
    public filters: BankingFilterState,
    private router: Router
  ) {}

  ngOnInit() {
    this.analyticsState.loadAnalytics();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.analyticsState.loadAnalytics());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get summary() {
    return this.analyticsState.analytics?.summary || {};
  }

  get hasData(): boolean {
    return Number(this.summary.txn_count) > 0;
  }

  get sortedPeriodRows(): PeriodViewRow[] {
    const rows = [...(this.analyticsState.periodViewRows || [])];
    const dir = this.periodSortDir === 'asc' ? 1 : -1;
    const key = this.periodSort;
    return rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
  }

  get periodTotals() {
    const rows = this.analyticsState.periodRows || [];
    return rows.reduce(
      (acc, r) => {
        acc.txn_count += r.txn_count;
        acc.total_credit += r.total_credit;
        acc.total_debit += r.total_debit;
        acc.net += r.net;
        return acc;
      },
      { txn_count: 0, total_credit: 0, total_debit: 0, net: 0 }
    );
  }

  setCashflowGrain(grain: PeriodGrain) {
    this.analyticsState.setCashflowGrain(grain);
  }

  setCategoryGrain(grain: CategoryGrain) {
    this.analyticsState.setCategoryGrain(grain);
  }

  categoryPct(amount: number): number {
    return this.analyticsState.categoryPct(amount);
  }

  sortPeriods(key: PeriodSortKey) {
    if (this.periodSort === key) {
      this.periodSortDir = this.periodSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.periodSort = key;
      this.periodSortDir = key === 'key' ? 'asc' : 'desc';
    }
  }

  sortMark(key: PeriodSortKey): string {
    if (this.periodSort !== key) return '↕';
    return this.periodSortDir === 'asc' ? '▲' : '▼';
  }

  onHierarchyRowClick(row: RolledCategoryRow) {
    if (row.canDrill) {
      this.analyticsState.drillIntoCategory(row.key);
      return;
    }
    this.filterByLeaves(row.leaves.length ? row.leaves : [row.key]);
  }

  openHierarchyLeaves(event: Event, row: RolledCategoryRow) {
    event.stopPropagation();
    this.filterByLeaves(row.leaves.length ? row.leaves : [row.key]);
  }

  filterByLeaves(leaves: string[]) {
    this.filters.filterCategories = [...leaves];
    this.filters.filterCategory = leaves.length === 1 ? leaves[0] : '';
    this.filters.filterNeedsReview = false;
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.goToTransactions(`Filtered transactions by ${leaves.length} categor${leaves.length === 1 ? 'y' : 'ies'}`);
  }

  openPeriodInTransactions(row: PeriodRow) {
    this.filters.applyPeriodRange(row, this.analyticsState.cashflowGrain);
    this.goToTransactions(`Showing transactions for ${row.label}`);
  }

  filterByCategory(category: string) {
    if (!category) return;
    this.filters.filterCategories = [category];
    this.filters.filterCategory = category;
    this.filters.filterNeedsReview = false;
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.goToTransactions(`Filtered transactions by category: ${this.formatCat(category)}`);
  }

  onSpendSliceClick(elements: ActiveElement[]) {
    if (!elements?.length) return;
    const label = this.analyticsState.expenseChartData.labels?.[elements[0].index];
    if (label) this.filterByCategory(String(label));
  }

  openNeedsReview() {
    this.filters.applyQuickFilter('uncategorized');
    this.goToTransactions('Showing transactions that need review');
  }

  openFlow(kind: 'debit' | 'credit') {
    this.filters.applyQuickFilter(kind);
    this.goToTransactions(kind === 'debit' ? 'Showing debits' : 'Showing credits');
  }

  openInterest() {
    this.filters.applyQuickFilter('interest', this.ctx.categories);
    this.goToTransactions('Showing interest transactions');
  }

  openAccount(accountId: number) {
    this.filters.applyAccountFilter(accountId);
    this.goToTransactions('Filtered to that account');
  }

  openPayee(payee: string) {
    this.filters.applyPayeeFilter(payee);
    this.goToTransactions(`Filtered by payee: ${payee}`);
  }

  openTxnContext(t: { txn_date?: string; payee?: string; narration?: string; category?: string }) {
    const date = String(t.txn_date || '').slice(0, 10);
    const q = String(t.payee || t.narration || '').trim().slice(0, 48);
    if (date) {
      this.filters.applyTxnDay(date, q);
      this.goToTransactions(`Showing ${date}`);
      return;
    }
    if (t.category) this.filterByCategory(t.category);
  }

  openMomMonth() {
    const month = this.analyticsState.analytics?.mom?.current_month;
    if (!month) return;
    this.filters.applyPeriodRange({ key: month, label: month }, 'month');
    this.goToTransactions(`Showing ${month}`);
  }

  private goToTransactions(message: string) {
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', message);
  }

  exportCsv(kind: 'periods' | 'categories' | 'payees' | 'accounts') {
    let header: string[] = [];
    let rows: Array<Array<string | number>> = [];
    let filename = 'bank_analytics.csv';
    if (kind === 'periods') {
      header = ['Period', 'Txns', 'Credits', 'Debits', 'Net', 'Debit Δ%', 'Credit Δ%'];
      rows = this.sortedPeriodRows.map((r) => [
        r.label,
        r.txn_count,
        r.total_credit,
        r.total_debit,
        r.net,
        r.debit_delta_pct ?? '',
        r.credit_delta_pct ?? ''
      ]);
      filename = `bank_periods_${toIsoDate(new Date())}.csv`;
    } else if (kind === 'categories') {
      header = ['Category', 'Txns', 'Debits', 'Credits'];
      rows = (this.analyticsState.hierarchyTableRows || []).map((c) => [
        c.label,
        c.txn_count,
        c.total_debit,
        c.total_credit
      ]);
      filename = `bank_categories_${toIsoDate(new Date())}.csv`;
    } else if (kind === 'payees') {
      header = ['Payee', 'Txns', 'Debits', 'Credits'];
      rows = this.analyticsState.payees.map((p) => [p.payee, p.txn_count, p.total_debit, p.total_credit]);
      filename = `bank_payees_${toIsoDate(new Date())}.csv`;
    } else {
      header = ['Bank', 'Account', 'Txns', 'Debits', 'Credits', 'Net'];
      rows = (this.analyticsState.analytics?.byAccount || []).map((a: any) => [
        a.bank_name,
        a.account_name,
        a.txn_count,
        a.total_debit,
        a.total_credit,
        a.net ?? Number(a.total_credit) - Number(a.total_debit)
      ]);
      filename = `bank_accounts_${toIsoDate(new Date())}.csv`;
    }
    const csv = [header, ...rows]
      .map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.ctx.flash('success', `Exported ${filename}`);
  }

  formatMoney = formatMoney;
  formatPct = formatPct;
  formatCat = formatCat;
}
