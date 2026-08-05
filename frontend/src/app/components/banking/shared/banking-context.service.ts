import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { BankAccountsService } from '../../../services/banking/bank-accounts.service';
import { BankRulesService } from '../../../services/banking/bank-rules.service';
import {
  BankAccount,
  DEFAULT_BANK_CATEGORIES
} from '../../../services/banking/banking.models';

@Injectable({ providedIn: 'root' })
export class BankingContextService {
  accounts: BankAccount[] = [];
  categories: string[] = [...DEFAULT_BANK_CATEGORIES];
  loading = false;

  message = '';
  messageType: 'success' | 'error' | 'info' = 'info';
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly accountsSubject = new BehaviorSubject<BankAccount[]>([]);
  readonly accounts$ = this.accountsSubject.asObservable();

  private readonly exportPanelRequest$ = new Subject<boolean>();
  /** Emits true when export should use current txn filters. */
  readonly exportPanelRequested$ = this.exportPanelRequest$.asObservable();

  requestExportPanel(fromFilters = false) {
    this.exportPanelRequest$.next(fromFilters);
  }

  constructor(
    private accountsService: BankAccountsService,
    private rulesService: BankRulesService
  ) {}

  get activeAccounts(): BankAccount[] {
    return this.accounts.filter((a) => a.is_active !== 0 && a.is_active !== false);
  }

  flash(type: 'success' | 'error' | 'info', text: string) {
    this.messageType = type;
    this.message = text;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.message = '';
    }, 6000);
  }

  clearMessage() {
    this.message = '';
  }

  loadAccounts(done?: () => void) {
    this.accountsService.getAccounts().subscribe({
      next: (rows) => {
        this.accounts = rows;
        this.accountsSubject.next(rows);
        done?.();
      },
      error: (err) => {
        this.flash('error', err.message || 'Failed to load accounts');
        done?.();
      }
    });
  }

  loadCategories(done?: () => void) {
    this.rulesService.getCategories().subscribe({
      next: (cats) => {
        this.categories = [...new Set([...DEFAULT_BANK_CATEGORIES, ...cats])].sort();
        done?.();
      },
      error: () => done?.()
    });
  }

  mergeCategories(extra: string[]) {
    if (!extra?.length) return;
    this.categories = [...new Set([...this.categories, ...DEFAULT_BANK_CATEGORIES, ...extra])].sort();
  }

  refreshCore(done?: () => void) {
    this.loading = true;
    let pending = 2;
    const finish = () => {
      pending -= 1;
      if (pending <= 0) {
        this.loading = false;
        done?.();
      }
    };
    this.loadAccounts(finish);
    this.loadCategories(finish);
  }

  accountLabel(accountId?: number | null): string {
    if (!accountId) return 'All accounts';
    const a = this.accounts.find((x) => x.id === Number(accountId));
    return a ? `${a.bank_name} – ${a.account_name}` : `#${accountId}`;
  }

  maskAccount(num?: string | null): string {
    if (!num) return '—';
    const s = String(num);
    if (s.length <= 4) return s;
    return '••••' + s.slice(-4);
  }
}
