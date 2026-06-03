import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { OauthStateService, OauthTransaction } from './oauth-state.service';

function makeService(env: Record<string, string> = {}): OauthStateService {
  const config = {
    get: (key: string, def?: unknown) => env[key] ?? def,
  } as unknown as ConfigService;
  const service = new OauthStateService(config);
  service.onModuleInit();
  return service;
}

describe('OauthStateService', () => {
  const env = { OAUTH_STATE_SECRET: 'a'.repeat(64), AUTH_SALT: 'salt-value', NODE_ENV: 'test' };

  it('creates a transaction with distinct state, nonce and PKCE verifier', () => {
    const service = makeService(env);
    const tx = service.createTransaction('google');
    expect(tx.flow).toBe('google');
    expect(tx.state).toHaveLength(43); // 32 bytes base64url
    expect(tx.nonce).toBeTruthy();
    expect(tx.codeVerifier).toBeTruthy();
    expect(tx.state).not.toEqual(tx.nonce);
    expect(tx.iat).toBeGreaterThan(0);
  });

  it('derives a deterministic S256 PKCE challenge from the verifier', () => {
    const service = makeService(env);
    const tx = service.createTransaction('google');
    const a = service.codeChallengeS256(tx.codeVerifier);
    const b = service.codeChallengeS256(tx.codeVerifier);
    expect(a).toEqual(b);
    expect(a).not.toEqual(tx.codeVerifier);
  });

  it('round-trips a sealed transaction through the cookie', () => {
    const service = makeService(env);
    const tx = service.createTransaction('microsoft', 'org-1');

    let cookieValue = '';
    const res = {
      cookie: (_name: string, value: string) => {
        cookieValue = value;
      },
    } as any;
    service.setTransactionCookie(res, tx);
    expect(cookieValue).toBeTruthy();

    const req = { cookies: { oauth_tx: cookieValue } } as any;
    const restored = service.readTransaction(req);
    expect(restored.flow).toBe('microsoft');
    expect(restored.orgId).toBe('org-1');
    expect(restored.state).toBe(tx.state);
    expect(restored.codeVerifier).toBe(tx.codeVerifier);
  });

  it('rejects a tampered cookie (GCM auth failure)', () => {
    const service = makeService(env);
    const tx = service.createTransaction('google');
    let cookieValue = '';
    const res = { cookie: (_n: string, v: string) => (cookieValue = v) } as any;
    service.setTransactionCookie(res, tx);

    // Flip a character in the ciphertext segment.
    const parts = cookieValue.split('.');
    parts[1] = parts[1].slice(0, -1) + (parts[1].slice(-1) === 'A' ? 'B' : 'A');
    const tampered = parts.join('.');

    const req = { cookies: { oauth_tx: tampered } } as any;
    expect(() => service.readTransaction(req)).toThrow(BadRequestException);
  });

  it('rejects a transaction sealed with a different key', () => {
    const a = makeService(env);
    const b = makeService({ ...env, OAUTH_STATE_SECRET: 'b'.repeat(64) });
    const tx = a.createTransaction('google');
    let cookieValue = '';
    a.setTransactionCookie({ cookie: (_n: string, v: string) => (cookieValue = v) } as any, tx);
    const req = { cookies: { oauth_tx: cookieValue } } as any;
    expect(() => b.readTransaction(req)).toThrow(BadRequestException);
  });

  it('rejects an expired transaction', () => {
    const service = makeService(env);
    const expired: OauthTransaction = {
      ...service.createTransaction('google'),
      iat: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    };
    let cookieValue = '';
    service.setTransactionCookie({ cookie: (_n: string, v: string) => (cookieValue = v) } as any, expired);
    const req = { cookies: { oauth_tx: cookieValue } } as any;
    expect(() => service.readTransaction(req)).toThrow(/expired/i);
  });

  it('throws when no transaction cookie is present', () => {
    const service = makeService(env);
    expect(() => service.readTransaction({ cookies: {} } as any)).toThrow(BadRequestException);
  });

  describe('verifyState', () => {
    it('accepts a matching state', () => {
      const service = makeService(env);
      expect(() => service.verifyState('abc123', 'abc123')).not.toThrow();
    });

    it('rejects a mismatched state', () => {
      const service = makeService(env);
      expect(() => service.verifyState('abc123', 'xyz789')).toThrow(BadRequestException);
    });

    it('rejects a missing state', () => {
      const service = makeService(env);
      expect(() => service.verifyState('abc123', undefined)).toThrow(BadRequestException);
    });
  });
});
