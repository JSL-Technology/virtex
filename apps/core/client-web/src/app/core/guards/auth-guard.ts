import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { ReturnUrlService, isLandingUrl } from '../auth/return-url';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

/**
 * Admission to the authenticated shell.
 *
 * It asks `resolveSession()` unconditionally and without special-casing the pending state. That
 * reads as if it costs a request per navigation, and it used to: `checkAuthStatus()` re-fetched
 * every time, so this guard had to branch on the status signal to avoid it — and branched wrongly,
 * because `checkAuthStatus()` set the status back to `pending` on entry, so the "fast path" was
 * unreachable exactly when it mattered. `resolveSession()` is memoised, so after bootstrap this
 * settles synchronously from the replayed value. One question, asked plainly, answered once.
 *
 * ## The link someone opened survives the sign-in
 *
 * Turned away, the page that was asked for is remembered (see `ReturnUrlService`) and named on the
 * sign-in page as `returnUrl`. Admitted on the workspace home with a destination still pending —
 * the way back from Google or single sign-on, which the server lands on the home page — the guard
 * sends the person on to the page they wanted. Admitted anywhere else, the person chose where to
 * go, and a destination left over from an abandoned sign-in is dropped rather than allowed to
 * hijack a later navigation.
 */
export const authGuard: CanActivateFn = (_route, state?: RouterStateSnapshot): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const languageService = inject(LanguageService);
  const returnUrl = inject(ReturnUrlService);
  const target = state?.url ?? '';

  return authService.resolveSession().pipe(
    map((isAuthenticated) => {
      if (isAuthenticated) {
        if (!isLandingUrl(target)) {
          returnUrl.clear();
          return true;
        }
        const pending = returnUrl.consume();
        return pending ? router.parseUrl(pending) : true;
      }

      const lang = languageService.currentLang() || 'es';
      const destination = returnUrl.remember(target);
      // A session the client ended while loading — found idle past its window — is explained on
      // the page the person lands on, like one that ended while they were looking.
      const reason = authService.consumeSignOutReason();
      const queryParams: Record<string, string> = {};
      if (reason) queryParams['reason'] = reason;
      if (destination) queryParams['returnUrl'] = destination;
      const login = ['/', lang, 'auth', 'login'];
      return Object.keys(queryParams).length
        ? router.createUrlTree(login, { queryParams })
        : router.createUrlTree(login);
    }),
  );
};
