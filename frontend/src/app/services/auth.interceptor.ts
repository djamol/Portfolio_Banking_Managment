import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, catchError, throwError, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { ACTIVE_PORTFOLIO_KEY } from './portfolio.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const portfolioId = localStorage.getItem(ACTIVE_PORTFOLIO_KEY) || 'all';
    const withCreds = req.clone({
      withCredentials: true,
      setHeaders: { 'X-Portfolio-Id': portfolioId }
    });
    return next.handle(withCreds).pipe(
      catchError((err: HttpErrorResponse) => {
        const isAuthEndpoint =
          req.url.includes('/auth/login') || req.url.includes('/auth/logout');

        if (err.status === 401 && !isAuthEndpoint) {
          // Remember me: restore session from encrypted cookie instead of forcing logout
          if (this.auth.hasRememberMe()) {
            return this.auth.silentRelogin().pipe(
              switchMap(() => next.handle(req.clone({
                withCredentials: true,
                setHeaders: { 'X-Portfolio-Id': localStorage.getItem(ACTIVE_PORTFOLIO_KEY) || 'all' }
              }))),
              catchError(() => {
                this.auth.logout();
                return throwError(() => err);
              })
            );
          }

          if (this.auth.isAuthenticated()) {
            this.auth.logout();
          }
        }
        return throwError(() => err);
      })
    );
  }
}
