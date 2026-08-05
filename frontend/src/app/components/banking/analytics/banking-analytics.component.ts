import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, merge, takeUntil } from 'rxjs';
import { PeriodGrain, PeriodRow } from '../../../services/banking/banking.models';
import {
  barOptions,
  doughnutOptions,
  lineOptions,
  netLineOptions
} from '../shared/banking-chart.util';
import { formatMoney, formatPct, toIsoDate } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-analytics',
  templateUrl: './banking-analytics.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-analytics.component.css'],
  standalone: false
})
export class BankingAnalyticsComponent implements OnInit, OnDestroy {
  readonly doughnutOptions = doughnutOptions;
  readonly barOptions = barOptions;
  readonly lineOptions = lineOptions;
  readonly netLineOptions = netLineOptions;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
    private filters: BankingFilterState,
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

  setCashflowGrain(grain: PeriodGrain) {
    this.analyticsState.setCashflowGrain(grain);
  }

  categoryPct(amount: number): number {
    return this.analyticsState.categoryPct(amount);
  }

  openPeriodInTransactions(row: PeriodRow) {
    const grain = this.analyticsState.cashflowGrain;
    if (grain === 'month') {
      this.filters.filterFrom = `${row.key}-01`;
      const [y, m] = row.key.split('-').map(Number);
      this.filters.filterTo = toIsoDate(new Date(y, m, 0));
    } else if (grain === 'quarter') {
      const [yPart, qPart] = row.key.split('-Q');
      const y = Number(yPart);
      const q = Number(qPart);
      const startMonth = (q - 1) * 3;
      this.filters.filterFrom = toIsoDate(new Date(y, startMonth, 1));
      this.filters.filterTo = toIsoDate(new Date(y, startMonth + 3, 0));
    } else {
      const y = Number(row.key);
      this.filters.filterFrom = `${y}-01-01`;
      this.filters.filterTo = `${y}-12-31`;
    }
    this.filters.datePreset = 'custom';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Showing transactions for ${row.label}`);
  }

  filterByCategory(category: string) {
    this.filters.filterCategories = category ? [category] : [];
    this.filters.filterCategory = category;
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Filtered transactions by category: ${category}`);
  }

  formatMoney = formatMoney;
  formatPct = formatPct;
}
