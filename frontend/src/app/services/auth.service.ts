import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, map, of, catchError, tap } from 'rxjs';
import { getApiBaseUrl, normalizeApiDomain } from '../utils/api-url.util';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private username: string | null = null;

  constructor(
    private router: Router,
    private http: HttpClient
  ) {}

  isAuthenticated(): boolean {
    return localStorage.getItem('isLoggedIn') === 'true';
  }

  getUsername(): string | null {
    return this.username || localStorage.getItem('authUsername');
  }

  getApiDomain(): string | null {
    return localStorage.getItem('apiDomain');
  }

  loginLocal(apiDomain: string, username: string): void {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('apiDomain', normalizeApiDomain(apiDomain));
    localStorage.setItem('loginTime', new Date().toISOString());
    localStorage.setItem('authUsername', username);
    this.username = username;
  }

  /** Server login — sets httpOnly session cookie (withCredentials). */
  loginRemote(username: string, password: string, apiDomain: string): Observable<{ username: string }> {
    const base = `${normalizeApiDomain(apiDomain)}/api`;
    return this.http
      .post<{ success: boolean; data?: { username: string }; error?: string }>(
        `${base}/auth/login`,
        { username, password },
        { withCredentials: true }
      )
      .pipe(
        map((r) => {
          if (!r.success || !r.data?.username) {
            throw new Error(r.error || 'Login failed');
          }
          this.loginLocal(apiDomain, r.data.username);
          return r.data;
        })
      );
  }

  logout(): void {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('loginTime');
    localStorage.removeItem('authUsername');
    this.username = null;
    const base = getApiBaseUrl();
    this.http.post(`${base}/auth/logout`, {}, { withCredentials: true }).subscribe({
      error: () => undefined
    });
    this.router.navigate(['/login']);
  }

  checkSession(): Observable<boolean> {
    if (!this.isAuthenticated()) return of(false);
    return this.http
      .get<{ success: boolean; data?: { username: string } }>(`${getApiBaseUrl()}/auth/me`, {
        withCredentials: true
      })
      .pipe(
        tap((r) => {
          if (r.success && r.data?.username) {
            this.username = r.data.username;
            localStorage.setItem('authUsername', r.data.username);
          }
        }),
        map((r) => !!r.success),
        catchError(() => {
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem('authUsername');
          return of(false);
        })
      );
  }

  canActivate(): boolean {
    if (this.isAuthenticated()) {
      return true;
    }
    this.router.navigate(['/login']);
    return false;
  }
}
