import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

export interface InvestmentTransaction {
  id: number;
  investment_id: number;
  txn_date: string;
  txn_type: string;
  units?: number | null;
  price?: number | null;
  cashflow_amount: number;
  notes?: string | null;
  website_app_name?: string | null;
  investment_type?: string | null;
  sub_type_name?: string | null;
  sub_type_category?: string | null;
}

export interface CashflowListMeta {
  total: number;
  limit: number;
  offset: number;
  total_inflow: number;
  total_outflow: number;
  net_cashflow: number;
}

export interface CashflowListResult {
  data: InvestmentTransaction[];
  meta: CashflowListMeta;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: CashflowListMeta;
  message?: string;
  error?: string;
}

export interface CashflowFilters {
  investment_id?: number | string | null;
  from?: string | null;
  to?: string | null;
  txn_type?: string | null;
  limit?: number;
  offset?: number;
}

@Injectable({
  providedIn: 'root'
})
export class CashflowService {
  private getApiUrl(): string {
    return getApiBaseUrl();
  }

  constructor(private http: HttpClient) {}

  list(filters: CashflowFilters = {}): Observable<CashflowListResult> {
    let params = new HttpParams();
    if (filters.investment_id) params = params.set('investment_id', String(filters.investment_id));
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.txn_type) params = params.set('txn_type', filters.txn_type);
    if (filters.limit != null) params = params.set('limit', String(filters.limit));
    if (filters.offset != null) params = params.set('offset', String(filters.offset));

    return this.http
      .get<ApiResponse<InvestmentTransaction[]>>(`${this.getApiUrl()}/investments/transactions`, { params })
      .pipe(
        map((response) => ({
          data: response.success ? response.data || [] : [],
          meta: response.meta || {
            total: 0,
            limit: filters.limit || 100,
            offset: filters.offset || 0,
            total_inflow: 0,
            total_outflow: 0,
            net_cashflow: 0
          }
        }))
      );
  }

  create(payload: Partial<InvestmentTransaction>): Observable<InvestmentTransaction | null> {
    return this.http
      .post<ApiResponse<InvestmentTransaction>>(`${this.getApiUrl()}/investments/transactions`, payload)
      .pipe(map((response) => (response.success ? response.data : null)));
  }

  update(id: number, payload: Partial<InvestmentTransaction>): Observable<InvestmentTransaction | null> {
    return this.http
      .put<ApiResponse<InvestmentTransaction>>(`${this.getApiUrl()}/investments/transactions/${id}`, payload)
      .pipe(map((response) => (response.success ? response.data : null)));
  }

  delete(id: number): Observable<boolean> {
    return this.http
      .delete<ApiResponse<any>>(`${this.getApiUrl()}/investments/transactions/${id}`)
      .pipe(map((response) => !!response.success));
  }
}
