import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

export type FundPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';

export interface FundDayPoint {
  date: string;
  pct: number;
}

export interface FundTrailingReturns {
  d1?: number | null;
  w1?: number | null;
  m1?: number | null;
  m3?: number | null;
  m6?: number | null;
  y1?: number | null;
  y3?: number | null;
  ytd?: number | null;
  fy?: number | null;
}

export interface FundHolding {
  id: number;
  name: string;
  investment_type: string;
  platform: string | null;
  category: string | null;
  sub_type_name: string | null;
  scheme_code: string | null;
  investment_date: string | null;
  units: number | null;
  nav: number | null;
  nav_date: string | null;
  nav_source: string | null;
  current_value: number | null;
  invested_amount: number | null;
  gain: number | null;
  gain_pct: number | null;
  range_return_pct: number | null;
  range_value_change: number | null;
  trailing?: FundTrailingReturns;
  inception_date: string | null;
  inception_return_pct: number | null;
  cagr_pct: number | null;
  volatility_pct: number | null;
  max_drawdown_pct: number | null;
  best_day: FundDayPoint | null;
  worst_day: FundDayPoint | null;
  positive_days_pct: number | null;
  snapshot_count: number;
  first_snapshot: string | null;
  last_snapshot: string | null;
  has_history: boolean;
}
export interface FundPortfolioPoint {
  date: string;
  value: number;
  index: number;
  change_pct: number | null;
  drawdown_pct: number | null;
  holdings: number;
}

export interface FundPeriodRow {
  key: string;
  label: string;
  start: string;
  end: string;
  open_index: number;
  close_index: number;
  change_pct: number | null;
  start_value: number | null;
  end_value: number | null;
  value_change: number | null;
  advancers: number;
  decliners: number;
  best: { id: number; name: string; pct: number } | null;
  worst: { id: number; name: string; pct: number } | null;
}

export interface FundMatrixRow {
  id: number;
  name: string;
  investment_type: string | null;
  platform: string | null;
  category: string | null;
  returns: Record<string, number | null>;
}

export interface FundAllocationRow {
  key: string;
  value: number;
  invested: number;
  gain: number;
  gain_pct: number | null;
  count: number;
}

export interface FundAnalytics {
  generated_at: string;
  period: FundPeriod;
  from: string | null;
  to: string | null;
  options: { types: string[]; platforms: string[]; categories: string[] };
  applied_filters: { types: string[]; platforms: string[]; categories: string[]; ids: number[] };
  summary: {
    holdings: number;
    mutual_funds: number;
    etfs: number;
    tracked_with_history: number;
    current_value: number | null;
    invested_amount: number | null;
    gain: number | null;
    gain_pct: number | null;
    first_date: string | null;
    last_date: string | null;
    snapshot_days: number;
    portfolio_return_pct: number | null;
    portfolio_cagr_pct: number | null;
    volatility_pct: number | null;
    max_drawdown_pct: number | null;
    best_day: FundDayPoint | null;
    worst_day: FundDayPoint | null;
    positive_days_pct: number | null;
    best_holding: FundHolding | null;
    worst_holding: FundHolding | null;
  };
  holdings: FundHolding[];
  portfolio_series: FundPortfolioPoint[];
  period_rows: FundPeriodRow[];
  fund_period_matrix: { periods: { key: string; label: string }[]; funds: FundMatrixRow[] };
  leaders: { best: FundHolding[]; worst: FundHolding[] };
  allocation: {
    by_type: FundAllocationRow[];
    by_platform: FundAllocationRow[];
    by_category: FundAllocationRow[];
  };
}

export interface FundAnalyticsQuery {
  from?: string;
  to?: string;
  period?: FundPeriod;
  types?: string[];
  platforms?: string[];
  categories?: string[];
  topN?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FundAnalyticsService {
  constructor(private http: HttpClient) {}

  load(query: FundAnalyticsQuery): Observable<FundAnalytics> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.period) params = params.set('period', query.period);
    if (query.topN) params = params.set('topN', String(query.topN));
    if (query.types?.length) params = params.set('types', query.types.join(','));
    if (query.platforms?.length) params = params.set('platforms', query.platforms.join(','));
    if (query.categories?.length) params = params.set('categories', query.categories.join(','));

    return this.http
      .get<ApiResponse<FundAnalytics>>(`${getApiBaseUrl()}/fund-analytics`, { params })
      .pipe(map((response) => response.data));
  }
}
