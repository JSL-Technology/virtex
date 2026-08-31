import { CookieService } from './cookie.service';
import { AuthConfig } from '../auth.config';

/**
 * The session marker is the cookie that lets `GET /auth/session` answer honestly.
 *
 * Its correctness rests on two properties, and both are easy to break by accident:
 *
 *   1. It expires with the refresh token, including when "remember me" extends that. A marker
 *      that outlives its refresh token tells the client to attempt a renewal that cannot succeed
 *      — the exact 400/401 noise this whole design exists to remove — and one that dies early
 *      forces a re-login while the session is still perfectly good.
 *   2. It carries no authority: nothing but a constant, `httpOnly`, and cleared with everything
 *      else on sign-out.
 */
describe('CookieService — session marker', () => {
  const recorder = () => {
    const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie: (name: string, value: string, options: Record<string, unknown> = {}) =>
        cookies.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown> = {}) =>
        cookies.push({ name, value: '', options }),
    };
    return { cookies, res: res as never };
  };

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv['NODE_ENV'];
    process.env['CSRF_SECRET'] = originalEnv['CSRF_SECRET'];
  });

  const build = (nodeEnv: string) => {
    process.env['NODE_ENV'] = nodeEnv;
    process.env['CSRF_SECRET'] = 'f'.repeat(64);
    const config = {
      get: (key: string, fallback?: string) => (key === 'NODE_ENV' ? nodeEnv : fallback),
    } as never;
    return new CookieService(config);
  };

  const seconds = (ms: number) => Math.floor(ms / 1000);

  it('expires exactly with the refresh cookie', () => {
    const service = build('production');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', 'refresh', { userId: 'u1' });

    const refresh = cookies.find((c) => c.name === '__Secure-refresh_token');
    const marker = cookies.find((c) => c.name === '__Host-auth_session');

    expect(marker).toBeDefined();
    expect(marker?.options['maxAge']).toBe(refresh?.options['maxAge']);
    expect(marker?.options['maxAge']).toBe(seconds(AuthConfig.COOKIE_REFRESH_MAX_AGE));
  });

  it('follows the refresh cookie into a "remember me" lifetime', () => {
    const service = build('production');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', 'refresh', { userId: 'u1', rememberMe: true });

    const refresh = cookies.find((c) => c.name === '__Secure-refresh_token');
    const marker = cookies.find((c) => c.name === '__Host-auth_session');

    expect(marker?.options['maxAge']).toBe(refresh?.options['maxAge']);
    expect(marker?.options['maxAge']).toBe(
      seconds(AuthConfig.COOKIE_REFRESH_REMEMBER_ME_MAX_AGE),
    );
  });

  it('is not issued when no refresh token is', () => {
    const service = build('production');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', null, { userId: 'u1' });

    expect(cookies.find((c) => c.name === '__Host-auth_session')).toBeUndefined();
  });

  it('grants nothing: a constant value, httpOnly, at Path=/', () => {
    const service = build('production');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', 'refresh', { userId: 'u1' });
    const marker = cookies.find((c) => c.name === '__Host-auth_session');

    expect(marker?.value).toBe('1');
    expect(marker?.options['httpOnly']).toBe(true);
    expect(marker?.options['secure']).toBe(true);
    expect(marker?.options['path']).toBe('/');
    expect(marker?.options['domain']).toBeUndefined();
  });

  it('drops the prefix in local development, where Secure cookies cannot be set over HTTP', () => {
    const service = build('development');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', 'refresh', { userId: 'u1' });

    expect(cookies.find((c) => c.name === 'auth_session')).toBeDefined();
    expect(cookies.find((c) => c.name === '__Host-auth_session')).toBeUndefined();
  });

  it('is read under either name, so an environment switch cannot strand a browser', () => {
    const service = build('production');

    expect(service.hasSessionMarker({ '__Host-auth_session': '1' })).toBe(true);
    expect(service.hasSessionMarker({ auth_session: '1' })).toBe(true);
    expect(service.hasSessionMarker({})).toBe(false);
    expect(service.hasSessionMarker(undefined)).toBe(false);
  });

  it('is cleared by sign-out, under both names', () => {
    const service = build('production');
    const { cookies, res } = recorder();

    service.clearAuthCookies(res);

    const cleared = cookies.filter((c) => c.name.endsWith('auth_session')).map((c) => c.name);
    expect(cleared).toEqual(
      expect.arrayContaining(['__Host-auth_session', 'auth_session']),
    );
  });
});
