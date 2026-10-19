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
  createUrlTree = jest.fn((commands: string[], extras?: { queryParams?: Record<string, string> }) => {
    const query = new URLSearchParams(extras?.queryParams ?? {}).toString();
    return commands.join('/').replace(/^\/+/, '/') + (query ? `?${query}` : '');
  });
  parseUrl = jest.fn((url: string) => ({ queryParams: Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? '')) }));
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

  /**
   * QA A-13: a failed or unsupported country used to bounce to the sign-in page without a word.
   * It now lands on the country picker, saying which of the two happened.
   */
  it('sends an unreachable configuration to the country picker, flagged as failed', (done) => {
    countryService.getCountryConfig.mockReturnValue(throwError(() => ({ status: 0 })));
    const route = {
      paramMap: { get: (key: string) => (key === 'country' ? 'mx' : 'es') },
    } as unknown as ActivatedRouteSnapshot;

    (guard.canActivate(route, { url: '/es/mx/auth/register' } as RouterStateSnapshot) as any).subscribe(
      (result: string) => {
        expect(result).toBe('/es/auth/choose-country?failed=MX');
        expect(router.createUrlTree).not.toHaveBeenCalledWith(['/es/auth/login']);
        done();
      },
    );
  });

  it('sends a country the product does not serve to the picker, flagged as unsupported', (done) => {
    countryService.getCountryConfig.mockReturnValue(throwError(() => ({ status: 404 })));
    const route = {
      paramMap: { get: (key: string) => (key === 'country' ? 'gb' : 'en') },
    } as unknown as ActivatedRouteSnapshot;

    (guard.canActivate(route, { url: '/en/gb/auth/register' } as RouterStateSnapshot) as any).subscribe(
      (result: string) => {
        expect(result).toBe('/es/auth/choose-country?unsupported=GB');
        done();
      },
    );
  });

  it('keeps the query string the visitor arrived with (an emailed magic link)', (done) => {
    countryService.getCountryConfig.mockReturnValue(throwError(() => ({ status: 404 })));
    const route = {
      paramMap: { get: (key: string) => (key === 'country' ? 'fr' : 'es') },
    } as unknown as ActivatedRouteSnapshot;

    (guard.canActivate(route, { url: '/es/fr/auth/register?email_token=abc' } as RouterStateSnapshot) as any).subscribe(
      (result: string) => {
        expect(result).toBe('/es/auth/choose-country?email_token=abc&unsupported=FR');
        done();
      },
    );
  });

  it('never rewrites the URL to a different country than the one asked for (QA C-06)', (done) => {
    countryService.getCountryConfig.mockReturnValue(of({ countryCode: 'DO' } as any));
    const route = {
      paramMap: { get: (key: string) => (key === 'country' ? 'pt' : 'pt') },
    } as unknown as ActivatedRouteSnapshot;

    (guard.canActivate(route, { url: '/pt/pt/auth/register' } as RouterStateSnapshot) as any).subscribe(
      (result: string) => {
        expect(result).toBe('/es/auth/choose-country?unsupported=PT');
        done();
      },
    );
  });
});
