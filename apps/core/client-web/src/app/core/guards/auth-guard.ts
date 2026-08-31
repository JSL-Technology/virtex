import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
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
 */
export const authGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const languageService = inject(LanguageService);

  return authService.resolveSession().pipe(
    map((isAuthenticated) => {
      if (isAuthenticated) return true;
      const lang = languageService.currentLang() || 'es';
      return router.createUrlTree(['/', lang, 'auth', 'login']);
    }),
  );
};
