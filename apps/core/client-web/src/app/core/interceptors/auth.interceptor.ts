import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
  HttpXsrfTokenExtractor,
} from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, switchMap, retry } from 'rxjs/operators';
import { AuthService } from '../services/auth';
import { AuthQueueService } from '../services/auth-queue.service';
import { IS_PUBLIC_API } from '../tokens/http-context.tokens';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const injector = inject(Injector);
  // Inject AuthQueueService (Singleton) to manage state across requests
  const authQueueService = inject(AuthQueueService);
  // Inyectar el extractor de tokens para manejar CSRF manualmente
  const tokenExtractor = inject(HttpXsrfTokenExtractor);

  let authReq = req.clone({
    withCredentials: true,
  });

  // Obtener el token XSRF de las cookies y agregarlo a los headers manualmente
  // Esto es necesario porque withFetch() o ciertas configuraciones pueden omitir la inclusión automática
  const xsrfToken = tokenExtractor.getToken();
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

      if (isUnauthorized && !isPublicAuthApiRoute) {
        if (!authQueueService.isRefreshingToken) {
          authQueueService.startRefresh();

          // Lazy injection to avoid circular dependency
          const authService = injector.get(AuthService);

          return authService.refreshAccessToken().pipe(
            // Reintentar si falla por error de red (status 0) o 5xx
            retry({
              count: 3,
              delay: (err, retryCount) => {
                const isIdempotent = [
                  'GET',
                  'HEAD',
                  'PUT',
                  'DELETE',
                  'OPTIONS',
                ].includes(req.method);

                if (err.status === 0 || (err.status >= 500 && isIdempotent)) {
                  // Exponential Backoff: 1s, 2s, 4s
                  return timer(1000 * Math.pow(2, retryCount - 1));
                }
                return throwError(() => err);
              },
            }),
            switchMap((response) => {
              authQueueService.finishRefreshSuccess(); // Emitir valor para liberar la cola

              // Al reintentar la petición, nos aseguramos de usar el token XSRF más reciente
              // por si cambió durante el refresco o la redirección
              const newToken = tokenExtractor.getToken();
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
              const newToken = tokenExtractor.getToken();
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
