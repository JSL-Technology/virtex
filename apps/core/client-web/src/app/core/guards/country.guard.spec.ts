import { TestBed } from '@angular/core/testing';
import { CountryGuard } from './country.guard';
import { CountryService } from '../services/country.service';
import { MockCountryService } from '../../../testing/country.service.mock';
import { LanguageService } from '../services/language';
import { GeoLocationService } from '../services/geo-location.service';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { of, throwError } from 'rxjs';


class MockLanguageService {
  // The guard applies the URL's language without persisting it — a market landing page is a link,
  // not a preference. `setLanguage` is here so the test can assert it is NOT called.
  applyRouteLanguage = jest.fn();
  setLanguage = jest.fn();
  currentLanguage = jest.fn().mockReturnValue('es');
}

class MockGeoLocationService {
  checkAndNotifyMismatch = jest.fn();
}

class MockRouter {
  createUrlTree = jest.fn((commands) => commands.join('/'));
  parseUrl = jest.fn((url) => url);
}

describe('CountryGuard', () => {
  let guard: CountryGuard;
  let countryService: MockCountryService;
  let languageService: MockLanguageService;
  let router: MockRouter;
  let geoService: MockGeoLocationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CountryGuard,
        { provide: CountryService, useClass: MockCountryService },
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: GeoLocationService, useClass: MockGeoLocationService },
        { provide: Router, useClass: MockRouter }
      ]
    });

    guard = TestBed.inject(CountryGuard);
    countryService = TestBed.inject(CountryService) as unknown as MockCountryService;
    languageService = TestBed.inject(LanguageService) as unknown as MockLanguageService;
    router = TestBed.inject(Router) as unknown as MockRouter;
    geoService = TestBed.inject(GeoLocationService) as unknown as MockGeoLocationService;
  });

  it('should allow navigation if country and lang are present and valid', (done) => {
    const route = {
      paramMap: {
        get: (key: string) => key === 'country' ? 'do' : 'es'
      }
    } as unknown as ActivatedRouteSnapshot;

    const state = { url: '/es/do/auth/login' } as RouterStateSnapshot;

    const obs = guard.canActivate(route, state);

    if (typeof obs === 'boolean' || obs instanceof Promise || 'urlTree' in (obs as any)) {
      fail('Expected observable');
      return;
    }

    (obs as any).subscribe((result: boolean) => {
      expect(result).toBe(true);
      expect(languageService.applyRouteLanguage).toHaveBeenCalledWith('es');
      expect(languageService.setLanguage).not.toHaveBeenCalled();
      expect(countryService.getCountryConfig).toHaveBeenCalledWith('do');
      done();
    });
  });

  it('should redirect if country fetch fails', (done) => {
    countryService.getCountryConfig.mockReturnValue(throwError(() => new Error('Failed')));
    const route = {
        paramMap: {
          get: (key: string) => key === 'country' ? 'invalid' : 'es'
        }
      } as unknown as ActivatedRouteSnapshot;

      const state = { url: '/es/invalid/auth/login' } as RouterStateSnapshot;

      const obs = guard.canActivate(route, state);

      (obs as any).subscribe((result: any) => {
        // The configuration endpoint is down. Sending the visitor to a country picked at random
        // would be worse than sending them to sign-in, so the guard redirects THERE — and to the
        // sign-in route that actually exists. It used to aim at `/es/do/auth/login`, which is not
        // a route: the country-prefixed branch carries only `register`, so the URL fell through
        // to the global wildcard and bounced onward through a redirect chain nobody intended.
        expect(router.createUrlTree).toHaveBeenCalledWith(['/es/auth/login']);
        expect(result).toBe('/es/auth/login');
        done();
      });
  });
});
