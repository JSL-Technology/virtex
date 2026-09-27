import {
  HttpContextToken,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Observable, defaultIfEmpty, switchMap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { StepUpService, stepUpScopeOf } from '../services/step-up.service';

/** Marks a request that is already the retry after a step-up, so it is never prompted twice. */
export const STEP_UP_RETRIED = new HttpContextToken<boolean>(() => false);

const NO_RESULT = Symbol('step-up-cancelled');

/**
 * Answers a step-up challenge wherever it comes from, then repeats the request once.
 *
 * ## Why this is in the HTTP layer
 *
 * Which routes need a fresh proof of identity is decided by the server, and it grows: payroll
 * approval, payslips, supplier payments, bank transfers, bank-account edits. Each screen used to
 * have to know which of its own calls were guarded and ask up front; the ones that did not know
 * (payroll approval and payslips) failed with a 401 the user could do nothing about — and that
 * 401 was then treated as an expired session, refreshed, and failed again.
 *
 * The server names the scope it wants in the error. This asks the user for exactly that proof,
 * repeats the original request once, and hands its result to the caller as if nothing had
 * happened. If the user cancels, the caller receives the original error.
 *
 * Registered INSIDE `authInterceptor`, so the challenge is handled here before the auth layer can
 * mistake it for an expired session.
 */
export const stepUpInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const injector = inject(Injector);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const scope = stepUpScopeOf(error);
      if (!scope || req.context.get(STEP_UP_RETRIED)) {
        return throwError(() => error);
      }

      const stepUp = injector.get(StepUpService);
      const host = stepUp.defaultHost;
      if (!host) return throwError(() => error);

      const retry = req.clone({ context: req.context.set(STEP_UP_RETRIED, true) });
      return stepUp
        .requireStepUp<HttpEvent<unknown> | typeof NO_RESULT>(scope, host, () => next(retry))
        .pipe(
          defaultIfEmpty(NO_RESULT as typeof NO_RESULT),
          switchMap((event) =>
            event === NO_RESULT
              ? throwError(() => error)
              : new Observable<HttpEvent<unknown>>((subscriber) => {
                  subscriber.next(event as HttpEvent<unknown>);
                  subscriber.complete();
                }),
          ),
        );
    }),
  );
};
