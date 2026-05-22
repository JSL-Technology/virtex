import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { LanguageService } from '../services/language';

export const languageInitGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): boolean | UrlTree => {
  const languageService = inject(LanguageService);
  const router = inject(Router);

  // Accessing the 'lang' parameter from the route
  const langParam = route.params['lang'];
  const supportedLangs = ['es', 'en'];

  // 1. Validation: Is the language in the URL supported?
  if (supportedLangs.includes(langParam)) {
    // 2. Initialization: Tell the service to use this language
    languageService.setLanguage(langParam);
    // (The service handles localStorage persistence and updating the <html> tag)

    return true;
  }

  // 3. Error Handling: Redirect to default language if invalid
  const defaultLang = languageService.getInitialLanguage() || 'es';

  // We need to replace the invalid language segment with the default one,
  // or just redirect to the default language root if the path structure is broken.
  // Assuming the structure is /:lang/...
  // We can just redirect to defaultLang + whatever was after, or just default home.
  // For safety/simplicity, let's redirect to default home/root of that language.

  // Construct the new URL.
  // If URL was /fr/home -> redirect to /es/home
  const urlSegments = state.url.split('/').filter(Boolean);
  if (urlSegments.length > 0) {
     urlSegments[0] = defaultLang;
     return router.createUrlTree(['/' + urlSegments.join('/')]);
  }

  return router.createUrlTree(['/' + defaultLang]);
};
