import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, merge, takeUntil } from 'rxjs';
import { BankImportService } from '../../services/banking/bank-import.service';
import { BankingRouteId } from './shared/banking-filter-state.service';
import { BankingAnalyticsState } from './shared/banking-analytics-state.service';
import { BankingContextService } from './shared/banking-context.service';
import { BankingFilterState } from './shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-shell',
  templateUrl: './banking-shell.component.html',
  styleUrls: ['./shared/banking-shared.css', './banking-shell.component.css'],
  standalone: false
})
export class BankingShellComponent implements OnInit, OnDestroy {
  showExportPanel = false;
  exportAccountId: number | '' = '';
  exportFrom = '';
  exportTo = '';
  exporting = false;
  exportApplyFilters = false;
  exportIncludeCategory = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    public filters: BankingFilterState,
    private analyticsState: BankingAnalyticsState,
    private importService: BankImportService,
    private router: Router
  ) {}

  ngOnInit() {
    this.ctx.refreshCore();
    this.analyticsState.loadAnalytics();
    this.analyticsState.loadCashSummary();

    this.syncActiveRoute(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((e) => this.syncActiveRoute(e.urlAfterRedirects));

    merge(this.filters.filtersChanged$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.analyticsState.loadAnalytics();
        this.analyticsState.loadCashSummary();
      });

    this.ctx.exportPanelRequested$.pipe(takeUntil(this.destroy$)).subscribe((fromFilters) => {
      this.openExportPanel(fromFilters);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refreshAll() {
    this.ctx.refreshCore();
    this.filters.requestRefresh();
  }

  private syncActiveRoute(url: string) {
    const segment = url.split('/').pop()?.split('?')[0] || 'overview';
    const route = (
      [
        'overview',
        'accounts',
        'import',
        'transactions',
        'rules',
        'budgets',
        'analytics',
        'charts',
        'cashflow',
        'income',
        'expense',
        'interest',
        'insights'
      ] as BankingRouteId[]
    ).includes(segment as BankingRouteId)
      ? (segment as BankingRouteId)
      : 'overview';
    this.filters.setActiveRoute(route);
  }

  openExportPanel(_fromFilters = false) {
    this.exportApplyFilters = false;
    this.showExportPanel = true;
    this.exportAccountId = this.filters.filterAccountId || '';
    this.exportFrom = this.filters.filterFrom || '';
    this.exportTo = this.filters.filterTo || '';
  }

  setExportDatePreset(kind: 'tm' | 'lm' | 'ytd' | 'all') {
    if (kind === 'all') {
      this.exportFrom = '';
      this.exportTo = '';
      return;
    }
    if (kind === 'ytd') {
      const y = new Date().getFullYear();
      this.exportFrom = `${y}-01-01`;
      this.exportTo = this.filters.toIsoDate(new Date());
      return;
    }
    const key =
      kind === 'tm'
        ? this.filters.currentMonthKey()
        : this.filters.shiftMonthKey(this.filters.currentMonthKey(), -1);
    const [y, m] = key.split('-').map(Number);
    this.exportFrom = `${key}-01`;
    this.exportTo = this.filters.toIsoDate(new Date(y, m, 0));
  }

  get exportFilenameHint(): string {
    const acc = this.ctx.accounts.find((a) => a.id === this.exportAccountId);
    const from = (this.exportFrom || '').replace(/-/g, '');
    const to = (this.exportTo || '').replace(/-/g, '');
    const period = from && to ? `${from}_${to}` : from || to || 'all';
    const bank = (acc?.bank_name || 'Bank').replace(/[^\w]+/g, '_');
    const name = (acc?.account_name || (acc ? 'Account' : 'Statements')).replace(/[^\w]+/g, '_');
    return `${bank}_${name}_${period}`;
  }

  exportStatement(
    format: 'xlsx' | 'pdf' | 'csv' = 'xlsx',
    useTxnFilters = false,
    layout: 'statement' | 'raw' = 'statement'
  ) {
    this.exporting = true;
    const applyFilters = layout === 'raw' ? false : this.exportApplyFilters || useTxnFilters;
    const filterPayload: Record<string, any> = applyFilters
      ? this.filters.buildTxnFilters(true)
      : {
          ...(this.exportAccountId ? { account_id: this.exportAccountId } : {}),
          ...(this.exportFrom ? { from: this.exportFrom } : {}),
          ...(this.exportTo ? { to: this.exportTo } : {})
        };
    delete filterPayload['limit'];
    delete filterPayload['offset'];
    delete filterPayload['sort'];
    this.importService
      .exportTransactions(filterPayload, {
        format,
        layout,
        applyFilters: layout === 'statement' && applyFilters,
        includeCategory: this.exportIncludeCategory && layout === 'statement'
      })
      .subscribe({
        next: (result) => {
          this.importService.downloadExport(result);
          this.exporting = false;
          this.showExportPanel = false;
          const extra = result.truncated
            ? ' (stopped at 100,000 rows)'
            : result.rowCount
              ? ` · ${result.rowCount} txn${result.rowCount === 1 ? '' : 's'}`
              : '';
          this.ctx.flash(
            result.truncated ? 'info' : 'success',
            layout === 'raw'
              ? `Exported raw backup Excel${extra}`
              : `Exported bank statement (${format.toUpperCase()})${extra}`
          );
        },
        error: async (err) => {
          this.exporting = false;
          let msg = 'Export failed';
          try {
            if (err.error instanceof Blob) {
              const text = await err.error.text();
              const parsed = JSON.parse(text);
              msg = parsed.error || msg;
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

  shellQuickFilter(
    kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear' | 'transfers' | 'manual' | 'auto'
  ) {
    this.filters.applyQuickFilter(kind, this.ctx.categories);
    if (kind !== 'clear' && this.filters.activeRoute !== 'transactions') {
      this.router.navigate(['/banking/transactions']);
    }
  }

  isAnalyticsTabActive(): boolean {
    const r = this.filters.activeRoute;
    return r === 'analytics' || r === 'charts' || r === 'cashflow' || r === 'income' || r === 'expense';
  }

  clearPayeeFilter() {
    this.filters.clearPayeeFilter();
  }

  clearSearchFilter() {
    this.filters.filterQ = '';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
  }

  clearSourceFilter() {
    this.filters.filterCategorySource = '';
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
  }
}
