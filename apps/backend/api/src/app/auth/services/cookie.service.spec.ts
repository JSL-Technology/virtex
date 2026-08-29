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
