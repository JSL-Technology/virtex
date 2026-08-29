import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { authGuard } from './auth-guard';
import { of } from 'rxjs';
import { EnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { AuthStatus } from '../../shared/enums/auth-status.enum';
import { routerMock as routerMockFactory } from '../../../testing/service-mocks';

describe('authGuard', () => {
  let authServiceMock: any;
  let routerMock: any;
  let languageServiceMock: any;

  beforeEach(() => {
    // The guard reads `authStatus()` — a signal — and only calls `checkAuthStatus()` while the
    // status is still pending. The old double exposed `isAuthenticated` as a jest.fn and no
    // `authStatus` at all, so every case threw before asserting anything.
    authServiceMock = {
      authStatus: signal(AuthStatus.pending),
      checkAuthStatus: jest.fn(),
    };
    routerMock = routerMockFactory();
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

  it('lets an authenticated user through without re-checking with the server', (done) => {
    authServiceMock.authStatus.set(AuthStatus.authenticated);

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      const result = authGuard(null as any, null as any) as any;
      result.subscribe((res: boolean) => {
        expect(res).toBe(true);
        expect(authServiceMock.checkAuthStatus).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('redirects immediately when the status is already known to be unauthenticated', (done) => {
    authServiceMock.authStatus.set(AuthStatus.unauthenticated);

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      const result = authGuard(null as any, null as any) as any;
      result.subscribe((res: UrlTree) => {
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login']);
        // No round trip: the answer is already known.
        expect(authServiceMock.checkAuthStatus).not.toHaveBeenCalled();
        expect(res.toString()).toBe('/mock-url-tree');
        done();
      });
    });
  });

  it('resolves a pending status with the server before deciding', (done) => {
    authServiceMock.authStatus.set(AuthStatus.pending);
    authServiceMock.checkAuthStatus.mockReturnValue(of(false));

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      const result = authGuard(null as any, null as any) as any;
      result.subscribe((res: UrlTree) => {
        expect(authServiceMock.checkAuthStatus).toHaveBeenCalled();
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login']);
        expect(res.toString()).toBe('/mock-url-tree');
        done();
      });
    });
  });

  it('falls back to Spanish when no language has been resolved yet', (done) => {
    authServiceMock.authStatus.set(AuthStatus.pending);
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
