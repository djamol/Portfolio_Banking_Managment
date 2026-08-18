import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, merge, takeUntil } from 'rxjs';
import { PeriodGrain, PeriodRow } from '../../../services/banking/banking.models';
import { barOptions, netLineOptions } from '../shared/banking-chart.util';
import { formatMoney, formatPct } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-cashflow',
  templateUrl: './banking-cashflow.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-cashflow.component.css'],
  standalone: false
})
export class BankingCashflowComponent implements OnInit, OnDestroy {
  readonly barOptions = barOptions;
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

  openPeriodInTransactions(row: PeriodRow) {
    this.filters.applyPeriodRange(row, this.analyticsState.cashflowGrain);
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', `Showing transactions for ${row.label}`);
  }

  formatMoney = formatMoney;
  formatPct = formatPct;
}
