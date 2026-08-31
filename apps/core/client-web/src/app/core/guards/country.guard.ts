import { Injectable, inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivate,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { CountryService } from '../services/country.service';
import { LanguageService } from '../services/language';
import { GeoLocationService } from '../services/geo-location.service';

/**
 * Resolves the `:country` segment of the signup routes (`/es/do/auth/register`).
 *
 * The language part of the URL is applied through `LanguageService.applyRouteLanguage`, not
 * `setLanguage`: a country-and-language link is somebody being sent to a market's signup form,
 * which decides what this page renders in and must not rewrite the account preference of a user
 * who happens to already have one.
 */
@Injectable({ providedIn: 'root' })
export class CountryGuard implements CanActivate {
  private countryService = inject(CountryService);
  private languageService = inject(LanguageService);
  private geoService = inject(GeoLocationService);
  private router = inject(Router);

  /**
   * Where an unusable URL goes.
   *
   * This used to be `/es/do/auth/login`, which is not a route: the country-prefixed branch of the
   * router carries only `register`. The URL fell through to the global wildcard and bounced to
   * `/es/auth/login` through a redirect chain nobody intended — it worked by accident. The
   * sign-in page has no country segment, so the language alone is what belongs here.
   */
  private signInUrl(): UrlTree {
    return this.router.createUrlTree([`/${this.languageService.currentLanguage()}/auth/login`]);
  }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> | boolean | UrlTree {
    const countryCode = route.paramMap.get('country');
    const langCode = route.paramMap.get('lang');

    if (langCode) this.languageService.applyRouteLanguage(langCode);
    if (!countryCode || !langCode) return this.signInUrl();

    return this.countryService.getCountryConfig(countryCode).pipe(
      map((config) => {
        // The service answers with a default profile when the URL names a country it does not
        // know, so a mismatch between what was asked for and what came back means the URL is
        // wrong. Rewriting it — rather than rendering a Dominican form under `/mx/` — keeps the
        // address bar and the form telling the same story.
        if (config && config.countryCode.toLowerCase() !== countryCode.toLowerCase()) {
          const segments = state.url.split('/');
          if (segments.length > 2) {
            segments[2] = config.countryCode.toLowerCase();
            return this.router.parseUrl(segments.join('/'));
          }
        }
        return true;
      }),
      tap(() => this.geoService.checkAndNotifyMismatch(countryCode)),
      catchError(() => {
        // The configuration endpoint is unreachable. Sending the visitor to a country picked at
        // random would be worse than sending them to sign-in, where the message is at least
        // truthful about what happened.
        return of(this.signInUrl());
      }),
    );
  }
}
