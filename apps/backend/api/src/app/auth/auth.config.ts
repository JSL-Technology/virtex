/**
 * Central auth configuration.
 *
 * SECURITY MODEL FOR SECRETS
 * --------------------------
 * The previous implementation gated every fail-fast check on `NODE_ENV === 'production'`.
 * That left a hole: any other value — `staging`, `prod`, `qa`, or simply an unset variable —
 * silently fell through to a hardcoded development secret such as
 * `'step-up-dev-only-secret-32-chars-at-least'` or `'default-csrf-secret-change-me-...'`.
 * A reachable staging environment was therefore token-forgeable by anyone who had read this
 * file (i.e. anyone with repository access).
 *
 * The rule is now inverted and allow-list based: development fallbacks are permitted ONLY when
 * NODE_ENV is explicitly `development` or `test`. Every other value — including unset — is
 * treated as a real deployment and fails fast at boot. Failing to start is the correct outcome:
 * a process that cannot authenticate securely must not accept traffic.
 */

/** Environments where hardcoded development fallbacks are acceptable. */
const DEV_LIKE_ENVIRONMENTS = new Set(['development', 'test']);

export function isDevLikeEnvironment(): boolean {
  return DEV_LIKE_ENVIRONMENTS.has((process.env['NODE_ENV'] ?? '').toLowerCase());
}

/**
 * Values that indicate a placeholder secret was shipped by mistake. Matched as whole-ish
 * tokens rather than bare substrings so that a legitimate high-entropy secret which happens
 * to contain the letters "secret" is not rejected.
 */
const INSECURE_SECRET_PATTERNS = [
  /change[_-]?me/i,
  /^default/i,
  /dev[_-]only/i,
  /insecure/i,
  /placeholder/i,
  /^(secret|password|changeit)$/i,
];

/** Minimum entropy we accept for an HMAC/JWT secret (256 bits when hex-encoded). */
const MIN_SECRET_LENGTH = 32;

/**
 * Resolve a cryptographic secret.
 *
 * @param name           Environment variable to read.
 * @param devFallback    Value used ONLY in development/test. Never reachable in a deployment.
 */
function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  const devLike = isDevLikeEnvironment();

  if (!value) {
    if (devLike) return devFallback;
    throw new Error(
      `FATAL: ${name} is required (NODE_ENV="${process.env['NODE_ENV'] ?? '<unset>'}"). ` +
        `Development fallbacks are only available when NODE_ENV is "development" or "test".`,
    );
  }

  if (!devLike) {
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `FATAL: ${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${value.length}).`,
      );
    }
    const offending = INSECURE_SECRET_PATTERNS.find((pattern) => pattern.test(value));
    if (offending) {
      throw new Error(
        `FATAL: ${name} matches a known placeholder pattern (${offending}). Set a strong random secret.`,
      );
    }
  }

  return value;
}

/**
 * Parse a duration string into milliseconds.
 *
 * Supports `s`, `m`, `h`, `d`, `w` and compound forms ("1h30m", "7d").
 *
 * The previous implementation silently returned 15 minutes for anything it could not parse
 * and only understood `m|h|d`. That produced a hazard rather than a default: setting
 * JWT_ACCESS_EXPIRATION="900s" gave a JWT that expired in 900 seconds while the cookie carrying
 * it was given a 15-minute max-age, so token and cookie lifetimes silently diverged.
 * Misconfiguration must be loud, so we now throw.
 */
export function parseDuration(duration: string): number {
  const UNIT_MS: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  const normalized = duration?.trim().toLowerCase();
  if (!normalized) {
    throw new Error(`Invalid duration: received an empty value.`);
  }

  const segments = normalized.match(/\d+\s*[smhdw]/g);
  const withoutSegments = normalized.replace(/\d+\s*[smhdw]/g, '').trim();

  if (!segments || withoutSegments.length > 0) {
    throw new Error(
      `Invalid duration "${duration}". Expected a value such as "15m", "7d", "12h" or "1h30m".`,
    );
  }

  return segments.reduce((total, segment) => {
    const value = parseInt(segment, 10);
    const unit = segment.trim().slice(-1);
    return total + value * UNIT_MS[unit];
  }, 0);
}

/** Read a duration from the environment, falling back to a known-good literal. */
function envDuration(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const AuthConfig = {
  // ---------------------------------------------------------------------------
  // Token lifetimes
  // ---------------------------------------------------------------------------
  get JWT_ACCESS_EXPIRATION() { return envDuration('JWT_ACCESS_EXPIRATION', '15m'); },
  get JWT_REFRESH_EXPIRATION() { return envDuration('JWT_REFRESH_EXPIRATION', '7d'); },
  get JWT_RESET_PASSWORD_EXPIRATION() { return envDuration('JWT_RESET_PASSWORD_EXPIRATION', '15m'); },
  get JWT_REFRESH_REMEMBER_ME_EXPIRATION() { return envDuration('JWT_REFRESH_REMEMBER_ME_EXPIRATION', '30d'); },
  get JWT_STEP_UP_EXPIRATION() { return envDuration('JWT_STEP_UP_EXPIRATION', '10m'); },
  /**
   * Lifetime of an impersonated session. Short by design: elevated access to someone else's
   * account should expire on its own rather than persist as a multi-day refresh token.
   */
  get IMPERSONATION_SESSION_DURATION() { return envDuration('AUTH_IMPERSONATION_DURATION', '30m'); },

  // ---------------------------------------------------------------------------
  // Cryptographic secrets — fail fast outside development/test (see requireSecret).
  // ---------------------------------------------------------------------------
  get JWT_2FA_TEMP_SECRET() { return requireSecret('JWT_2FA_TEMP_SECRET', 'dev-only-2fa-temp-secret-not-for-deployment'); },
  get JWT_PREVERIFY_SECRET() { return requireSecret('JWT_PREVERIFY_SECRET', 'dev-only-preverify-secret-not-for-deployment'); },
  get JWT_STEP_UP_SECRET() { return requireSecret('JWT_STEP_UP_SECRET', 'dev-only-step-up-secret-not-for-deployment'); },

  // H-07: Dedicated secret for HMAC-signed CSRF tokens. Key separation from JWT_SECRET allows
  // independent rotation without invalidating user sessions (NIST SP 800-57 §5.2).
  get CSRF_SECRET() { return requireSecret('CSRF_SECRET', 'dev-only-csrf-secret-not-for-deployment'); },

  // ---------------------------------------------------------------------------
  // Cookie lifetimes
  // ---------------------------------------------------------------------------
  get COOKIE_ACCESS_MAX_AGE() { return parseDuration(AuthConfig.JWT_ACCESS_EXPIRATION); },
  get COOKIE_REFRESH_MAX_AGE() { return parseDuration(AuthConfig.JWT_REFRESH_EXPIRATION); },
  get COOKIE_REFRESH_REMEMBER_ME_MAX_AGE() { return parseDuration(AuthConfig.JWT_REFRESH_REMEMBER_ME_EXPIRATION); },

  /**
   * C-1 FIX: The CSRF cookie must outlive the access token.
   *
   * It previously used COOKIE_ACCESS_MAX_AGE (15m). Because POST /auth/refresh is CSRF-protected
   * and the Angular interceptor only sends X-XSRF-TOKEN when it can read the cookie, the cookie
   * expiring after 15 minutes made every refresh fail with 403 — which the interceptor maps to a
   * logout. Sessions could therefore never outlive 15 minutes and "remember me" was inert.
   * The CSRF cookie now tracks the longest possible refresh lifetime.
   */
  get COOKIE_CSRF_MAX_AGE() { return AuthConfig.COOKIE_REFRESH_REMEMBER_ME_MAX_AGE; },

  // ---------------------------------------------------------------------------
  // Cache & sessions
  // ---------------------------------------------------------------------------
  get CACHE_TTL() { return parseDuration(envDuration('AUTH_CACHE_TTL', '15m')); },
  get REFRESH_GRACE_PERIOD() { return parseInt(process.env['AUTH_REFRESH_GRACE_PERIOD'] || '2000', 10); },

  /**
   * C-2 FIX: How long a revoked sessionId stays on the denylist. Must be >= the access-token
   * lifetime, since that is the longest an already-issued access token can remain signature-valid.
   * A margin is added to absorb clock skew between nodes.
   */
  get SESSION_DENYLIST_TTL() { return AuthConfig.COOKIE_ACCESS_MAX_AGE + 60_000; },

  /** Single-use marker lifetime for a step-up jti; matches the token's own expiry. */
  get STEP_UP_TOKEN_TTL() { return parseDuration(AuthConfig.JWT_STEP_UP_EXPIRATION); },

  // ---------------------------------------------------------------------------
  // Throttling & lockout
  // ---------------------------------------------------------------------------
  get THROTTLE_LIMIT() { return parseInt(process.env['AUTH_THROTTLE_LIMIT'] || '5', 10); },
  get THROTTLE_TTL() { return parseInt(process.env['AUTH_THROTTLE_TTL'] || '60000', 10); },
  get MAX_FAILED_ATTEMPTS() { return parseInt(process.env['AUTH_MAX_FAILED_ATTEMPTS'] || '5', 10); },
  get LOCKOUT_DURATION() { return parseDuration(envDuration('AUTH_LOCKOUT_DURATION', '15m')); },

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------
  // DUMMY_PASSWORD_HASH only equalises timing for unknown accounts; a public default is fine.
  get DUMMY_PASSWORD_HASH() { return process.env['AUTH_DUMMY_PASSWORD_HASH'] || '$argon2id$v=19$m=65536,t=3,p=4$nQX58JdpAHj04FlImXHVGg$KqRBXlHTOlTtTorAd6friuDAvPPmpa+0E7cDUf/5p9I'; },
  get SIMULATED_DELAY_MS() { return parseInt(process.env['AUTH_SIMULATED_DELAY_MS'] || '500', 10); },
  get MFA_CODE_EXPIRATION() { return parseInt(process.env['AUTH_MFA_CODE_EXPIRATION'] || '300000', 10); },

  /** A-6: TOTP steps accepted either side of the current one (clock skew tolerance). */
  get TOTP_WINDOW() { return parseInt(process.env['AUTH_TOTP_WINDOW'] || '1', 10); },
  /** A-6: TOTP step length in seconds. Used to size the replay-protection TTL. */
  get TOTP_STEP_SECONDS() { return parseInt(process.env['AUTH_TOTP_STEP_SECONDS'] || '30', 10); },

  /** Reject passwords found in known breach corpora via the HIBP k-anonymity API. */
  get PASSWORD_BREACH_CHECK_ENABLED() { return (process.env['AUTH_PASSWORD_BREACH_CHECK'] ?? 'true') !== 'false'; },
  get PASSWORD_BREACH_API_TIMEOUT_MS() { return parseInt(process.env['AUTH_PASSWORD_BREACH_TIMEOUT_MS'] || '2000', 10); },

  // Argon2id tuning — exposed so operators can trade CPU for latency under load.
  get ARGON2_MEMORY_COST() { return parseInt(process.env['AUTH_ARGON2_MEMORY_COST'] || '65536', 10); }, // 64 MB
  get ARGON2_TIME_COST() { return parseInt(process.env['AUTH_ARGON2_TIME_COST'] || '3', 10); },
  get ARGON2_PARALLELISM() { return parseInt(process.env['AUTH_ARGON2_PARALLELISM'] || '4', 10); },

  // Circuit breaker around Redis.
  get CACHE_RETRY_DELAY() { return parseInt(process.env['AUTH_CACHE_RETRY_DELAY'] || '30000', 10); },

  // Twilio
  get TWILIO_ACCOUNT_SID() { return process.env['TWILIO_ACCOUNT_SID']; },
  get TWILIO_AUTH_TOKEN() { return process.env['TWILIO_AUTH_TOKEN']; },
  get TWILIO_PHONE_NUMBER() { return process.env['TWILIO_PHONE_NUMBER']; },

  // Impossible travel
  get IMPOSSIBLE_TRAVEL_MAX_SPEED() { return parseInt(process.env['AUTH_IMPOSSIBLE_TRAVEL_MAX_SPEED'] || '1500', 10); }, // km/h
  get IMPOSSIBLE_TRAVEL_MIN_DISTANCE() { return parseInt(process.env['AUTH_IMPOSSIBLE_TRAVEL_MIN_DISTANCE'] || '100', 10); }, // km
};
