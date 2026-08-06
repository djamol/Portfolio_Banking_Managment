import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, merge, takeUntil } from 'rxjs';
import { BankImportService } from '../../services/banking/bank-import.service';
import { BankingRouteId } from './shared/banking-filter-state.service';
import { formatMoney, toIsoDate } from './shared/banking-format.util';
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
  private exportFromFilters = false;

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
        'interest',
        'insights'
      ] as BankingRouteId[]
    ).includes(segment as BankingRouteId)
      ? (segment as BankingRouteId)
      : 'overview';
    this.filters.setActiveRoute(route);
  }

  openExportPanel(fromFilters = false) {
    this.exportFromFilters = fromFilters;
    this.showExportPanel = true;
    if (fromFilters) {
      this.exportAccountId = this.filters.filterAccountId || '';
      this.exportFrom = this.filters.filterFrom || '';
      this.exportTo = this.filters.filterTo || '';
    } else {
      this.exportAccountId = this.filters.filterAccountId || '';
      this.exportFrom = this.filters.filterFrom || '';
      this.exportTo = this.filters.filterTo || '';
    }
  }

  exportStatement(
    format: 'xlsx' | 'pdf' = 'xlsx',
    useTxnFilters = false,
    layout: 'statement' | 'raw' = 'statement'
  ) {
    this.exporting = true;
    const filterPayload: Record<string, any> = useTxnFilters || this.exportFromFilters
      ? this.filters.buildSharedFilters()
      : {
          ...(this.exportAccountId ? { account_id: this.exportAccountId } : {}),
          ...(this.exportFrom ? { from: this.exportFrom } : {}),
          ...(this.exportTo ? { to: this.exportTo } : {})
        };
    this.importService.exportTransactions(filterPayload, { format, layout }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = toIsoDate(new Date());
        a.download =
          layout === 'raw'
            ? `bank_transactions_backup_${stamp}.xlsx`
            : `Acct_Statement_${stamp}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting = false;
        this.showExportPanel = false;
        this.ctx.flash(
          'success',
          layout === 'raw'
            ? 'Exported raw backup Excel'
            : `Exported bank statement (${format.toUpperCase()})`
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

  shellQuickFilter(kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear') {
    this.applyQuickFilter(kind);
    if (kind !== 'clear' && this.filters.activeRoute !== 'transactions') {
      this.router.navigate(['/banking/transactions']);
    }
  }

  applyQuickFilter(kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear') {
    if (kind === 'clear') {
      this.filters.filterCategories = [];
      this.filters.filterCategory = '';
      this.filters.filterFlow = '';
      this.filters.filterQ = '';
    } else if (kind === 'uncategorized') {
      this.filters.filterCategories = [
        'Uncategorized',
        'Expense_Other_Debit',
        'Income_Other_Credit',
        'Expense_Peer_UPI',
        'Income_Peer_UPI'
      ];
      this.filters.filterCategory = '';
      this.filters.filterFlow = '';
    } else if (kind === 'interest') {
      this.filters.filterCategories = this.ctx.categories.filter(
        (c) => c === 'Interest Income' || c.startsWith('Income_Interest')
      );
      if (!this.filters.filterCategories.length) {
        this.filters.filterCategories = ['Income_Interest_Bank', 'Income_Interest_Bond', 'Interest Income'];
      }
      this.filters.filterCategory = '';
      this.filters.filterFlow = '';
    } else if (kind === 'debit') {
      this.filters.filterFlow = 'debit';
      this.filters.filterCategories = [];
      this.filters.filterCategory = '';
    } else if (kind === 'credit') {
      this.filters.filterFlow = 'credit';
      this.filters.filterCategories = [];
      this.filters.filterCategory = '';
    }
    this.filters.filterOffset = 0;
    this.filters.notifyChanged();
  }

  isInterestFilterActive(): boolean {
    return (
      this.filters.filterCategories.length > 0 &&
      this.filters.filterCategories.every((c) => c === 'Interest Income' || c.startsWith('Income_Interest'))
    );
  }

  isUncategorizedFilterActive(): boolean {
    const set = new Set([
      'Uncategorized',
      'Expense_Other_Debit',
      'Income_Other_Credit',
      'Expense_Peer_UPI',
      'Income_Peer_UPI'
    ]);
    return this.filters.filterCategories.length > 0 && this.filters.filterCategories.every((c) => set.has(c));
  }

  isAnalyticsTabActive(): boolean {
    const r = this.filters.activeRoute;
    return r === 'analytics' || r === 'charts' || r === 'cashflow' || r === 'income';
  }

  clearPayeeFilter() {
    this.filters.clearPayeeFilter();
  }

  formatMoney = formatMoney;
}
