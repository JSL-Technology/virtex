import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn } from '@angular/router';
import { LanguageService } from '../services/language';

/**
 * Adopt the language named in the URL.
 *
 * The route matcher (`langCodeMatcher` in `app.routes.ts`) only matches a first segment that is a
 * supported language code, so by the time this runs the parameter is already known-good. The
 * guard's previous validation branch — rebuilding the URL with a default language when the
 * segment was unrecognised — was therefore unreachable: no unsupported code could ever get here.
 * It is gone rather than kept as decoration.
 *
 * The language is applied but NOT written to the signed-in user's profile: a link somebody was
 * sent decides what this page renders in, not what that person chose for their account. See
 * `LanguageService.applyRouteLanguage`.
 */
export const languageInitGuard: CanActivateFn = (route: ActivatedRouteSnapshot): boolean => {
  const language = route.params['lang'];
  if (typeof language === 'string') {
    inject(LanguageService).applyRouteLanguage(language);
  }
  return true;
};
