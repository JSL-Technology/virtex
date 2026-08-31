import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { AuthStatus } from '../app/shared/enums/auth-status.enum';
import type { User } from '../app/shared/interfaces/user.interface';

/**
 * Shared doubles for the two services almost every component reaches for.
 *
 * Each spec used to hand-roll its own, and each one drifted from the real service at a different
 * rate: `{}` for `AuthService`, a `Router` with only `navigate`, an `AuthService` with
 * `isAuthenticated` as a jest.fn where the real one is a computed signal. The suites did not fail
 * on an assertion — they failed on `authService.authStatus is not a function` and
 * `Cannot read properties of undefined (reading 'root')`, meaning they had been reporting nothing
 * about the code they named for as long as those APIs had been out of step.
 *
 * A double defined once, next to the real contract, is the only version of this that stays true.
 */

export interface AuthServiceMockOptions {
  user?: Partial<User> | null;
  authenticated?: boolean;
  permissions?: string[];
}

/**
 * Matches the shape components actually consume from `AuthService`: signals for state, plain
 * methods for actions, observables for the legacy call sites.
 */
export function authServiceMock(options: AuthServiceMockOptions = {}) {
  const { user = null, authenticated = user !== null, permissions = [] } = options;
  const status = authenticated ? AuthStatus.authenticated : AuthStatus.unauthenticated;

  return {
    currentUser: signal(user as User | null),
    authStatus: signal(status),
    isAuthenticated: signal(authenticated),
    isAuthenticated$: of(authenticated),
    user$: of(user as User | null),

    hasPermissions: (required: string[]) =>
      permissions.includes('*') || required.every((p) => permissions.includes(p)),
    getPermissions$: (): Observable<string[]> => of(permissions),

    resolveSession: jest.fn(() => of(authenticated)),
    reloadSession: jest.fn(() => of(authenticated)),
    refreshAccessToken: jest.fn(() => of({ user })),
    login: jest.fn(() => of(user)),
    logout: jest.fn(),
    verify2fa: jest.fn(() => of(user)),
    impersonate: jest.fn(() => of(user)),
    stopImpersonation: jest.fn(() => of(user)),
    registerPasskey: jest.fn(() => Promise.resolve(true)),
    loginWithPasskey: jest.fn(() => Promise.resolve(user)),
  };
}

export interface RouterMock {
  events: Observable<unknown>;
  emitNavigationEnd: (url: string) => void;
  navigate: jest.Mock;
  navigateByUrl: jest.Mock;
  createUrlTree: jest.Mock;
  serializeUrl: jest.Mock;
  parseUrl: jest.Mock;
  url: string;
  routerState: { root: unknown; snapshot: { root: unknown } };
}

/**
 * Router double that is complete enough for template rendering.
 *
 * `routerState` is the part everyone forgot. Angular resolves `ActivatedRoute` through a factory
 * that reads `router.routerState.root`, and every `routerLink` in a template injects it — so a
 * mock without it fails at component construction, before the test reaches anything it meant to
 * check.
 */
export function routerMock(url = '/'): RouterMock {
  const events = new Subject<unknown>();
  const root = { snapshot: { params: {}, queryParams: {}, data: {} }, children: [] };

  return {
    events: events.asObservable(),
    emitNavigationEnd: (nextUrl: string) => events.next(new NavigationEnd(1, nextUrl, nextUrl)),
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
    createUrlTree: jest.fn().mockReturnValue({ toString: () => '/mock-url-tree' }),
    serializeUrl: jest.fn().mockReturnValue('/mock-url-tree'),
    parseUrl: jest.fn().mockReturnValue({ root: { children: {} } }),
    url,
    routerState: { root, snapshot: { root } },
  };
}

/** Convenience provider pair, so a spec reads `provideRouterMock()` instead of two lines. */
export function provideRouterMock(url = '/') {
  const mock = routerMock(url);
  return { mock, provider: { provide: Router, useValue: mock } };
}
