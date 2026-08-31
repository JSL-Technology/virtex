import { Test } from '@nestjs/testing';
import { UnauthorizedException, InternalServerErrorException } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './services/cookie.service';
import { OptionalJwtAuthGuard } from './guards/jwt/optional-jwt.guard';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

/**
 * The session bootstrap contract.
 *
 * `GET /auth/session` exists to make one thing impossible: a client that has to guess. Its
 * predecessor, `GET /auth/status`, was guarded like a protected resource, so it answered 401 to
 * anyone who was not signed in — which is not an error, it is the normal state of a login page.
 * The client could not tell that apart from an expired access token, so it followed every 401
 * with a refresh that, for a signed-out visitor, could only fail as well.
 *
 * These tests pin the properties that keep that from coming back: the endpoint always answers,
 * it says whether refreshing is worth attempting, and it never reports a dead session as
 * refreshable.
 */
describe('GET /auth/session — bootstrap', () => {
  const principal = { id: 'user-1', email: 'a@b.c' } as AuthenticatedUser;

  const authService = { status: jest.fn(), refreshAccessToken: jest.fn() };
  const cookieService = {
    setCsrfCookie: jest.fn(),
    setAuthCookies: jest.fn(),
    clearAuthCookies: jest.fn(),
    hasSessionMarker: jest.fn().mockReturnValue(false),
  };

  let controller: AuthController;

  const request = (cookies: Record<string, string> = {}) => ({ cookies }) as never;
  const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() }) as never;

  beforeEach(async () => {
    jest.clearAllMocks();
    cookieService.hasSessionMarker.mockReturnValue(false);

    const moduleRef = await Test.createTestingModule({ controllers: [AuthController] })
      .useMocker((token) => {
        if (token === AuthService) return authService;
        if (token === CookieService) return cookieService;
        return {};
      })
      .compile();

    controller = moduleRef.get(AuthController);
  });

  describe('with no session at all — the login page', () => {
    it('answers 200 rather than 401, and does not ask the client to refresh', async () => {
      const result = await controller.getSession(null, request(), response());

      expect(result).toEqual({ authenticated: false, user: null, refreshable: false });
      // Nothing to resolve, so the source of truth is never consulted.
      expect(authService.status).not.toHaveBeenCalled();
    });

    it('hands out an anonymous CSRF token, so a browser can never be locked out of refreshing', async () => {
      // This is the self-healing property. The token used to be minted only alongside a session,
      // so a browser holding a session cookie with no readable XSRF cookie — cleared cookies, a
      // rotated CSRF_SECRET — got 403 from POST /auth/refresh for the rest of that cookie's life.
      await controller.getSession(null, request(), response());

      expect(cookieService.setCsrfCookie).toHaveBeenCalledTimes(1);
      // Anonymous binding: no principal is passed.
      expect(cookieService.setCsrfCookie.mock.calls[0][1]).toBeUndefined();
    });
  });

  describe('with an expired access token but a live refresh token', () => {
    it('says so, so the client refreshes only when it can succeed', async () => {
      cookieService.hasSessionMarker.mockReturnValue(true);

      const result = await controller.getSession(null, request({ auth_session: '1' }), response());

      expect(result).toEqual({ authenticated: false, user: null, refreshable: true });
    });
  });

  describe('with a valid access token', () => {
    it('re-reads the principal from the source of truth', async () => {
      authService.status.mockResolvedValue({ user: { ...principal, firstName: 'Ada' } });

      const result = await controller.getSession(principal, request(), response());

      expect(authService.status).toHaveBeenCalledWith(principal);
      expect(result.authenticated).toBe(true);
      expect(result.user).toMatchObject({ id: 'user-1' });
    });

    it('never reports itself refreshable — the token presented is already valid', async () => {
      authService.status.mockResolvedValue({ user: principal });
      cookieService.hasSessionMarker.mockReturnValue(true);

      const result = await controller.getSession(principal, request({ auth_session: '1' }), response());

      expect(result.refreshable).toBe(false);
    });

    it('binds the reissued CSRF token to that principal', async () => {
      authService.status.mockResolvedValue({ user: principal });

      await controller.getSession(principal, request(), response());

      expect(cookieService.setCsrfCookie.mock.calls[0][1]).toBe('user-1');
    });
  });

  describe('when the token verifies but the principal may no longer sign in', () => {
    it('reports a clean signed-out state instead of failing', async () => {
      authService.status.mockRejectedValue(new UnauthorizedException('USER_INACTIVE'));

      const result = await controller.getSession(principal, request(), response());

      expect(result).toEqual({ authenticated: false, user: null, refreshable: false });
    });

    it('clears the cookies, so the next page load does not repeat the failure', async () => {
      authService.status.mockRejectedValue(new UnauthorizedException('USER_INACTIVE'));

      await controller.getSession(principal, request(), response());

      expect(cookieService.clearAuthCookies).toHaveBeenCalled();
    });

    it('still surfaces an infrastructure failure as an error', async () => {
      // "Signed out" must mean signed out. A database outage reported as a clean sign-out would
      // silently log everybody out and look, from the client, exactly like an ordinary visit.
      authService.status.mockRejectedValue(new InternalServerErrorException('db down'));

      await expect(controller.getSession(principal, request(), response())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(cookieService.clearAuthCookies).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh keeps the marker honest', () => {
    it('clears the cookies when the browser presents no refresh token', async () => {
      // Reaching this point means a marker cookie survived its refresh token. Left alone it would
      // report `refreshable: true` on every bootstrap until it expired, and every one of those
      // page loads would end in this same failure.
      await expect(
        controller.refresh(request(), response(), '127.0.0.1', 'jest'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(cookieService.clearAuthCookies).toHaveBeenCalled();
    });

    it('clears the cookies when the refresh token is rejected', async () => {
      authService.refreshAccessToken.mockRejectedValue(new UnauthorizedException('REVOKED'));

      await expect(
        controller.refresh(request({ refresh_token: 'stale' }), response(), '127.0.0.1', 'jest'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(cookieService.clearAuthCookies).toHaveBeenCalled();
    });

    it('carries "remember me" across the rotation', async () => {
      // The lifetime was re-derived correctly one layer down and then dropped here, so a
      // thirty-day session was re-issued into a seven-day cookie on its first rotation.
      authService.refreshAccessToken.mockResolvedValue({
        user: principal,
        accessToken: 'a',
        refreshToken: 'r',
        rememberMe: true,
      });

      await controller.refresh(request({ refresh_token: 'live' }), response(), '127.0.0.1', 'jest');

      expect(cookieService.setAuthCookies).toHaveBeenCalledWith(
        expect.anything(),
        'a',
        'r',
        expect.objectContaining({ rememberMe: true, userId: 'user-1' }),
      );
    });
  });
});

describe('OptionalJwtAuthGuard', () => {
  it('reports the absence of a principal instead of rejecting the request', () => {
    const guard = new OptionalJwtAuthGuard();

    // Passport signals "no/invalid token" by calling back with `false`.
    expect(guard.handleRequest(null, false)).toBeNull();
    expect(() => guard.handleRequest(null, false)).not.toThrow();
  });

  it('passes a resolved principal straight through', () => {
    const guard = new OptionalJwtAuthGuard();
    const user = { id: 'user-1' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('does not resurrect a request whose token failed verification', () => {
    // A tampered or expired token still yields "not authenticated" — the strategy has already
    // refused it, and this guard never sees a principal it did not verify.
    const guard = new OptionalJwtAuthGuard();

    expect(guard.handleRequest(new Error('invalid signature'), false)).toBeNull();
  });
});
