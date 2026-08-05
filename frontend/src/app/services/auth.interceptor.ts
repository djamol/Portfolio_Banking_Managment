import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const withCreds = req.clone({ withCredentials: true });
    return next.handle(withCreds).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/logout')) {
          if (this.auth.isAuthenticated()) {
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('authUsername');
            this.auth.logout();
          }
        }
        return throwError(() => err);
      })
    );
  }
}
