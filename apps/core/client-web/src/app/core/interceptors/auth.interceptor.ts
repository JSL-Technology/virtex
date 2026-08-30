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
import { Router } from '@angular/router';

/**
 * Names the CSRF cookie may carry, most-secure first.
 *
 * Production issues `__Host-XSRF-TOKEN`; local plain-HTTP development cannot, because the prefix
 * mandates `Secure` and browsers reject a Secure cookie over HTTP. Both are read so the same build
 * works in either.
 *
 * NOTE: this reads `document.cookie` on the SPA's own origin. The cookie is host-only (it carries
 * no `Domain`, and `__Host-` forbids one), so the API must be served from the SAME origin as the
 * client — a path prefix such as `https://app.example.com/api/v1`, or a reverse proxy that fronts
 * both. A split-subdomain deployment cannot work: the browser would not expose the cookie here,
 * and `SameSite=Lax` session cookies would not be attached to the API calls either. See
 * docs/DEPLOYMENT.md.
 */
const CSRF_COOKIE_NAMES = ['__Host-XSRF-TOKEN', 'XSRF-TOKEN'] as const;

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const name of CSRF_COOKIE_NAMES) {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}=([^;]*)`),
    );
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

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

      if (isUnauthorized && !isPublicAuthApiRoute) {
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
