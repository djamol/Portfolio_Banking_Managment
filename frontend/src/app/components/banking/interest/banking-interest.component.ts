import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, merge, takeUntil } from 'rxjs';
import { barOptions } from '../shared/banking-chart.util';
import { formatMoney } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-interest',
  templateUrl: './banking-interest.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-interest.component.css'],
  standalone: false
})
export class BankingInterestComponent implements OnInit, OnDestroy {
  readonly barOptions = barOptions;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private ctx: BankingContextService,
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

  quickFilter(kind: 'interest') {
    this.filters.filterCategories = this.ctx.categories.filter(
      (c) => c === 'Interest Income' || c.startsWith('Income_Interest')
    );
    if (!this.filters.filterCategories.length) {
      this.filters.filterCategories = ['Income_Interest_Bank', 'Income_Interest_Bond', 'Interest Income'];
    }
    this.filters.filterCategory = '';
    this.filters.filterFlow = '';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
  }

  formatMoney = formatMoney;
}
