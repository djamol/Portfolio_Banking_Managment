import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

export interface MutualFundScheme {
  schemeCode: number;
  schemeName: string;
}

export interface MutualFundNavSnapshot {
  id?: number;
  investment_id: number;
  snapshot_date: string;
  nav_date: string;
  units: number;
  nav_price: number;
  value: number;
  source: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class MutualFundService {
  constructor(private http: HttpClient) {}

  search(query: string): Observable<MutualFundScheme[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<ApiResponse<MutualFundScheme[]>>(`${getApiBaseUrl()}/mutual-funds/search`, { params }).pipe(
      map(response => response.success ? response.data : [])
    );
  }

  saveSnapshots(investmentId: number, dates: string[]): Observable<MutualFundNavSnapshot[]> {
    return this.http.post<ApiResponse<MutualFundNavSnapshot[]>>(`${getApiBaseUrl()}/mutual-funds/snapshots`, {
      investmentId,
      dates
    }).pipe(map(response => response.success ? response.data : []));
  }

  getSnapshots(investmentId: number, from: string, to: string): Observable<MutualFundNavSnapshot[]> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<ApiResponse<MutualFundNavSnapshot[]>>(`${getApiBaseUrl()}/mutual-funds/snapshots/${investmentId}`, { params })
      .pipe(map(response => response.success ? response.data : []));
  }

  refreshLatest(): Observable<NavRefreshResult> {
    return this.http.post<ApiResponse<NavRefreshResult>>(`${getApiBaseUrl()}/mutual-funds/refresh-latest`, {})
      .pipe(map(response => response.data));
  }

  applyLatestChoices(updates: NavRefreshChoice[]): Observable<NavRefreshApplyResult> {
    return this.http.post<ApiResponse<NavRefreshApplyResult>>(`${getApiBaseUrl()}/mutual-funds/refresh-latest/apply`, { updates })
      .pipe(map(response => response.data));
  }
}

export interface NavRefreshResult {
  snapshot_date: string;
  total: number;
  succeeded: number;
  failed: number;
  changed: number;
  results: NavRefreshCandidate[];
}

export interface NavRefreshCandidate {
  id: number;
  ok: boolean;
  fund_name: string;
  investment_type?: string;
  sub_type_name?: string;
  sub_type_category?: string;
  scheme_code: string;
  can_edit_scheme_code?: boolean;
  platform: string;
  units?: number;
  current_nav?: number | null;
  current_value?: number;
  saved_nav?: number | null;
  saved_nav_date?: string | null;
  saved_nav_source?: string | null;
  nav?: number;
  nav_date?: string;
  changed?: boolean;
  error?: string;
}

export interface NavRefreshChoice {
  id: number;
  choice: 'api' | 'saved' | 'manual' | 'reject';
  nav?: number;
  nav_date?: string;
  scheme_code?: string;
}

export interface NavRefreshApplyResult {
  snapshot_date: string;
  applied: number;
  rejected: number;
  failed: number;
  results: { id: number; ok: boolean; rejected?: boolean; error?: string; value?: number; nav?: number; source?: string }[];
}