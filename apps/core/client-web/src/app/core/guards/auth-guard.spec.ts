import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { authGuard } from './auth-guard';
import { of } from 'rxjs';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { routerMock as routerMockFactory } from '../../../testing/service-mocks';

describe('authGuard', () => {
  let authServiceMock: any;
  let routerMock: any;
  let languageServiceMock: any;

  beforeEach(() => {
    // The guard asks `resolveSession()` and nothing else. The service memoises that answer, so
    // "does the guard avoid a round trip?" is a question about the service, tested there — here
    // we only care that the guard routes on the answer it is given.
    authServiceMock = {
      resolveSession: jest.fn(),
    };
    routerMock = routerMockFactory();
    languageServiceMock = {
      currentLang: jest.fn().mockReturnValue('en'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: LanguageService, useValue: languageServiceMock },
      ],
    });
  });

  it('lets an authenticated user through', (done) => {
    authServiceMock.resolveSession.mockReturnValue(of(true));

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      (authGuard(null as any, null as any) as any).subscribe((res: boolean) => {
        expect(res).toBe(true);
        expect(routerMock.createUrlTree).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('redirects an anonymous visitor to the localised login route', (done) => {
    authServiceMock.resolveSession.mockReturnValue(of(false));

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      (authGuard(null as any, null as any) as any).subscribe((res: UrlTree) => {
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login']);
        expect(res.toString()).toBe('/mock-url-tree');
        done();
      });
    });
  });

  it('falls back to Spanish when no language has been resolved yet', (done) => {
    authServiceMock.resolveSession.mockReturnValue(of(false));
    languageServiceMock.currentLang.mockReturnValue(undefined);

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      (authGuard(null as any, null as any) as any).subscribe(() => {
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'es', 'auth', 'login']);
        done();
      });
    });
  });
});
