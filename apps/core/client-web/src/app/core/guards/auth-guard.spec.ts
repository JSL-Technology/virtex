import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { authGuard } from './auth-guard';
import { of } from 'rxjs';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { routerMock as routerMockFactory } from '../../../testing/service-mocks';
import { ReturnUrlService } from '../auth/return-url';

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
      consumeSignOutReason: jest.fn().mockReturnValue(null),
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

  it('explains a session the client ended while loading because it had been idle', (done) => {
    authServiceMock.resolveSession.mockReturnValue(of(false));
    authServiceMock.consumeSignOutReason.mockReturnValue('idle');

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      (authGuard(null as any, null as any) as any).subscribe(() => {
        expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login'], {
          queryParams: { reason: 'idle' },
        });
        done();
      });
    });
  });

  describe('the link someone opened survives the sign-in', () => {
    const at = (url: string) => ({ url }) as any;

    beforeEach(() => sessionStorage.clear());

    it('names the page that was asked for on the sign-in page, and remembers it', (done) => {
      authServiceMock.resolveSession.mockReturnValue(of(false));

      runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
        (authGuard(null as any, at('/e/acme/invoices/88?tab=lines')) as any).subscribe(() => {
          expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login'], {
            queryParams: { returnUrl: '/e/acme/invoices/88?tab=lines' },
          });
          expect(TestBed.inject(ReturnUrlService).peek()).toBe('/e/acme/invoices/88?tab=lines');
          done();
        });
      });
    });

    it('does not bother remembering the home page, where a sign-in lands anyway', (done) => {
      authServiceMock.resolveSession.mockReturnValue(of(false));

      runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
        (authGuard(null as any, at('/overview')) as any).subscribe(() => {
          expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/', 'en', 'auth', 'login']);
          done();
        });
      });
    });

    it('back from Google or SSO on the home page, goes on to the page that was asked for', (done) => {
      TestBed.inject(ReturnUrlService).remember('/e/acme/invoices/88');
      authServiceMock.resolveSession.mockReturnValue(of(true));
      const tree = { tree: true };
      routerMock.parseUrl.mockReturnValue(tree);

      runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
        (authGuard(null as any, at('/overview')) as any).subscribe((res: unknown) => {
          expect(routerMock.parseUrl).toHaveBeenCalledWith('/e/acme/invoices/88');
          expect(res).toBe(tree);
          // Used once: the next visit to the home page stays on the home page.
          expect(TestBed.inject(ReturnUrlService).peek()).toBeNull();
          done();
        });
      });
    });

    it('a deliberate navigation elsewhere drops a destination left over from an abandoned sign-in', (done) => {
      TestBed.inject(ReturnUrlService).remember('/e/acme/invoices/88');
      authServiceMock.resolveSession.mockReturnValue(of(true));

      runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
        (authGuard(null as any, at('/e/acme/customers')) as any).subscribe((res: unknown) => {
          expect(res).toBe(true);
          expect(TestBed.inject(ReturnUrlService).peek()).toBeNull();
          done();
        });
      });
    });
  });
});
