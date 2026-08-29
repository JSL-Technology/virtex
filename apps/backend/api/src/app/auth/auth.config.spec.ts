import { parseDuration } from './auth.config';

describe('parseDuration', () => {
  it('parses every supported unit', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('12h')).toBe(43_200_000);
    expect(parseDuration('7d')).toBe(604_800_000);
    expect(parseDuration('2w')).toBe(1_209_600_000);
  });

  it('parses compound durations', () => {
    expect(parseDuration('1h30m')).toBe(5_400_000);
  });

  /**
   * The previous implementation silently returned 15 minutes for anything it could not parse and
   * only understood m|h|d. That was a hazard, not a default: JWT_ACCESS_EXPIRATION="900s"
   * produced a token expiring in 900 seconds while the cookie carrying it was given a 15-minute
   * max-age, so the two lifetimes diverged with no visible symptom. Misconfiguration must be loud.
   */
  it.each(['', '   ', 'abc', '15', '15x', '-5m', '15 minutes'])(
    'throws on the unparseable value %p instead of silently defaulting',
    (value) => {
      expect(() => parseDuration(value)).toThrow(/Invalid duration/);
    },
  );

  it('does not silently accept a value it only partially understands', () => {
    // '10m junk' must not quietly parse as 10 minutes.
    expect(() => parseDuration('10m junk')).toThrow(/Invalid duration/);
  });
});

describe('secret resolution', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  const loadConfig = async () => (await import('./auth.config')).AuthConfig;

  it('serves a development fallback only when NODE_ENV is development', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['CSRF_SECRET'];

    const config = await loadConfig();
    expect(config.CSRF_SECRET).toContain('dev-only');
  });

  /**
   * The regression this guards. Every fail-fast check used to be gated on
   * `NODE_ENV === 'production'`, so `staging` — or any unset/typo'd value — silently fell through
   * to a hardcoded secret published in the repository, making a reachable staging environment
   * token-forgeable by anyone with source access.
   */
  it.each(['staging', 'prod', 'qa', ''])(
    'fails fast rather than using a dev fallback when NODE_ENV is %p',
    async (env) => {
      process.env['NODE_ENV'] = env;
      delete process.env['CSRF_SECRET'];

      const config = await loadConfig();
      expect(() => config.CSRF_SECRET).toThrow(/required/i);
    },
  );

  it('rejects a placeholder secret outside development', async () => {
    process.env['NODE_ENV'] = 'staging';
    process.env['CSRF_SECRET'] = 'change-me-please-this-is-long-enough-to-pass';

    const config = await loadConfig();
    expect(() => config.CSRF_SECRET).toThrow(/placeholder/i);
  });

  it('rejects a secret with insufficient entropy outside development', async () => {
    process.env['NODE_ENV'] = 'staging';
    process.env['CSRF_SECRET'] = 'tooshort';

    const config = await loadConfig();
    expect(() => config.CSRF_SECRET).toThrow(/at least/i);
  });

  it('accepts a strong secret outside development', async () => {
    process.env['NODE_ENV'] = 'staging';
    const strong = 'a3f9c2e7b1d84f60a3f9c2e7b1d84f60';
    process.env['CSRF_SECRET'] = strong;

    const config = await loadConfig();
    expect(config.CSRF_SECRET).toBe(strong);
  });

  it('keeps the CSRF cookie alive longer than the access token', async () => {
    // C-1: the CSRF cookie previously expired with the access token (15m). Because
    // POST /auth/refresh is CSRF-protected and the SPA only sends the header when it can read
    // the cookie, sessions could never outlive 15 minutes and "remember me" was inert.
    process.env['NODE_ENV'] = 'development';
    const config = await loadConfig();
    expect(config.COOKIE_CSRF_MAX_AGE).toBeGreaterThan(config.COOKIE_ACCESS_MAX_AGE);
    expect(config.COOKIE_CSRF_MAX_AGE).toBeGreaterThanOrEqual(config.COOKIE_REFRESH_MAX_AGE);
  });

  it('keeps the session denylist alive at least as long as an access token', async () => {
    // C-2: a denylist entry that expired before the token it revokes would let the revoked
    // access token work again for the remainder of its life.
    process.env['NODE_ENV'] = 'development';
    const config = await loadConfig();
    expect(config.SESSION_DENYLIST_TTL).toBeGreaterThan(config.COOKIE_ACCESS_MAX_AGE);
  });
});
