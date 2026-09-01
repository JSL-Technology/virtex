import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';

/**
 * Where a visitor lands when they ask for a URL that names no language.
 *
 * A signed-in user goes to the workspace, whose routes carry no language prefix — the language
 * follows the session, not the URL, once there is a session. Everyone else is sent to the sign-in
 * page under the language already resolved for this device, so the first screen a stranger sees
 * is in their own language rather than in the default one.
 */
export const languageRedirectGuard: CanActivateFn = (): boolean | UrlTree => {
  const router = inject(Router);

  if (inject(AuthService).isAuthenticated()) {
    return router.createUrlTree(['/overview']);
  }

  return router.createUrlTree([`/${inject(LanguageService).currentLanguage()}/auth/login`]);
};
