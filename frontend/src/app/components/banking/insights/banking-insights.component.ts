import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankAccountsService } from '../../../services/banking/bank-accounts.service';
import { BankAnalyticsService } from '../../../services/banking/bank-analytics.service';
import { formatCurrency, formatMoney } from '../shared/banking-format.util';
import { BankingAnalyticsState } from '../shared/banking-analytics-state.service';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-insights',
  templateUrl: './banking-insights.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-insights.component.css'],
  standalone: false
})
export class BankingInsightsComponent implements OnInit, OnDestroy {
  recurring: any[] = [];
  forecast: any = null;
  continuity: any = null;
  continuityAccountId: number | '' = '';
  duplicateAccountId: number | '' = '';
  duplicateScan: any = null;
  duplicateScanning = false;
  duplicateCleaning = false;
  duplicateGroupSelected: Record<number, boolean> = {};
  topPayees: any[] = [];
  matchedTransfers: any[] = [];
  transferMatching = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public analyticsState: BankingAnalyticsState,
    private filters: BankingFilterState,
    private analyticsService: BankAnalyticsService,
    private accountsService: BankAccountsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadInsights();
    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadInsights());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadInsights() {
    const accountId = this.filters.filterAccountId ? Number(this.filters.filterAccountId) : undefined;
    this.analyticsService.getRecurring(accountId).subscribe({
      next: (rows) => (this.recurring = rows),
      error: () => (this.recurring = [])
    });
    this.analyticsService.getForecast(accountId).subscribe({
      next: (data) => (this.forecast = data),
      error: () => (this.forecast = null)
    });
    this.analyticsState.loadCashSummary();
    this.loadTopPayees();
    this.loadMatchedTransfers();
  }

  loadMatchedTransfers() {
    this.analyticsService.listMatchedTransfers(40).subscribe({
      next: (rows) => (this.matchedTransfers = rows || []),
      error: () => (this.matchedTransfers = [])
    });
  }

  loadTopPayees() {
    const payload: Record<string, any> = { ...this.filters.buildSharedFilters(), limit: 15 };
    this.analyticsService.getAnalyticsByPayee(payload).subscribe({
      next: (rows) => (this.topPayees = rows || []),
      error: () => (this.topPayees = [])
    });
  }

  filterByPayee(payee: string) {
    if (!payee) return;
    this.filters.filterPayee = payee === 'Unknown' ? '' : payee;
    this.filters.filterQ = '';
    this.filters.filterCategories = [];
    this.filters.filterCategory = '';
    this.filters.filterFlow = '';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
    this.router.navigate(['/banking/transactions']);
    this.ctx.flash('info', payee === 'Unknown' ? 'Opened transactions' : `Filtered by payee: ${payee}`);
  }

  createRuleFromRecurring(row: any, event?: Event) {
    event?.stopPropagation();
    this.router.navigate(['/banking/rules'], {
      queryParams: {
        payee: row?.payee || '',
        category: row?.category || ''
      }
    });
  }

  runTransferMatch() {
    this.transferMatching = true;
    this.analyticsService.matchTransfers().subscribe({
      next: (r) => {
        this.transferMatching = false;
        this.ctx.flash('success', `Matched ${r.matched} cross-account transfers`);
        this.loadMatchedTransfers();
        this.analyticsState.loadAnalytics();
        this.filters.requestRefresh();
      },
      error: (err) => {
        this.transferMatching = false;
        this.ctx.flash('error', err.message || 'Transfer match failed');
      }
    });
  }

  unmatchTransferPair(pair: any) {
    const id = pair?.out?.id;
    if (!id || !confirm('Unlink this transfer pair?')) return;
    this.analyticsService.unmatchTransfer(Number(id)).subscribe({
      next: () => {
        this.ctx.flash('success', 'Transfer unlinked');
        this.loadMatchedTransfers();
        this.analyticsState.loadAnalytics();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Unmatch failed')
    });
  }

  checkContinuity() {
    if (!this.continuityAccountId) {
      this.ctx.flash('error', 'Select an account');
      return;
    }
    this.accountsService.getContinuity(Number(this.continuityAccountId)).subscribe({
      next: (data) => {
        this.continuity = data;
        this.ctx.flash(
          data.gaps?.length ? 'info' : 'success',
          data.gaps?.length
            ? `Found ${data.gaps.length} balance gaps (showing up to 100)`
            : 'Balance continuity looks good'
        );
      },
      error: (err) => this.ctx.flash('error', err.message || 'Continuity check failed')
    });
  }

  scanDuplicates() {
    this.duplicateScanning = true;
    const accountId =
      this.duplicateAccountId === '' || this.duplicateAccountId == null
        ? null
        : Number(this.duplicateAccountId);
    this.analyticsService.scanDuplicates(accountId).subscribe({
      next: (data) => {
        this.duplicateScanning = false;
        this.duplicateScan = data;
        this.duplicateGroupSelected = {};
        (data?.groups || []).forEach((_: any, i: number) => {
          this.duplicateGroupSelected[i] = true;
        });
        const found = data?.groups_found || 0;
        const shown = data?.groups?.length || 0;
        this.ctx.flash(
          found ? 'info' : 'success',
          found
            ? `Found ${found} near-duplicate group(s)${data?.truncated ? ` (showing ${shown})` : ''}`
            : 'No near-duplicates found'
        );
      },
      error: (err) => {
        this.duplicateScanning = false;
        this.ctx.flash('error', err.message || 'Duplicate scan failed');
      }
    });
  }

  toggleAllDuplicateGroups(selected: boolean) {
    if (!this.duplicateScan?.groups) return;
    this.duplicateScan.groups.forEach((_: any, i: number) => {
      this.duplicateGroupSelected[i] = selected;
    });
  }

  selectedDuplicateDeleteIds(): number[] {
    const ids: number[] = [];
    (this.duplicateScan?.groups || []).forEach((g: any, i: number) => {
      if (this.duplicateGroupSelected[i]) {
        for (const id of g.delete_ids || []) ids.push(Number(id));
      }
    });
    return ids;
  }

  removeSelectedDuplicates() {
    const ids = this.selectedDuplicateDeleteIds();
    if (!ids.length) {
      this.ctx.flash('error', 'Select at least one duplicate group');
      return;
    }
    if (!confirm(`Delete ${ids.length} near-duplicate transaction(s)? Keep one row per selected group.`)) {
      return;
    }
    this.duplicateCleaning = true;
    const accountId =
      this.duplicateAccountId === '' || this.duplicateAccountId == null
        ? null
        : Number(this.duplicateAccountId);
    this.analyticsService.cleanDuplicates({ account_id: accountId, delete_ids: ids }).subscribe({
      next: (data) => {
        this.duplicateCleaning = false;
        this.ctx.flash('success', `Deleted ${data?.deleted || 0} near-duplicate(s)`);
        this.scanDuplicates();
        this.filters.requestRefresh();
      },
      error: (err) => {
        this.duplicateCleaning = false;
        this.ctx.flash('error', err.message || 'Clean failed');
      }
    });
  }

  autoCleanDuplicates() {
    const total = (this.duplicateScan?.groups || []).reduce(
      (sum: number, g: any) => sum + (g.delete_ids?.length || 0),
      0
    );
    if (!this.duplicateScan) {
      this.ctx.flash('error', 'Scan duplicates first');
      return;
    }
    if (!total) {
      this.ctx.flash('info', 'Nothing to clean');
      return;
    }
    if (!confirm(`Auto-clean: delete ${total} near-duplicates, keep 1 per group?`)) return;
    this.duplicateCleaning = true;
    const accountId =
      this.duplicateAccountId === '' || this.duplicateAccountId == null
        ? null
        : Number(this.duplicateAccountId);
    this.analyticsService.cleanDuplicates({ account_id: accountId }).subscribe({
      next: (data) => {
        this.duplicateCleaning = false;
        this.ctx.flash(
          'success',
          `Auto-cleaned ${data?.deleted || 0} near-duplicate(s) across ${data?.groups_found || 0} group(s)`
        );
        this.scanDuplicates();
        this.filters.requestRefresh();
      },
      error: (err) => {
        this.duplicateCleaning = false;
        this.ctx.flash('error', err.message || 'Auto-clean failed');
      }
    });
  }

  formatMoney = formatMoney;
  formatCurrency = formatCurrency;
}
