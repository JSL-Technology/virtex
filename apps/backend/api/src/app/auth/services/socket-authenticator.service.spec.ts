import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SocketAuthenticator } from './socket-authenticator.service';

/**
 * The socket handshake is authenticated exactly like an HTTP request, with real RS256 keys here —
 * a token check exercised against a mocked `jwt.verify` proves nothing about the options it passes.
 */
describe('SocketAuthenticator', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const claims = { id: 'user-1', tokenVersion: 3, organizationId: 'org-1', sessionId: 'sess-1' };

  const sign = (overrides: jwt.SignOptions = {}, payload: object = claims) =>
    jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      keyid: 'k1',
      issuer: 'virteex-api',
      audience: 'virteex-web',
      expiresIn: '15m',
      ...overrides,
    });

  const cookie = (token: string, name = '__Host-access_token') => `theme=dark; ${name}=${token}`;

  let resolveFromPayload: jest.Mock;
  let authenticator: SocketAuthenticator;
  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
    resolveFromPayload = jest.fn(async (payload) => ({ ...payload, email: 'a@example.com' }));
    authenticator = new SocketAuthenticator(
      { getPublicKey: (kid?: string) => (kid === 'k1' ? publicKey : null) } as never,
      { resolveFromPayload } as never,
    );
  });

  afterAll(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  it('resolves a genuine token through the same identity service as HTTP', async () => {
    const principal = await authenticator.authenticate(cookie(sign()));

    expect(resolveFromPayload).toHaveBeenCalledWith(claims);
    expect(principal).toMatchObject({ id: 'user-1', organizationId: 'org-1', sessionId: 'sess-1' });
  });

  it('answers null when the handshake carries no access token', async () => {
    expect(await authenticator.authenticate('theme=dark')).toBeNull();
    expect(resolveFromPayload).not.toHaveBeenCalled();
  });

  it('refuses the unprefixed development cookie outside development', async () => {
    expect(await authenticator.authenticate(cookie(sign(), 'access_token'))).toBeNull();
    expect(resolveFromPayload).not.toHaveBeenCalled();
  });

  it.each([
    ['a token signed for another audience', () => sign({ audience: 'someone-else' })],
    ['a token from another issuer', () => sign({ issuer: 'evil' })],
    ['an expired token', () => sign({ expiresIn: -10 })],
    ['a token naming an unknown key', () => sign({ keyid: 'rotated-out' })],
    // Algorithm confusion: HS256 "signed" with the PUBLIC key, which any client can read.
    [
      'an HS256 token keyed with the public key',
      () => jwt.sign(claims, publicKey, { algorithm: 'HS256', keyid: 'k1', issuer: 'virteex-api', audience: 'virteex-web' }),
    ],
    ['a token that is not a JWT at all', () => 'not-a-jwt'],
  ])('answers null for %s, without consulting identity', async (_label, token) => {
    expect(await authenticator.authenticate(cookie(token()))).toBeNull();
    expect(resolveFromPayload).not.toHaveBeenCalled();
  });

  it('propagates a rejection for a genuine token whose session was revoked', async () => {
    resolveFromPayload.mockRejectedValueOnce(new Error('AUTH_SESSION_EXPIRED'));

    await expect(authenticator.authenticate(cookie(sign()))).rejects.toThrow('AUTH_SESSION_EXPIRED');
  });

  describe('revalidating a socket that is already open', () => {
    it('keeps a socket whose handshake token has since expired, while its session is alive', async () => {
      // The access token lives fifteen minutes and the socket longer; the clock is not what ends it.
      const expired = sign({ expiresIn: -60 });
      await expect(authenticator.revalidate(cookie(expired))).resolves.toBe(true);
      expect(resolveFromPayload).toHaveBeenCalledWith(claims);
    });

    it('closes a socket whose session, account or membership no longer holds', async () => {
      resolveFromPayload.mockRejectedValueOnce(new Error('AUTH_SESSION_EXPIRED'));
      await expect(authenticator.revalidate(cookie(sign()))).resolves.toBe(false);
    });

    it.each([
      ['another audience', () => sign({ audience: 'someone-else' })],
      ['an unknown key', () => sign({ keyid: 'rotated-out' })],
      [
        'an HS256 token keyed with the public key',
        () => jwt.sign(claims, publicKey, { algorithm: 'HS256', keyid: 'k1', issuer: 'virteex-api', audience: 'virteex-web' }),
      ],
    ])('still refuses a token with %s — only expiry is waived', async (_label, token) => {
      await expect(authenticator.revalidate(cookie(token()))).resolves.toBe(false);
      expect(resolveFromPayload).not.toHaveBeenCalled();
    });
  });
});
