import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse } from './banking.models';
import { bankApiUrl } from './bank-api.util';

@Injectable({ providedIn: 'root' })
export class BankAnalyticsService {
  constructor(private http: HttpClient) {}

  getAnalytics(filters: Record<string, any> = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get<ApiResponse<any>>(bankApiUrl('analytics'), { params }).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  getAnalyticsByPayee(filters: Record<string, any> = {}): Observable<any[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get<ApiResponse<any[]>>(bankApiUrl('analytics/by-payee'), { params }).pipe(
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
    return this.http.get<ApiResponse<any>>(bankApiUrl('cash-summary')).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  getRecurring(accountId?: number): Observable<any[]> {
    let params = new HttpParams();
    if (accountId) params = params.set('account_id', String(accountId));
    return this.http.get<ApiResponse<any[]>>(bankApiUrl('recurring'), { params }).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  matchTransfers(): Observable<{ matched: number }> {
    return this.http.post<ApiResponse<{ matched: number }>>(bankApiUrl('transfers/match'), {}).pipe(
      map((r) => r.data || { matched: 0 })
    );
  }

  listMatchedTransfers(limit = 50): Observable<any[]> {
    let params = new HttpParams().set('limit', String(limit));
    return this.http.get<ApiResponse<any[]>>(bankApiUrl('transfers/matched'), { params }).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  unmatchTransfer(txnId: number): Observable<boolean> {
    return this.http
      .post<ApiResponse<any>>(bankApiUrl('transfers/unmatch'), { txn_id: txnId })
      .pipe(map((r) => !!r.success));
  }

  getForecast(accountId?: number): Observable<any> {
    let params = new HttpParams();
    if (accountId) params = params.set('account_id', String(accountId));
    return this.http.get<ApiResponse<any>>(bankApiUrl('forecast'), { params }).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  scanDuplicates(accountId?: number | null): Observable<any> {
    let params = new HttpParams();
    if (accountId != null && accountId !== undefined) {
      params = params.set('account_id', String(accountId));
    }
    return this.http.get<ApiResponse<any>>(bankApiUrl('duplicates/scan'), { params }).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  cleanDuplicates(opts: {
    account_id?: number | null;
    delete_ids?: number[];
    dry_run?: boolean;
  } = {}): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(bankApiUrl('duplicates/clean'), {
        account_id: opts.account_id ?? null,
        delete_ids: opts.delete_ids,
        dry_run: !!opts.dry_run
      })
      .pipe(map((r) => (r.success ? r.data : null)));
  }
}
