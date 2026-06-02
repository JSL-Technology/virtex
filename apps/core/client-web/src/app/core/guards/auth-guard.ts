import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { map, take } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
import { AuthStatus } from '../../shared/enums/auth-status.enum';

export const authGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const languageService = inject(LanguageService);

  const status = authService.authStatus();

  if (status === AuthStatus.authenticated) {
    return of(true);
  }

  if (status === AuthStatus.unauthenticated) {
    const lang = languageService.currentLang() || 'es';
    return of(router.createUrlTree(['/', lang, 'auth', 'login']));
  }

  // Status is still pending (e.g. guard runs before APP_INITIALIZER resolves)
  return authService.checkAuthStatus().pipe(
    take(1),
    map(isAuthenticated => {
      if (isAuthenticated) return true;
      const lang = languageService.currentLang() || 'es';
      return router.createUrlTree(['/', lang, 'auth', 'login']);
    })
  );
};
