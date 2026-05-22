import { TestBed } from '@angular/core/testing';
import { languageRedirectGuard } from './language-redirect.guard';
import { LanguageService } from '../services/language';
import { AuthService } from '../services/auth';
import { Router } from '@angular/router';

class MockLanguageService {
  getInitialLanguage = jest.fn().mockReturnValue('es');
}

class MockAuthService {
  isAuthenticated = jest.fn();
}

class MockRouter {
  createUrlTree = jest.fn((commands) => commands.join('/'));
}

describe('languageRedirectGuard', () => {
  let authService: MockAuthService;
  let router: MockRouter;
  let languageService: MockLanguageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: AuthService, useClass: MockAuthService },
        { provide: Router, useClass: MockRouter }
      ]
    });

    authService = TestBed.inject(AuthService) as unknown as MockAuthService;
    router = TestBed.inject(Router) as unknown as MockRouter;
    languageService = TestBed.inject(LanguageService) as unknown as MockLanguageService;
  });

  const runGuard = () => {
    return TestBed.runInInjectionContext(() => languageRedirectGuard({} as any, {} as any));
  };

  it('should redirect to /dashboard if authenticated', () => {
    authService.isAuthenticated.mockReturnValue(true);

    const result = runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/dashboard']);
    expect(result).toBe('/dashboard');
  });

  it('should redirect to /:lang/auth/login if NOT authenticated', () => {
    authService.isAuthenticated.mockReturnValue(false);
    languageService.getInitialLanguage.mockReturnValue('en');

    const result = runGuard();

    expect(router.createUrlTree).toHaveBeenCalledWith(['/en/auth/login']);
    expect(result).toBe('/en/auth/login');
  });
});
