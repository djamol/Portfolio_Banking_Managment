import { Component, OnDestroy, OnInit } from '@angular/core';
import { ChartEvent, ActiveElement, ChartOptions } from 'chart.js';
import { Subject, merge, takeUntil } from 'rxjs';
import { CategoryGrain } from '../../../utils/category-rollup.util';
import { formatCategoryLabel } from '../../../utils/category-tree.util';
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

  spendBarClickOptions: ChartOptions<'bar'> = {
    ...horizontalBarOptions,
    onClick: (event: ChartEvent, elements: ActiveElement[]) => this.onSpendClick(event, elements)
  };

  mixClickOptions: ChartOptions<'doughnut'> = {
    ...doughnutOptions,
    onClick: (event: ChartEvent, elements: ActiveElement[]) => this.onMixClick(event, elements)
  };

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

  setGrain(grain: CategoryGrain) {
    this.analyticsState.setCategoryGrain(grain);
  }

  breadcrumbLabel(key: string): string {
    return formatCategoryLabel(key);
  }

  onSpendClick(_event: ChartEvent, elements: ActiveElement[]) {
    if (!elements?.length) return;
    const idx = elements[0].index;
    const key = this.analyticsState.spendChartKeys[idx];
    if (key) this.analyticsState.drillIntoCategory(key);
  }

  onMixClick(_event: ChartEvent, elements: ActiveElement[]) {
    if (!elements?.length) return;
    const idx = elements[0].index;
    const key = this.analyticsState.mixChartKeys[idx];
    if (key) this.analyticsState.drillIntoCategory(key);
  }

  formatMoney = formatMoney;
}
