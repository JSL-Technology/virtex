import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CookieService } from './cookie.service';

describe('CookieService — CSRF token', () => {
  let service: CookieService;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'development';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CookieService,
        { provide: ConfigService, useValue: { get: () => 'development' } },
      ],
    }).compile();

    service = module.get(CookieService);
  });

  it('issues a token that verifies', () => {
    const token = service.generateSignedCsrfToken('user-1');
    expect(service.verifyCsrfToken(token, 'user-1')).toBe(true);
  });

  /**
   * The signature is what stops an attacker who controls a sibling subdomain from injecting an
   * arbitrary XSRF-TOKEN cookie: they cannot forge the HMAC.
   */
  it('rejects a tampered signature', () => {
    const token = service.generateSignedCsrfToken('user-1');
    const [nonce, binding] = token.split('.');
    const forged = `${nonce}.${binding}.${'0'.repeat(64)}`;
    expect(service.verifyCsrfToken(forged, 'user-1')).toBe(false);
  });

  it('rejects a token whose binding was swapped', () => {
    // The binding is inside the HMAC input, so rewriting it invalidates the signature.
    const token = service.generateSignedCsrfToken('user-1');
    const [nonce, , signature] = token.split('.');
    expect(service.verifyCsrfToken(`${nonce}.user-2.${signature}`, 'user-2')).toBe(false);
  });

  /**
   * Without a binding, a signed double-submit token is universally valid: an attacker could mint
   * one from their own account and replay it against a victim's session. OWASP's recipe calls for
   * the session identifier to be part of the HMAC input for exactly this reason.
   */
  it("refuses one user's token against another user's session", () => {
    const attackerToken = service.generateSignedCsrfToken('attacker-id');
    expect(service.verifyCsrfToken(attackerToken, 'victim-id')).toBe(false);
  });

  it('accepts an anonymous token where there is no authenticated principal', () => {
    // Needed by @Public() routes such as POST /auth/refresh and verify-2fa.
    const token = service.generateSignedCsrfToken();
    expect(service.verifyCsrfToken(token)).toBe(true);
  });

  it('refuses an anonymous token on an authenticated request', () => {
    const token = service.generateSignedCsrfToken();
    expect(service.verifyCsrfToken(token, 'user-1')).toBe(false);
  });

  it.each(['', 'garbage', 'a.b', 'a.b.c.d', 'a.b.zz'])(
    'returns false rather than throwing on the malformed token %p',
    (token) => {
      expect(service.verifyCsrfToken(token, 'user-1')).toBe(false);
    },
  );

  it('never issues the same nonce twice', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => service.generateSignedCsrfToken('u')));
    expect(tokens.size).toBe(50);
  });
});

/**
 * RFC 6265bis §4.1.3.2 makes the `__Host-` prefix conditional on three attributes at once:
 * `Secure`, no `Domain`, and `Path=/`. A cookie that carries the prefix but violates any of them
 * is discarded by the browser — silently, with no error visible to either side.
 *
 * That is how the pending-2FA cookie broke every second-factor login in production while working
 * perfectly in development, where the name carries no prefix at all. These tests pin the rule so
 * the shape of a cookie is checked by CI instead of by a customer.
 */
describe('CookieService — cookie prefix invariants', () => {
  /** Capture what would actually be sent to the browser. */
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

  const build = (nodeEnv: string, apiPrefix = 'api/v1') => {
    process.env['NODE_ENV'] = nodeEnv;
    // Outside development/test the config refuses to fall back to a built-in secret — correctly,
    // since a deployment that cannot sign its own CSRF tokens must not start. Supply a real one.
    process.env['CSRF_SECRET'] = 'f'.repeat(64);
    const config = {
      get: (key: string, fallback?: string) =>
        key === 'NODE_ENV' ? nodeEnv : key === 'API_PREFIX' ? apiPrefix : fallback,
    } as never;
    return new CookieService(config);
  };

  describe.each(['production', 'staging'])('in a %s deployment', (nodeEnv) => {
    it('never issues a __Host- cookie with a path other than /', () => {
      const service = build(nodeEnv);
      const { cookies, res } = recorder();

      service.setAuthCookies(res, 'access', 'refresh', { userId: 'u1' });
      service.set2faPendingCookie(res, 'pending-1');
      service.setStepUpCookie(res, 'step-up', 60_000);
      service.setSocialRegisterTokenCookie(res, 'social');

      const violations = cookies
        .filter((c) => c.name.startsWith('__Host-'))
        .filter((c) => c.options['path'] !== '/' || c.options['domain'] !== undefined);

      expect(violations).toEqual([]);
    });

    it('marks every prefixed cookie Secure', () => {
      const service = build(nodeEnv);
      const { cookies, res } = recorder();

      service.setAuthCookies(res, 'access', 'refresh', { userId: 'u1' });
      service.set2faPendingCookie(res, 'pending-1');

      const prefixed = cookies.filter((c) => c.name.startsWith('__'));
      expect(prefixed.length).toBeGreaterThan(0);
      expect(prefixed.every((c) => c.options['secure'] === true)).toBe(true);
    });

    it('scopes the pending-2FA cookie to the verify route under __Secure-, not __Host-', () => {
      const service = build(nodeEnv);
      const { cookies, res } = recorder();

      service.set2faPendingCookie(res, 'pending-1');

      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe('__Secure-2fa_pending');
      expect(cookies[0].options['path']).toBe('/api/v1/auth/verify-2fa');
    });
  });

  it('follows API_PREFIX when it is not the default', () => {
    const service = build('production', 'v2');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', 'refresh');
    service.set2faPendingCookie(res, 'pending-1');

    const refresh = cookies.find((c) => c.name === '__Secure-refresh_token');
    const pending = cookies.find((c) => c.name === '__Secure-2fa_pending');

    expect(refresh?.options['path']).toBe('/v2/auth/refresh');
    expect(pending?.options['path']).toBe('/v2/auth/verify-2fa');
  });

  it('drops the prefix in local development, where Secure cookies cannot be set over HTTP', () => {
    const service = build('development');
    const { cookies, res } = recorder();

    service.setAuthCookies(res, 'access', 'refresh');
    service.set2faPendingCookie(res, 'pending-1');

    expect(cookies.map((c) => c.name).some((n) => n.startsWith('__'))).toBe(false);
  });

  it('reads the pending id under any name the cookie has been issued under', () => {
    const service = build('production');

    expect(service.read2faPendingId({ '__Secure-2fa_pending': 'a' })).toBe('a');
    expect(service.read2faPendingId({ '2fa_pending': 'b' })).toBe('b');
    // Issued before the prefix bug was fixed; browsers dropped it, but accept it if presented.
    expect(service.read2faPendingId({ '__Host-2fa_pending': 'c' })).toBe('c');
    expect(service.read2faPendingId({})).toBeUndefined();
    expect(service.read2faPendingId(undefined)).toBeUndefined();
  });
});
