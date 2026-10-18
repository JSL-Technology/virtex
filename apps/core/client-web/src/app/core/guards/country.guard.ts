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
   * Where an unusable country URL goes: the country picker, never the sign-in page (QA A-13).
   *
   * This used to send the visitor to `/{lang}/auth/login`. For a country the product does not
   * serve, or a moment when the configuration could not be loaded, the signup button therefore
   * looped back to sign-in without a word — the QA run hit it for Mexico, Colombia and Ecuador
   * during an API hiccup, and for a visitor from Spain every time. The picker says which of the
   * two happened, offers the countries that ARE served and a retry, and keeps whatever query
   * string the visitor arrived with (an emailed magic link's token).
   */
  private pickerUrl(reason: 'unsupported' | 'failed', countryCode: string, state: RouterStateSnapshot): UrlTree {
    const current = this.router.parseUrl(state.url);
    return this.router.createUrlTree(['/', this.languageService.currentLanguage(), 'auth', 'register'], {
      queryParams: { ...current.queryParams, [reason]: countryCode.toUpperCase() },
    });
  }

  /** A route with no language or country at all: the picker, without a reason to report. */
  private bareSignupUrl(): UrlTree {
    return this.router.createUrlTree(['/', this.languageService.currentLanguage(), 'auth', 'register']);
  }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> | boolean | UrlTree {
    const countryCode = route.paramMap.get('country');
    const langCode = route.paramMap.get('lang');

    if (langCode) this.languageService.applyRouteLanguage(langCode);
    if (!countryCode || !langCode) return this.bareSignupUrl();

    return this.countryService.getCountryConfig(countryCode).pipe(
      map((config) => {
        // A configuration for a DIFFERENT country than the URL names means the one asked for is
        // not served. This used to rewrite the URL to the other country — which is how a visitor
        // from the UK landed on a Dominican form (QA C-06). The visitor chooses instead.
        if (config && config.countryCode.toLowerCase() !== countryCode.toLowerCase()) {
          return this.pickerUrl('unsupported', countryCode, state);
        }
        return true;
      }),
      tap(() => this.geoService.checkAndNotifyMismatch(countryCode)),
      catchError((error: { status?: number } | undefined) =>
        // 404 is the server saying the country is not one it registers tenants in; anything else
        // is the configuration being unreachable right now, which a retry can fix.
        of(this.pickerUrl(error?.status === 404 ? 'unsupported' : 'failed', countryCode, state)),
      ),
    );
  }
}
