import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse, BankBudget, CategoryRule } from './banking.models';
import { bankApiUrl } from './bank-api.util';

@Injectable({ providedIn: 'root' })
export class BankRulesService {
  constructor(private http: HttpClient) {}

  getCategories(): Observable<string[]> {
    return this.http.get<ApiResponse<string[]>>(bankApiUrl('categories')).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  getRules(): Observable<CategoryRule[]> {
    return this.http.get<ApiResponse<CategoryRule[]>>(bankApiUrl('rules')).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  createRule(data: CategoryRule): Observable<CategoryRule | null> {
    return this.http.post<ApiResponse<CategoryRule>>(bankApiUrl('rules'), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateRule(id: number, data: CategoryRule): Observable<CategoryRule | null> {
    return this.http.put<ApiResponse<CategoryRule>>(bankApiUrl(`rules/${id}`), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteRule(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(bankApiUrl(`rules/${id}`)).pipe(
      map((r) => !!r.success)
    );
  }

  getBudgetStatus(periodMonth?: string, opts: { exclude_transfers?: boolean } = {}): Observable<BankBudget[]> {
    let params = new HttpParams();
    if (periodMonth) params = params.set('period_month', periodMonth);
    if (opts.exclude_transfers) params = params.set('exclude_transfers', '1');
    return this.http.get<ApiResponse<BankBudget[]>>(bankApiUrl('budgets/status'), { params }).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  saveBudget(data: BankBudget): Observable<BankBudget | null> {
    return this.http.post<ApiResponse<BankBudget>>(bankApiUrl('budgets'), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateBudget(id: number, data: BankBudget): Observable<BankBudget | null> {
    return this.http.put<ApiResponse<BankBudget>>(bankApiUrl(`budgets/${id}`), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteBudget(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(bankApiUrl(`budgets/${id}`)).pipe(
      map((r) => !!r.success)
    );
  }
}
