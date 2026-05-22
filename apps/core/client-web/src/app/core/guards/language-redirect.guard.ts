import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  UrlTree,
} from '@angular/router';
import { LanguageService } from '../services/language';
import { AuthService } from '../services/auth';

export const languageRedirectGuard: CanActivateFn = (): boolean | UrlTree => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const languageService = inject(LanguageService);

  // 1. Check if user is logged in
  if (authService.isAuthenticated()) {
    // If logged in, redirect to the clean authenticated route (e.g. /dashboard)
    return router.createUrlTree(['/dashboard']);
  }

  // 2. If not logged in, determine the best language for the public landing page
  const bestLang = languageService.getInitialLanguage();

  // 3. Redirect to the language-prefixed public route (e.g. /es/auth/login)
  // The user prompt mentioned /es/home, but in this app the main public entry seems to be auth/login
  // or we can redirect to /es and let the child routes handle it if there is a default child.
  // In app.routes.ts, :lang has children. If we redirect to /es, it matches :lang but needs a child?
  // If :lang has no component and only children, we need to target a specific child.
  // Looking at app.routes.ts, ':lang/auth/login' exists.

  return router.createUrlTree([`/${bestLang}/auth/login`]);
};
