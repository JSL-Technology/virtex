import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import { AuthService } from './auth';
import { API_URL } from '../tokens/api-url.token';
import { NotificationService } from './notification';
import { WebSocketService } from './websocket.service';
import { ModalService } from '../../shared/service/modal.service';
import { ErrorHandlerService } from './error-handler.service';
import { AuthStatus } from '../../shared/enums/auth-status.enum';

/**
 * How the client resolves "who is signed in?" — one request, and one only.
 *
 * The behaviour these tests describe replaced a bootstrap that, on the login page, issued a 401
 * and then a 400/401/403 to answer a question nobody could see the answer to, and did it three
 * times per page load: once from the app initializer and twice more from `canActivateChild`,
 * which Angular evaluates once per nested child level.
 *
 * Two properties fix that, and both are asserted here because both are easy to lose: the client
 * asks an endpoint that always answers, and it asks it once.
 */
describe('AuthService — session bootstrap', () => {
  const API = 'http://test-api/v1';
  let service: AuthService;
  let httpMock: HttpTestingController;

  const webSocket = {
    connectionReady$: new Subject(),
    connect: jest.fn(),
    emit: jest.fn(),
    listen: jest.fn().mockReturnValue(new Subject()),
    disconnect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: API_URL, useValue: API },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showError: jest.fn(), showWarning: jest.fn() } },
        { provide: WebSocketService, useValue: webSocket },
        { provide: ModalService, useValue: { open: jest.fn() } },
        { provide: ErrorHandlerService, useValue: { handleError: jest.fn() } },
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const expectSession = () => httpMock.expectOne(`${API}/auth/session`);

  describe('a visitor who has never signed in', () => {
    it('costs exactly one request, and it succeeds', () => {
      const seen: boolean[] = [];
      service.resolveSession().subscribe((v) => seen.push(v));

      expectSession().flush({ authenticated: false, user: null, refreshable: false });

      expect(seen).toEqual([false]);
      expect(service.authStatus()).toBe(AuthStatus.unauthenticated);
      // The point of the whole exercise: no refresh is attempted, so nothing 400s or 403s.
      httpMock.expectNone(`${API}/auth/refresh`);
    });
  });

  describe('a returning visitor whose access token has expired', () => {
    it('refreshes, because the server said it would work', () => {
      const seen: boolean[] = [];
      service.resolveSession().subscribe((v) => seen.push(v));

      expectSession().flush({ authenticated: false, user: null, refreshable: true });
      httpMock.expectOne(`${API}/auth/refresh`).flush({ user: { id: 'u1', email: 'a@b.c' } });

      expect(seen).toEqual([true]);
      expect(service.authStatus()).toBe(AuthStatus.authenticated);
      expect(service.currentUser()).toMatchObject({ id: 'u1' });
    });

    it('settles as signed out when that refresh is rejected after all', () => {
      const seen: boolean[] = [];
      service.resolveSession().subscribe((v) => seen.push(v));

      expectSession().flush({ authenticated: false, user: null, refreshable: true });
      httpMock
        .expectOne(`${API}/auth/refresh`)
        .flush({ message: 'revoked' }, { status: 401, statusText: 'Unauthorized' });

      expect(seen).toEqual([false]);
      expect(service.authStatus()).toBe(AuthStatus.unauthenticated);
    });
  });

  describe('a signed-in visitor', () => {
    it('is resolved by the session request alone', () => {
      service.resolveSession().subscribe();

      expectSession().flush({
        authenticated: true,
        user: { id: 'u1', email: 'a@b.c' },
        refreshable: false,
      });

      expect(service.isAuthenticated()).toBe(true);
      expect(webSocket.connect).toHaveBeenCalled();
      httpMock.expectNone(`${API}/auth/refresh`);
    });
  });

  describe('asked repeatedly', () => {
    it('resolves once, however many callers ask — the guards are why', () => {
      const seen: boolean[] = [];
      // The app initializer, then two `canActivateChild` evaluations on the same navigation.
      service.resolveSession().subscribe((v) => seen.push(v));
      service.resolveSession().subscribe((v) => seen.push(v));

      // expectOne() fails outright if the request was issued twice.
      expectSession().flush({ authenticated: false, user: null, refreshable: false });

      service.resolveSession().subscribe((v) => seen.push(v));

      expect(seen).toEqual([false, false, false]);
    });

    it('replays the answer to a caller that arrives after it settled', () => {
      service.resolveSession().subscribe();
      expectSession().flush({
        authenticated: true,
        user: { id: 'u1', email: 'a@b.c' },
        refreshable: false,
      });

      let late: boolean | undefined;
      service.resolveSession().subscribe((v) => (late = v));

      expect(late).toBe(true);
    });

    it('re-reads on demand, for the screens that change the principal', () => {
      service.resolveSession().subscribe();
      expectSession().flush({ authenticated: false, user: null, refreshable: false });

      service.reloadSession().subscribe();
      expectSession().flush({
        authenticated: true,
        user: { id: 'u1', email: 'a@b.c' },
        refreshable: false,
      });

      expect(service.isAuthenticated()).toBe(true);
    });
  });

  describe('after signing out', () => {
    it('answers signed-out with no further request', () => {
      service.resolveSession().subscribe();
      expectSession().flush({
        authenticated: true,
        user: { id: 'u1', email: 'a@b.c' },
        refreshable: false,
      });

      service.logout(false);

      let seen: boolean | undefined;
      service.resolveSession().subscribe((v) => (seen = v));

      expect(seen).toBe(false);
      expect(service.authStatus()).toBe(AuthStatus.unauthenticated);
    });
  });

  describe('when the API itself is failing', () => {
    it('routes as signed out but stays willing to try again', () => {
      // Distinct from "signed out": we did not learn the answer, we failed to ask. Pinning the
      // app to the login screen over one bad response would be the wrong trade.
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      let seen: boolean | undefined;
      service.resolveSession().subscribe((v) => (seen = v));
      expectSession().flush({}, { status: 503, statusText: 'Service Unavailable' });

      expect(seen).toBe(false);

      service.resolveSession().subscribe();
      expectSession().flush({ authenticated: false, user: null, refreshable: false });
    });
  });
});
