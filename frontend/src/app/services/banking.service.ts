import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
  message?: string;
  error?: string;
}

export interface BankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  account_number?: string | null;
  ifsc?: string | null;
  account_type?: string;
  currency?: string;
  opening_balance?: number;
  notes?: string | null;
  is_active?: number | boolean;
  txn_count?: number;
  latest_balance?: number | null;
}

export interface BankTransaction {
  id: number;
  account_id: number;
  txn_date: string;
  value_date?: string;
  narration?: string;
  ref_no?: string | null;
  withdrawal: number;
  deposit: number;
  balance?: number | null;
  category?: string | null;
  category_source?: string | null;
  payee?: string | null;
  txn_type?: string | null;
  tags?: string | null;
  notes?: string | null;
  import_batch_id?: string | null;
  linked_transfer_id?: number | null;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
}

export interface CategoryRule {
  id?: number;
  pattern: string;
  match_field?: string;
  category: string;
  priority?: number;
  account_id?: number | null;
  is_active?: number | boolean;
}

export interface BankBudget {
  id?: number;
  category: string;
  amount: number;
  period_month?: string | null;
  account_id?: number | null;
  notes?: string | null;
  spent?: number;
  remaining?: number;
  pct?: number;
}

@Injectable({ providedIn: 'root' })
export class BankingService {
  private getApiUrl(): string {
    return `${getApiBaseUrl()}/banking`;
  }

  constructor(private http: HttpClient) {}

  getAccounts(): Observable<BankAccount[]> {
    return this.http.get<ApiResponse<BankAccount[]>>(`${this.getApiUrl()}/accounts`).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  createAccount(data: Partial<BankAccount>): Observable<BankAccount | null> {
    return this.http.post<ApiResponse<BankAccount>>(`${this.getApiUrl()}/accounts`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateAccount(id: number, data: Partial<BankAccount>): Observable<BankAccount | null> {
    return this.http.put<ApiResponse<BankAccount>>(`${this.getApiUrl()}/accounts/${id}`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteAccount(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(`${this.getApiUrl()}/accounts/${id}`).pipe(
      map((r) => !!r.success)
    );
  }

  getTransactions(filters: Record<string, any> = {}): Observable<{
    rows: BankTransaction[];
    total: number;
    total_debit?: number;
    total_credit?: number;
    net_cashflow?: number;
  }> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get<ApiResponse<BankTransaction[]>>(`${this.getApiUrl()}/transactions`, { params }).pipe(
      map((r) => ({
        rows: r.success ? r.data : [],
        total: r.meta?.total || 0,
        total_debit: r.meta?.total_debit,
        total_credit: r.meta?.total_credit,
        net_cashflow: r.meta?.net_cashflow
      }))
    );
  }

  createTransaction(data: Partial<BankTransaction>): Observable<BankTransaction | null> {
    return this.http.post<ApiResponse<BankTransaction>>(`${this.getApiUrl()}/transactions`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateTransaction(id: number, data: Partial<BankTransaction>): Observable<BankTransaction | null> {
    return this.http.put<ApiResponse<BankTransaction>>(`${this.getApiUrl()}/transactions/${id}`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteTransaction(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(`${this.getApiUrl()}/transactions/${id}`).pipe(
      map((r) => !!r.success)
    );
  }

  bulkCategorize(ids: number[], category: string): Observable<number> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(`${this.getApiUrl()}/transactions/bulk-categorize`, {
        ids,
        category
      })
      .pipe(map((r) => r.data?.updated || 0));
  }

  bulkDelete(ids: number[]): Observable<number> {
    return this.http
      .post<ApiResponse<{ deleted: number }>>(`${this.getApiUrl()}/transactions/bulk-delete`, { ids })
      .pipe(map((r) => r.data?.deleted || 0));
  }

  recategorize(accountId?: number, mode: string = 'auto_only'): Observable<number> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(`${this.getApiUrl()}/recategorize`, {
        account_id: accountId,
        mode
      })
      .pipe(map((r) => r.data?.updated || 0));
  }

  getAnalytics(filters: Record<string, any> = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get<ApiResponse<any>>(`${this.getApiUrl()}/analytics`, { params }).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  getAnalyticsByPayee(filters: Record<string, any> = {}): Observable<any[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get<ApiResponse<any[]>>(`${this.getApiUrl()}/analytics/by-payee`, { params }).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  getCashSummary(): Observable<{
    accounts: Array<{
      id: number;
      bank_name: string;
      account_name: string;
      currency: string;
      latest_balance: number;
      is_active: number;
    }>;
    totals_by_currency: Array<{ currency: string; total: number }>;
    active_count: number;
    inactive_count: number;
  } | null> {
    return this.http.get<ApiResponse<any>>(`${this.getApiUrl()}/cash-summary`).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  getCategories(): Observable<string[]> {
    return this.http.get<ApiResponse<string[]>>(`${this.getApiUrl()}/categories`).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  getRules(): Observable<CategoryRule[]> {
    return this.http.get<ApiResponse<CategoryRule[]>>(`${this.getApiUrl()}/rules`).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  createRule(data: CategoryRule): Observable<CategoryRule | null> {
    return this.http.post<ApiResponse<CategoryRule>>(`${this.getApiUrl()}/rules`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateRule(id: number, data: CategoryRule): Observable<CategoryRule | null> {
    return this.http.put<ApiResponse<CategoryRule>>(`${this.getApiUrl()}/rules/${id}`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteRule(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(`${this.getApiUrl()}/rules/${id}`).pipe(
      map((r) => !!r.success)
    );
  }

  getBudgetStatus(periodMonth?: string, opts: { exclude_transfers?: boolean } = {}): Observable<BankBudget[]> {
    let params = new HttpParams();
    if (periodMonth) params = params.set('period_month', periodMonth);
    if (opts.exclude_transfers) params = params.set('exclude_transfers', '1');
    return this.http.get<ApiResponse<BankBudget[]>>(`${this.getApiUrl()}/budgets/status`, { params }).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  saveBudget(data: BankBudget): Observable<BankBudget | null> {
    return this.http.post<ApiResponse<BankBudget>>(`${this.getApiUrl()}/budgets`, data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteBudget(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(`${this.getApiUrl()}/budgets/${id}`).pipe(
      map((r) => !!r.success)
    );
  }

  getRecurring(accountId?: number): Observable<any[]> {
    let params = new HttpParams();
    if (accountId) params = params.set('account_id', String(accountId));
    return this.http.get<ApiResponse<any[]>>(`${this.getApiUrl()}/recurring`, { params }).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  matchTransfers(): Observable<{ matched: number }> {
    return this.http.post<ApiResponse<{ matched: number }>>(`${this.getApiUrl()}/transfers/match`, {}).pipe(
      map((r) => r.data || { matched: 0 })
    );
  }

  getForecast(accountId?: number): Observable<any> {
    let params = new HttpParams();
    if (accountId) params = params.set('account_id', String(accountId));
    return this.http.get<ApiResponse<any>>(`${this.getApiUrl()}/forecast`, { params }).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  getContinuity(accountId: number): Observable<any> {
    return this.http.get<ApiResponse<any>>(`${this.getApiUrl()}/accounts/${accountId}/continuity`).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  scanDuplicates(accountId?: number | null): Observable<any> {
    let params = new HttpParams();
    if (accountId != null && accountId !== undefined) {
      params = params.set('account_id', String(accountId));
    }
    return this.http.get<ApiResponse<any>>(`${this.getApiUrl()}/duplicates/scan`, { params }).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  cleanDuplicates(opts: {
    account_id?: number | null;
    delete_ids?: number[];
    dry_run?: boolean;
  } = {}): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(`${this.getApiUrl()}/duplicates/clean`, {
        account_id: opts.account_id ?? null,
        delete_ids: opts.delete_ids,
        dry_run: !!opts.dry_run
      })
      .pipe(map((r) => (r.success ? r.data : null)));
  }

  undoImportBatch(batchId: string): Observable<{ deleted: number; found: number }> {
    return this.http
      .delete<ApiResponse<{ deleted: number; found: number }>>(
        `${this.getApiUrl()}/import/batches/${batchId}`
      )
      .pipe(map((r) => r.data || { deleted: 0, found: 0 }));
  }

  exportTransactions(
    filters: Record<string, any> = {},
    opts: { format?: 'xlsx' | 'pdf' | 'csv'; layout?: 'statement' | 'raw' } = {}
  ): Observable<Blob> {
    let params = new HttpParams()
      .set('format', opts.format || 'xlsx')
      .set('layout', opts.layout || 'statement');
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get(`${this.getApiUrl()}/export/transactions`, {
      params,
      responseType: 'blob'
    });
  }

  /** @deprecated use exportTransactions */
  exportTransactionsXlsx(filters: Record<string, any> = {}): Observable<Blob> {
    return this.exportTransactions(filters, { format: 'xlsx', layout: 'statement' });
  }

  importTransactionBackup(file: File): Observable<{
    inserted: number;
    skipped: number;
    unresolved: number;
    total: number;
    import_batch_id: string;
  }> {
    const form = new FormData();
    form.append('file', file);
    return this.http
      .post<ApiResponse<any>>(`${this.getApiUrl()}/import/transactions`, form)
      .pipe(
        map((r) => {
          if (!r.success) throw new Error(r.error || 'Import failed');
          return r.data;
        })
      );
  }

  importStatement(
    accountId: number,
    file: File,
    bankHint?: string,
    pdfPassword?: string
  ): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    form.append('account_id', String(accountId));
    if (bankHint) form.append('bank_hint', bankHint);
    if (pdfPassword) form.append('pdf_password', pdfPassword);
    return this.http.post<ApiResponse<any>>(`${this.getApiUrl()}/import`, form).pipe(
      map((r) => {
        if (!r.success) throw new Error(r.error || 'Import failed');
        return r.data;
      })
    );
  }

  previewStatement(
    file: File,
    accountId?: number,
    bankHint?: string,
    pdfPassword?: string
  ): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    if (accountId) form.append('account_id', String(accountId));
    if (bankHint) form.append('bank_hint', bankHint);
    if (pdfPassword) form.append('pdf_password', pdfPassword);
    return this.http.post<ApiResponse<any>>(`${this.getApiUrl()}/import/preview`, form).pipe(
      map((r) => {
        if (!r.success) throw new Error(r.error || 'Preview failed');
        return r.data;
      })
    );
  }
}
