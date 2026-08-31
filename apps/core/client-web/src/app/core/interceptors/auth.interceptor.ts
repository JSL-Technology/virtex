import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth';
import { AuthQueueService } from '../services/auth-queue.service';
import { IS_PUBLIC_API } from '../tokens/http-context.tokens';
import { AuthStatus } from '../../shared/enums/auth-status.enum';
import { readCsrfCookie } from '../auth/csrf-token';
import { Router } from '@angular/router';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const injector = inject(Injector);
  // Inject AuthQueueService (Singleton) to manage state across requests
  const authQueueService = inject(AuthQueueService);

  let authReq = req.clone({
    withCredentials: true,
  });

  // Read the CSRF cookie ourselves rather than through HttpXsrfTokenExtractor.
  //
  // The extractor only knows the name it was configured with, and the server now issues the
  // cookie as `__Host-XSRF-TOKEN` in every deployment — the prefix is what stops a compromised
  // sibling subdomain from overwriting it. Angular's default extractor looks for the unprefixed
  // name, finds nothing, sends no header, and every state-changing request comes back 403.
  const xsrfToken = readCsrfCookie();
  if (xsrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    authReq = authReq.clone({
      headers: authReq.headers.set('X-XSRF-TOKEN', xsrfToken),
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const isUnauthorized = error.status === 401;

      // Verificamos si la ruta es pública usando el HttpContextToken
      const isPublicAuthApiRoute = req.context.get(IS_PUBLIC_API);

      /**
       * The tenant's subscription is not in good standing.
       *
       * Entitlement is now enforced on every authenticated route rather than on the one controller
       * that happened to declare the guard, so a lapsed subscription produces a 403 on every data
       * call at once. Left unhandled that is a wall of failed requests and no explanation; the
       * customer needs to land on the page where they can fix it.
       *
       * Routed once per navigation, not once per failed request: a dashboard fires a dozen calls
       * in parallel and they all fail together.
       */
      const message = String(error.error?.message ?? '');
      if (
        error.status === 403 &&
        (message.startsWith('SUBSCRIPTION_SUSPENDED') || message === 'SUBSCRIPTION_REQUIRED')
      ) {
        const router = injector.get(Router);
        if (!router.url.includes('/settings/billing')) {
          router.navigate(['/settings/billing'], {
            queryParams: { reason: message.split(':')[0] },
          });
        }
        return throwError(() => error);
      }

      // A 401 is only worth answering with a refresh when we believe there is a session to renew.
      // Without this check, any authenticated call made while signed out — a stray component that
      // outlived a logout, a deep link that starts loading before the redirect lands — answers the
      // 401 with a refresh that can only fail, and that failure then triggers a logout of a user
      // who is already logged out. The session state is authoritative here because
      // `resolveSession()` establishes it before the first route is ever evaluated.
      //
      // Resolved lazily, and only once we already know we are on the 401 path, so the interceptor
      // still cannot create the AuthService -> HttpClient -> interceptor construction cycle.
      const needsRefresh =
        isUnauthorized &&
        !isPublicAuthApiRoute &&
        injector.get(AuthService).authStatus() === AuthStatus.authenticated;

      if (needsRefresh) {
        if (!authQueueService.isRefreshingToken) {
          authQueueService.startRefresh();

          // Lazy injection to avoid circular dependency
          const authService = injector.get(AuthService);

          return authService.refreshAccessToken().pipe(
            switchMap((response) => {
              authQueueService.finishRefreshSuccess(); // Emitir valor para liberar la cola

              // Al reintentar la petición, nos aseguramos de usar el token XSRF más reciente
              // por si cambió durante el refresco o la redirección
              const newToken = readCsrfCookie();
              let retryReq = authReq;
              if (
                newToken &&
                !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
              ) {
                retryReq = authReq.clone({
                  headers: authReq.headers.set('X-XSRF-TOKEN', newToken),
                });
              }

              return next(retryReq);
            }),
            catchError((refreshError) => {
              authQueueService.finishRefreshError(); // Emitir false para indicar fallo

              if (refreshError.status === 0) {
                return throwError(() => refreshError);
              }

              // Lazy injection for logout
              const authService = injector.get(AuthService);
              authService.logout(false);
              return throwError(() => refreshError);
            }),
          );
        } else {
          return authQueueService.waitForTokenRefresh().pipe(
            switchMap((tokenSuccess) => {
              if (tokenSuccess === false) {
                return throwError(() => new Error('Token refresh failed'));
              }

              // Igual que arriba, actualizamos el token XSRF antes de reintentar
              const newToken = readCsrfCookie();
              let retryReq = authReq;
              if (
                newToken &&
                !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
              ) {
                retryReq = authReq.clone({
                  headers: authReq.headers.set('X-XSRF-TOKEN', newToken),
                });
              }

              return next(retryReq);
            }),
          );
        }
      }

      return throwError(() => error);
    }),
  );
};
