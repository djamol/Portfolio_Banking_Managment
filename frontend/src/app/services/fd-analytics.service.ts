import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

export type PayoutFrequency = 'at-maturity' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';
export type CompoundingFrequency = 'simple' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';

export interface FdDeposit {
  id: number;
  name: string;
  investment_type: string;
  platform: string | null;
  sub_type_name: string | null;
  category: string | null;
  investment_date: string | null;
  maturity_date: string | null;
  maturity_source: 'field' | 'notes' | null;
  interest_rate: number | null;
  rate_source: 'field' | 'notes' | null;
  implied_rate_pct: number | null;
  post_tax_rate_pct: number | null;
  payout_frequency: PayoutFrequency;
  compounding: CompoundingFrequency | null;
  principal: number | null;
  book_amount: number | null;
  current_value: number | null;
  maturity_amount: number | null;
  total_interest: number | null;
  post_tax_interest: number | null;
  accrued_interest: number | null;
  received_interest: number | null;
  earned_interest: number | null;
  pending_interest: number | null;
  periodic_payout: number | null;
  annual_income: number | null;
  monthly_income: number | null;
  tenure_days: number | null;
  tenure_months: number | null;
  tenure_band: string;
  rate_band: string;
  days_to_maturity: number | null;
  progress_pct: number | null;
  matured: boolean;
  is_cumulative: boolean;
  notes: string | null;
}

export interface FdLadderBucket {
  key: string;
  label: string;
  count: number;
  principal: number;
  maturity_amount: number;
  interest: number;
  deposits: { id: number; name: string; amount: number }[];
}

export interface FdCashflowMonth {
  key: string;
  label: string;
  interest: number;
  maturity: number;
  total: number;
}

export interface FdProjectionPoint {
  key: string;
  label: string;
  date: string;
  locked: number;
  released: number;
  accrued: number;
  total: number;
  active: number;
  projected: boolean;
}

export interface FdAllocationRow {
  key: string;
  count: number;
  principal: number;
  current_value: number;
  maturity_amount: number;
  interest: number;
  avg_rate_pct: number | null;
  weight_pct: number | null;
}

export interface FdMaturityWindow {
  days: number;
  until: string;
  count: number;
  principal: number;
  proceeds: number;
}

export interface FdAnalytics {
  generated_at: string;
  as_of: string;
  tax_rate_pct: number;
  horizon_months: number;
  options: {
    types: string[];
    platforms: string[];
    categories: string[];
    payout_frequencies: PayoutFrequency[];
    compounding: CompoundingFrequency[];
  };
  applied_filters: { types: string[]; platforms: string[]; categories: string[] };
  summary: {
    deposits: number;
    active: number;
    matured: number;
    principal: number;
    current_value: number;
    maturity_value: number;
    accrued_interest: number;
    received_interest: number;
    earned_interest: number;
    pending_interest: number;
    total_interest: number;
    post_tax_interest: number;
    avg_rate_pct: number | null;
    post_tax_avg_rate_pct: number | null;
    avg_remaining_years: number | null;
    annual_income: number;
    monthly_income: number;
    payout_annual_income: number;
    best_rate: { id: number; name: string; rate: number } | null;
    worst_rate: { id: number; name: string; rate: number } | null;
    next_maturity: { id: number; name: string; date: string; days: number; amount: number } | null;
    maturing: FdMaturityWindow[];
    overdue: { id: number; name: string; maturity_date: string; days_overdue: number; amount: number }[];
  };
  deposits: FdDeposit[];
  ladder: {
    by_month: FdLadderBucket[];
    by_year: FdLadderBucket[];
    by_financial_year: FdLadderBucket[];
  };
  cashflow_calendar: FdCashflowMonth[];
  value_projection: FdProjectionPoint[];
  allocation: {
    by_platform: FdAllocationRow[];
    by_type: FdAllocationRow[];
    by_category: FdAllocationRow[];
    by_rate_band: FdAllocationRow[];
    by_tenure_band: FdAllocationRow[];
    by_payout: FdAllocationRow[];
  };
  data_quality: {
    missing_rate: { id: number; name: string }[];
    missing_maturity: { id: number; name: string }[];
    from_notes: { id: number; name: string; maturity_source: string | null; rate_source: string | null }[];
  };
}

export interface FdAnalyticsQuery {
  asOf?: string;
  taxRatePct?: number;
  horizonMonths?: number;
  types?: string[];
  platforms?: string[];
  categories?: string[];
  refresh?: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FdAnalyticsService {
  constructor(private http: HttpClient) {}

  load(query: FdAnalyticsQuery): Observable<FdAnalytics> {
    let params = new HttpParams();
    if (query.asOf) params = params.set('asOf', query.asOf);
    if (query.taxRatePct !== undefined) params = params.set('taxRatePct', String(query.taxRatePct));
    if (query.horizonMonths) params = params.set('horizonMonths', String(query.horizonMonths));
    if (query.refresh) params = params.set('refresh', '1');
    if (query.types?.length) params = params.set('types', query.types.join(','));
    if (query.platforms?.length) params = params.set('platforms', query.platforms.join(','));
    if (query.categories?.length) params = params.set('categories', query.categories.join(','));

    return this.http
      .get<ApiResponse<FdAnalytics>>(`${getApiBaseUrl()}/fd-analytics`, { params })
      .pipe(map((response) => response.data));
  }
}
