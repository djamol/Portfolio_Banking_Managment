import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import {
  countLineOptions,
  doughnutOptions,
  horizontalBarOptions,
  lineOptions,
  netLineOptions
} from '../shared/banking-chart.util';
import { formatMoney } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-charts',
  templateUrl: './banking-charts.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-charts.component.css'],
  standalone: false
})
export class BankingChartsComponent implements OnInit, OnDestroy {
  readonly doughnutOptions = doughnutOptions;
  readonly lineOptions = lineOptions;
  readonly netLineOptions = netLineOptions;
  readonly countLineOptions = countLineOptions;
  readonly horizontalBarOptions = horizontalBarOptions;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public analyticsState: BankingAnalyticsState,
    private filters: BankingFilterState
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

  formatMoney = formatMoney;
}
