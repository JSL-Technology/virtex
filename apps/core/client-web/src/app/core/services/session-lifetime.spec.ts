import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import { AuthService, ORDINARY_SESSION_POLICY } from './auth';
import { API_URL } from '../tokens/api-url.token';
import { NotificationService } from './notification';
import { WebSocketService } from './websocket.service';
import { ErrorHandlerService } from './error-handler.service';
import { ActivityTrackerService, LAST_ACTIVITY_STORAGE_KEY } from './activity-tracker.service';

/**
 * "Remember me" and inactivity, as the web client sees them.
 *
 * The complaint: the application signed a person out for inactivity, and reloading the page put
 * them back on the dashboard. These tests pin each half of the fix on the client:
 *
 *  - signing out ends the session on the server through the refresh cookie, which works when the
 *    access token has expired (it always had, fifteen idle minutes in);
 *  - a reload does not restore an ordinary session that was already idle past its window, and
 *    the sign-in page is told why;
 *  - a remembered session is not subject to any of it.
 */
describe('AuthService — session lifetime', () => {
  const API = 'http://test-api/v1';
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: { navigate: jest.Mock };

  const webSocket = {
    connectionReady$: new Subject(),
    connect: jest.fn(),
    emit: jest.fn(),
    listen: jest.fn().mockReturnValue(new Subject()),
    disconnect: jest.fn(),
  };

  const minutes = (n: number) => n * 60_000;
  const lastActivity = (agoMs: number) =>
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now() - agoMs));

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    router = { navigate: jest.fn() };
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: API_URL, useValue: API },
        { provide: Router, useValue: router },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showError: jest.fn(), showWarning: jest.fn() } },
        { provide: WebSocketService, useValue: webSocket },
        { provide: ErrorHandlerService, useValue: { handleError: jest.fn() } },
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const user = { id: 'u1', email: 'a@b.c' };
  const ordinary = { persistent: false, inactivityTimeoutMs: minutes(15) };
  const remembered = { persistent: true, inactivityTimeoutMs: null };

  describe('reloading after a period without activity', () => {
    it('does not restore an ordinary session idle past its window, and ends it on the server', () => {
      lastActivity(minutes(20));
      const seen: boolean[] = [];
      service.resolveSession().subscribe((v) => seen.push(v));

      httpMock.expectOne(`${API}/auth/session`).flush({ authenticated: false, user: null, refreshable: true });
      httpMock.expectOne(`${API}/auth/refresh`).flush({ user, session: ordinary });
      // Revoked through the refresh cookie — the access token plays no part.
      httpMock.expectOne(`${API}/auth/refresh/revoke`).flush({});

      expect(seen).toEqual([false]);
      expect(service.isAuthenticated()).toBe(false);
      expect(service.consumeSignOutReason()).toBe('idle');
      // Read once: a later, deliberate sign-out must not repeat the explanation.
      expect(service.consumeSignOutReason()).toBeNull();
    });

    it('restores an ordinary session that is still within its window', () => {
      lastActivity(minutes(5));
      const seen: boolean[] = [];
      service.resolveSession().subscribe((v) => seen.push(v));

      httpMock.expectOne(`${API}/auth/session`).flush({ authenticated: true, user, refreshable: false, session: ordinary });

      expect(seen).toEqual([true]);
      expect(service.sessionPolicy()).toEqual(ordinary);
    });

    it('restores a remembered session however long it sat', () => {
      lastActivity(minutes(60 * 24 * 3));
      const seen: boolean[] = [];
      service.resolveSession().subscribe((v) => seen.push(v));

      httpMock.expectOne(`${API}/auth/session`).flush({ authenticated: true, user, refreshable: false, session: remembered });

      expect(seen).toEqual([true]);
      expect(service.sessionPolicy()).toEqual(remembered);
    });

    it('a restore is not activity: it does not reset the clock it is checked against', () => {
      lastActivity(minutes(5));
      const before = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
      service.resolveSession().subscribe();
      httpMock.expectOne(`${API}/auth/session`).flush({ authenticated: true, user, refreshable: false, session: ordinary });

      expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBe(before);
    });
  });

  describe('signing in', () => {
    it('adopts the policy the server states, and counts as activity', () => {
      lastActivity(minutes(60));
      service.login({ email: 'a@b.c', password: 'x', rememberMe: true } as never).subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ user, session: remembered });

      expect(service.sessionPolicy()).toEqual(remembered);
      const idle = TestBed.inject(ActivityTrackerService).idleForMs();
      expect(idle).not.toBeNull();
      expect(idle as number).toBeLessThan(1_000);
    });

    it('treats a sign-in route that states no policy as an ordinary session', () => {
      service.login({ email: 'a@b.c', password: 'x' } as never).subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ user });

      expect(service.sessionPolicy()).toEqual(ORDINARY_SESSION_POLICY);
    });
  });

  describe('signing out', () => {
    it('ends the session through the refresh cookie and says why on the sign-in page', () => {
      service.login({ email: 'a@b.c', password: 'x' } as never).subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ user, session: ordinary });

      service.logout(true, 'idle');

      httpMock.expectOne(`${API}/auth/refresh/revoke`).flush({});
      expect(router.navigate).toHaveBeenCalledWith([expect.stringMatching(/\/auth\/login$/)], {
        queryParams: { reason: 'idle' },
      });
      expect(service.sessionPolicy()).toBeNull();
      expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBeNull();
    });
  });
});
