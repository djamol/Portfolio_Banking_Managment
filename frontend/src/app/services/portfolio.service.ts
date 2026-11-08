import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of, tap } from 'rxjs';
import { getApiBaseUrl } from '../utils/api-url.util';

export const ACTIVE_PORTFOLIO_KEY = 'pfmActivePortfolio';

export type WorkspaceUser = {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member' | string;
  is_active?: number;
};

export type WorkspacePortfolio = {
  id: number;
  name: string;
  description: string;
  color: string;
  is_default: boolean;
  owner_user_id: number;
  owner_name: string;
  owner_username: string;
  investment_count?: number;
  investment_total?: number;
  account_count?: number;
};

export type WorkspaceContext = {
  user: WorkspaceUser;
  portfolios: WorkspacePortfolio[];
  users: WorkspaceUser[];
  scopeMode: 'all' | 'one';
  activePortfolioId: number | 'all';
  writePortfolioId: number | null;
};

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private loaded = false;
  activeId = localStorage.getItem(ACTIVE_PORTFOLIO_KEY) || 'all';
  context$ = new BehaviorSubject<WorkspaceContext | null>(null);
  summary$ = new BehaviorSubject<WorkspacePortfolio[]>([]);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  private url(path: string): string {
    return `${getApiBaseUrl()}/workspace${path}`;
  }

  loadContext(force = false): Observable<{ success: boolean; data: WorkspaceContext }> {
    if (!force && this.loaded && this.context$.value) {
      return of({ success: true, data: this.context$.value });
    }
    return this.http
      .get<{ success: boolean; data: WorkspaceContext }>(this.url('/context'), { withCredentials: true })
      .pipe(tap((res) => {
        this.loaded = true;
        const data = res.data;
        const known = data?.portfolios || [];
        const ok = this.activeId === 'all' || known.some((row) => String(row.id) === String(this.activeId));
        if (!ok) this.activeId = 'all';
        localStorage.setItem(ACTIVE_PORTFOLIO_KEY, this.activeId);
        this.context$.next(data);
      }));
  }

  ensureContext(): Observable<{ success: boolean; data: WorkspaceContext }> | null {
    if (this.loaded && this.context$.value) return null;
    return this.loadContext();
  }

  loadSummary(): Observable<{ success: boolean; data: WorkspacePortfolio[] }> {
    return this.http
      .get<{ success: boolean; data: WorkspacePortfolio[] }>(this.url('/summary'), { withCredentials: true })
      .pipe(tap((res) => this.summary$.next(res.data || [])));
  }

  setActive(id: number | string): void {
    const next = id == null || id === '' ? 'all' : String(id);
    if (next === this.activeId) return;
    this.activeId = next;
    localStorage.setItem(ACTIVE_PORTFOLIO_KEY, next);
    const url = this.router.url || '/dashboard';
    const strategy = this.router.routeReuseStrategy;
    const previous = strategy.shouldReuseRoute.bind(strategy);
    strategy.shouldReuseRoute = () => false;
    this.router.navigateByUrl(url).finally(() => {
      strategy.shouldReuseRoute = previous;
    });
  }

  createUser(body: { username: string; password: string; display_name: string; role: string }) {
    return this.http.post<{ success: boolean; data: { user: WorkspaceUser; portfolioId: number }; error?: string }>(
      this.url('/users'),
      body,
      { withCredentials: true }
    );
  }

  updateUser(id: number, body: { display_name?: string; role?: string; is_active?: number; password?: string }) {
    return this.http.put<{ success: boolean; data: WorkspaceUser; error?: string }>(
      this.url(`/users/${id}`),
      body,
      { withCredentials: true }
    );
  }

  createPortfolio(body: { name: string; description?: string; color?: string; owner_user_id?: number | null }) {
    return this.http.post<{ success: boolean; data: WorkspacePortfolio; error?: string }>(
      this.url('/portfolios'),
      body,
      { withCredentials: true }
    );
  }

  updatePortfolio(id: number, body: { name?: string; description?: string; color?: string; is_default?: boolean }) {
    return this.http.put<{ success: boolean; data: WorkspacePortfolio; error?: string }>(
      this.url(`/portfolios/${id}`),
      body,
      { withCredentials: true }
    );
  }

  deletePortfolio(id: number) {
    return this.http.delete<{ success: boolean; error?: string }>(this.url(`/portfolios/${id}`), {
      withCredentials: true
    });
  }

  clear(): void {
    this.loaded = false;
    this.context$.next(null);
    this.summary$.next([]);
  }
}
