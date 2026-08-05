import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse, BankAccount } from './banking.models';
import { bankApiUrl } from './bank-api.util';

@Injectable({ providedIn: 'root' })
export class BankAccountsService {
  constructor(private http: HttpClient) {}

  getAccounts(): Observable<BankAccount[]> {
    return this.http.get<ApiResponse<BankAccount[]>>(bankApiUrl('accounts')).pipe(
      map((r) => (r.success ? r.data : []))
    );
  }

  createAccount(data: Partial<BankAccount>): Observable<BankAccount | null> {
    return this.http.post<ApiResponse<BankAccount>>(bankApiUrl('accounts'), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  updateAccount(id: number, data: Partial<BankAccount>): Observable<BankAccount | null> {
    return this.http.put<ApiResponse<BankAccount>>(bankApiUrl(`accounts/${id}`), data).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }

  deleteAccount(id: number): Observable<boolean> {
    return this.http.delete<ApiResponse<any>>(bankApiUrl(`accounts/${id}`)).pipe(
      map((r) => !!r.success)
    );
  }

  getContinuity(accountId: number): Observable<any> {
    return this.http.get<ApiResponse<any>>(bankApiUrl(`accounts/${accountId}/continuity`)).pipe(
      map((r) => (r.success ? r.data : null))
    );
  }
}
