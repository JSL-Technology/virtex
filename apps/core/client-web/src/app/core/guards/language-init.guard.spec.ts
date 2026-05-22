import { TestBed } from '@angular/core/testing';
import { languageInitGuard } from './language-init.guard';
import { LanguageService } from '../services/language';
import { Router, RouterStateSnapshot, ActivatedRouteSnapshot } from '@angular/router';
import { of } from 'rxjs';

class MockLanguageService {
  setLanguage = jest.fn();
  getInitialLanguage = jest.fn().mockReturnValue('es');
}

class MockRouter {
  createUrlTree = jest.fn((commands) => commands.join('/'));
}

describe('languageInitGuard', () => {
  let guard: typeof languageInitGuard;
  let languageService: MockLanguageService;
  let router: MockRouter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: Router, useClass: MockRouter }
      ]
    });

    // We can't inject a function guard directly like a service in older Angular versions easily,
    // but in newer ones we can run it in injection context.
    // However, usually we test it by calling TestBed.runInInjectionContext
    languageService = TestBed.inject(LanguageService) as unknown as MockLanguageService;
    router = TestBed.inject(Router) as unknown as MockRouter;
  });

  const runGuard = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
    return TestBed.runInInjectionContext(() => languageInitGuard(route, state));
  };

  it('should allow navigation if language is supported', () => {
    const route = { params: { lang: 'es' } } as unknown as ActivatedRouteSnapshot;
    const state = { url: '/es/home' } as RouterStateSnapshot;

    const result = runGuard(route, state);

    expect(result).toBe(true);
    expect(languageService.setLanguage).toHaveBeenCalledWith('es');
  });

  it('should redirect to default language if language is NOT supported', () => {
    const route = { params: { lang: 'fr' } } as unknown as ActivatedRouteSnapshot;
    const state = { url: '/fr/home' } as RouterStateSnapshot;

    const result = runGuard(route, state);

    expect(router.createUrlTree).toHaveBeenCalledWith(['/es/home']);
    // result would be the return value of createUrlTree, which is mocked string here
    expect(result).toBe('/es/home');
  });
});
