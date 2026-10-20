import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Routes that ARE the session machinery: a 401 from them is an answer, never a reason to renew. */
const SESSION_ROUTES = /\/auth\/(login|refresh|logout|session|verify-2fa)\b/;

/**
 * An expired access token is renewed once and the request replayed; a session that cannot be
 * renewed sends the till to the sign-in screen, saying why, instead of failing every button.
 *
 * The cart lives in memory and survives the round trip only if the cashier signs back in on the same
 * page load; the shift is on the server and is adopted again after sign-in, so no takings are lost.
 */
export const sessionExpiryInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || SESSION_ROUTES.test(req.url)) {
        return throwError(() => error);
      }
      return auth.refresh().pipe(
        switchMap((renewed) => {
          if (renewed) return next(req.clone());
          auth.sessionLost();
          void router.navigate(['/login'], { queryParams: { reason: 'expired' } });
          return throwError(() => error);
        }),
      );
    }),
  );
};
