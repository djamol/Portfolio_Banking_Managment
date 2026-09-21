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
}