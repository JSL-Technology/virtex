import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { authGuard } from './auth-guard';
import { of } from 'rxjs';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';

describe('authGuard', () => {
  let authServiceMock: any;
  let routerMock: any;
  let languageServiceMock: any;

  beforeEach(() => {
    authServiceMock = {
      checkAuthStatus: jest.fn()
    };
    routerMock = {
      createUrlTree: jest.fn().mockReturnValue({ toString: () => 'mockUrlTree' })
    };
    languageServiceMock = {
      currentLang: jest.fn().mockReturnValue('en')
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: LanguageService, useValue: languageServiceMock }
      ]
    });
  });

  it('should return true if authenticated', (done) => {
    authServiceMock.checkAuthStatus.mockReturnValue(of(true));

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      const result = authGuard(null as any, null as any) as any;
      result.subscribe((res: boolean) => {
        expect(res).toBe(true);
        done();
      });
    });
  });

  it('should redirect to login if not authenticated', (done) => {
    authServiceMock.checkAuthStatus.mockReturnValue(of(false));

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      const result = authGuard(null as any, null as any) as any;
      result.subscribe((res: UrlTree) => {
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login']);
        expect(res.toString()).toBe('mockUrlTree');
        done();
      });
    });
  });

  it('should use default language es if currentLang is undefined', (done) => {
    authServiceMock.checkAuthStatus.mockReturnValue(of(false));
    languageServiceMock.currentLang.mockReturnValue(undefined);

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      const result = authGuard(null as any, null as any) as any;
      result.subscribe((res: UrlTree) => {
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'es', 'auth', 'login']);
        done();
      });
    });
  });
});
