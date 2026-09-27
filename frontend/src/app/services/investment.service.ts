import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface InvestmentReturn {
  investment_id: number;
  basis: 'transactions' | 'invested_amount' | 'none';
  invested?: number;
  received?: number;
  current_value: number;
  gain?: number;
  gain_pct?: number | null;
  xirr?: number | null;
  txn_count?: number;
  first_txn_date?: string | null;
}

export interface InvestmentReturnsResponse {
  as_of: string;
  items: InvestmentReturn[];
  summary: {
    invested: number;
    received: number;
    current_value: number;
    gain: number;
    gain_pct: number | null;
    xirr: number | null;
    xirr_value_covered: number;
  };
}

export interface BulkResult {
  succeeded: number;
  failed: number;
  results: { id: number; ok: boolean; error?: string }[];
}

export interface BulkChanges {
  website_app_name?: string;
  investment_type?: string;
  sub_type_name?: string;
  sub_type_category?: string;
  notes_append?: string;
}

@Injectable({
  providedIn: 'root'
})
export class InvestmentService {
  private getApiUrl(): string {
    return getApiBaseUrl();
  }
  
  constructor(private http: HttpClient) {}

  getAll(): Observable<any[]> {
    return this.http.get<ApiResponse<any[]>>(`${this.getApiUrl()}/investments`).pipe(
      map(response => response.success ? response.data : [])
    );
  }

  getByCriteria(platform: string, subTypeName: string, subTypeCategory: string): Observable<any[]> {
    return this.http.get<ApiResponse<any[]>>(`${this.getApiUrl()}/investments/search`, {
      params: {
        website_app_name: platform,
        sub_type_name: subTypeName,
        sub_type_category: subTypeCategory
      }
    }).pipe(
      map(response => response.success ? response.data : [])
    );
  }

  getById(id: number): Observable<any> {
    return this.http.get<ApiResponse<any>>(`${this.getApiUrl()}/investments/${id}`).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  create(data: any): Observable<any> {
    return this.http.post<ApiResponse<any>>(`${this.getApiUrl()}/investments`, data).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  update(id: number, data: any): Observable<any> {
    return this.http.put<ApiResponse<any>>(`${this.getApiUrl()}/investments/${id}`, data).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  delete(id: number): Observable<any> {
    return this.http.delete<ApiResponse<any>>(`${this.getApiUrl()}/investments/${id}`).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  getReturns(): Observable<InvestmentReturnsResponse | null> {
    return this.http.get<ApiResponse<InvestmentReturnsResponse>>(`${this.getApiUrl()}/investments/returns`).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  bulk(action: 'delete' | 'update', ids: number[], changes?: BulkChanges): Observable<BulkResult> {
    return this.http.post<ApiResponse<BulkResult>>(`${this.getApiUrl()}/investments/bulk`, { action, ids, changes }).pipe(
      map(response => response.data)
    );
  }
}