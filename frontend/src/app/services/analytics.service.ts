import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_URL = 'http://localhost:3000/api';

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  constructor(private http: HttpClient) {}

  getTotal(): Observable<{ success: boolean; data: { total_amount: number; total_investments: number } }> {
    return this.http.get<{ success: boolean; data: { total_amount: number; total_investments: number } }>(`${API_URL}/analytics/total`);
  }

  getByType(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/by-type`);
  }

  getByMonth(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/by-month`);
  }

  getByYear(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/by-year`);
  }

  getMonthlyChanges(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/monthly-changes`);
  }

  getYearlyChanges(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/yearly-changes`);
  }

  getByPlatform(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/by-platform`);
  }

  getGrowth(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/growth`);
  }

  getBySubTypeName(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/by-sub-type-name`);
  }

  getBySubTypeCategory(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/by-sub-type-category`);
  }

  getSummaryTable(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/summary-table`);
  }

  getInvestmentHistory(id: number): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/analytics/investment-history/${id}`);
  }
}