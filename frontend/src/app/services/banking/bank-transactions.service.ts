import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse, BankTransaction } from './banking.models';
import { bankApiUrl } from './bank-api.util';

@Injectable({ providedIn: 'root' })
export class BankTransactionsService {
  constructor(private http: HttpClient) {}

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
    return this.http.get<ApiResponse<BankTransaction[]>>(bankApiUrl('transactions'), { params }).pipe(
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
    return this.http.post<ApiResponse<BankTransaction>>(bankApiUrl('transactions'), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateTransaction(id: number, data: Partial<BankTransaction>): Observable<BankTransaction | null> {
    return this.http.put<ApiResponse<BankTransaction>>(bankApiUrl(`transactions/${id}`), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteTransaction(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(bankApiUrl(`transactions/${id}`)).pipe(
      map((r) => !!r.success)
    );
  }

  bulkCategorize(ids: number[], category: string): Observable<number> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(bankApiUrl('transactions/bulk-categorize'), {
        ids,
        category
      })
      .pipe(map((r) => r.data?.updated || 0));
  }

  bulkDelete(ids: number[]): Observable<number> {
    return this.http
      .post<ApiResponse<{ deleted: number }>>(bankApiUrl('transactions/bulk-delete'), { ids })
      .pipe(map((r) => r.data?.deleted || 0));
  }

  recategorize(accountId?: number, mode: string = 'auto_only'): Observable<number> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(bankApiUrl('recategorize'), {
        account_id: accountId,
        mode
      })
      .pipe(map((r) => r.data?.updated || 0));
  }
}
