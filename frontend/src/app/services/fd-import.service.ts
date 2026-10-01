import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';
import { PayoutFrequency } from './fd-analytics.service';

export interface FdStatementDeposit {
  account_no: string | null;
  branch: string | null;
  holder: string | null;
  currency: string;
  principal: number;
  maturity_amount: number | null;
  maturity_date: string | null;
  start_date: string | null;
  interest_rate: number | null;
  payout_frequency: PayoutFrequency | null;
  cumulative: boolean;
  tenure_category: string | null;
  external_ref: string | null;
  existing_id: number | null;
  existing_amount: number | null;
  status: 'new' | 'update' | 'unchanged';
  selected?: boolean;
}

export interface FdStatementPreview {
  bank: string | null;
  holder: string | null;
  skipped: number;
  count: number;
  total_principal: number;
  deposits: FdStatementDeposit[];
}

export interface FdImportRequest {
  platform: string;
  investment_type?: string;
  sub_type_name?: string;
  payout_frequency?: PayoutFrequency;
  compounding?: string;
  deposits: FdStatementDeposit[];
}

export interface FdImportResult {
  imported: number;
  updated: number;
  errors: string[];
  totalProcessed: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FdImportService {
  constructor(private http: HttpClient) {}

  preview(file: File, password = ''): Observable<FdStatementPreview> {
    const form = new FormData();
    form.append('file', file);
    if (password) form.append('password', password);
    return this.http
      .post<ApiResponse<FdStatementPreview>>(`${getApiBaseUrl()}/investments/import/fd/preview`, form)
      .pipe(map((response) => response.data));
  }

  import(request: FdImportRequest): Observable<FdImportResult> {
    return this.http
      .post<ApiResponse<FdImportResult>>(`${getApiBaseUrl()}/investments/import/fd`, request)
      .pipe(map((response) => response.data));
  }
}
