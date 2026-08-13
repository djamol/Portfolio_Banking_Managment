import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, map, of, catchError, tap, from, switchMap, shareReplay, finalize } from 'rxjs';
import { getApiBaseUrl, normalizeApiDomain } from '../utils/api-url.util';
import { decryptJson, encryptJson } from '../utils/storage-crypto.util';
import { deleteCookie, getCookie, setCookie } from '../utils/cookie.util';

const REMEMBER_COOKIE = 'pfm_remember';
const REMEMBER_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export type RememberCredentials = {
  username: string;
  password: string;
  apiDomain: string;
};

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private username: string | null = null;
  private silentRelogin$?: Observable<{ username: string }>;

  constructor(
    private router: Router,
    private http: HttpClient
  ) {}

  isAuthenticated(): boolean {
    return (
      localStorage.getItem('isLoggedIn') === 'true' ||
      sessionStorage.getItem('isLoggedIn') === 'true'
    );
  }

  /** True when user opted into persistent login (encrypted cookie present). */
  hasRememberMe(): boolean {
    return localStorage.getItem('rememberLogin') === 'true' && !!getCookie(REMEMBER_COOKIE);
  }

  getUsername(): string | null {
    return (
      this.username ||
      localStorage.getItem('authUsername') ||
      sessionStorage.getItem('authUsername')
    );
  }

  getApiDomain(): string | null {
    return localStorage.getItem('apiDomain');
  }

  loginLocal(apiDomain: string, username: string, rememberMe = false): void {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('authUsername');
    localStorage.removeItem('loginTime');
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('authUsername');
    sessionStorage.removeItem('loginTime');

    const store = rememberMe ? localStorage : sessionStorage;
    store.setItem('isLoggedIn', 'true');
    store.setItem('authUsername', username);
    store.setItem('loginTime', new Date().toISOString());
    localStorage.setItem('apiDomain', normalizeApiDomain(apiDomain));
    localStorage.setItem('rememberLogin', rememberMe ? 'true' : 'false');
    this.username = username;
  }

  /** Server login — sets httpOnly session cookie (withCredentials). */
  loginRemote(
    username: string,
    password: string,
    apiDomain: string,
    rememberMe = false
  ): Observable<{ username: string }> {
    const base = `${normalizeApiDomain(apiDomain)}/api`;
    return this.http
      .post<{ success: boolean; data?: { username: string }; error?: string }>(
        `${base}/auth/login`,
        { username, password, rememberMe },
        { withCredentials: true }
      )
      .pipe(
        switchMap((r) => {
          if (!r.success || !r.data?.username) {
            throw new Error(r.error || 'Login failed');
          }
          this.loginLocal(apiDomain, r.data.username, rememberMe);
          if (rememberMe) {
            return from(this.saveRememberCredentials({ username, password, apiDomain })).pipe(
              map(() => r.data!)
            );
          }
          this.clearRememberCredentials();
          return of(r.data);
        })
      );
  }

  async loadRememberCredentials(): Promise<RememberCredentials | null> {
    const raw = getCookie(REMEMBER_COOKIE);
    if (!raw) return null;
    try {
      const parsed = await decryptJson<RememberCredentials>(raw);
      if (!parsed?.username || !parsed?.password || !parsed?.apiDomain) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async saveRememberCredentials(creds: RememberCredentials): Promise<void> {
    try {
      const encrypted = await encryptJson({
        username: creds.username,
        password: creds.password,
        apiDomain: normalizeApiDomain(creds.apiDomain)
      });
      setCookie(REMEMBER_COOKIE, encrypted, { maxAgeSeconds: REMEMBER_MAX_AGE_SEC });
    } catch {
      deleteCookie(REMEMBER_COOKIE);
    }
  }

  clearRememberCredentials(): void {
    deleteCookie(REMEMBER_COOKIE);
    localStorage.removeItem('rememberLogin');
  }

  /**
   * Re-authenticate using encrypted remember cookie (e.g. after server restart).
   * Shared so concurrent 401s only trigger one login.
   */
  silentRelogin(): Observable<{ username: string }> {
    if (!this.silentRelogin$) {
      this.silentRelogin$ = from(this.loadRememberCredentials()).pipe(
        switchMap((creds) => {
          if (!creds) {
            throw new Error('No remember credentials');
          }
          return this.loginRemote(creds.username, creds.password, creds.apiDomain, true);
        }),
        finalize(() => {
          this.silentRelogin$ = undefined;
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.silentRelogin$;
  }

  logout(): void {
    this.clearRememberCredentials();
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('loginTime');
    localStorage.removeItem('authUsername');
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('loginTime');
    sessionStorage.removeItem('authUsername');
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
            const store =
              localStorage.getItem('rememberLogin') === 'true' ? localStorage : sessionStorage;
            store.setItem('authUsername', r.data.username);
          }
        }),
        map((r) => !!r.success),
        catchError(() => {
          if (this.hasRememberMe()) {
            return this.silentRelogin().pipe(
              map(() => true),
              catchError(() => {
                this.clearClientAuthFlags();
                return of(false);
              })
            );
          }
          this.clearClientAuthFlags();
          return of(false);
        })
      );
  }

  private clearClientAuthFlags(): void {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('authUsername');
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('authUsername');
  }

  canActivate(): boolean {
    if (this.isAuthenticated()) {
      return true;
    }
    this.router.navigate(['/login']);
    return false;
  }
}
