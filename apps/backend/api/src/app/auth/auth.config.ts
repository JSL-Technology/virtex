
// Helper to convert time string to milliseconds
export function parseDuration(duration: string): number {
  const match = /^(\d+)([mhd])$/i.exec(duration);
  if (!match) return 15 * 60 * 1000; // Default 15m
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

export const AuthConfig = {
  // Token Expiration (Time strings for JwtService)
  get JWT_ACCESS_EXPIRATION() { return process.env.JWT_ACCESS_EXPIRATION || '15m'; },
  get JWT_REFRESH_EXPIRATION() { return process.env.JWT_REFRESH_EXPIRATION || '7d'; },
  get JWT_RESET_PASSWORD_EXPIRATION() { return process.env.JWT_RESET_PASSWORD_EXPIRATION || '15m'; },
  get JWT_REFRESH_REMEMBER_ME_EXPIRATION() { return process.env.JWT_REFRESH_REMEMBER_ME_EXPIRATION || '30d'; },
  get JWT_2FA_TEMP_SECRET() {
    const secret = process.env.JWT_2FA_TEMP_SECRET;
    if (!secret) {
      throw new Error('FATAL: JWT_2FA_TEMP_SECRET is required and must be set via environment variable. No default is allowed.');
    }
    return secret;
  },

  get JWT_PREVERIFY_SECRET() {
    const secret = process.env.JWT_PREVERIFY_SECRET;
    if (!secret) {
      throw new Error('FATAL: JWT_PREVERIFY_SECRET is required and must be set via environment variable. No default is allowed.');
    }
    return secret;
  },

  // Cookie Max Age (Milliseconds)
  get COOKIE_ACCESS_MAX_AGE() { return parseDuration(process.env.JWT_ACCESS_EXPIRATION || '15m'); },
  get COOKIE_REFRESH_MAX_AGE() { return parseDuration(process.env.JWT_REFRESH_EXPIRATION || '7d'); },
  get COOKIE_REFRESH_REMEMBER_ME_MAX_AGE() { return parseDuration(process.env.JWT_REFRESH_REMEMBER_ME_EXPIRATION || '30d'); },

  // Cache
  get CACHE_TTL() { return parseDuration(process.env.AUTH_CACHE_TTL || '15m'); },
  get REFRESH_GRACE_PERIOD() { return parseInt(process.env.AUTH_REFRESH_GRACE_PERIOD || '10000', 10); },

  // Throttle
  get THROTTLE_LIMIT() { return parseInt(process.env.AUTH_THROTTLE_LIMIT || '5', 10); },
  get THROTTLE_TTL() { return parseInt(process.env.AUTH_THROTTLE_TTL || '60000', 10); },

  // Lockout
  get MAX_FAILED_ATTEMPTS() { return parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS || '5', 10); },
  get LOCKOUT_DURATION() { return parseDuration(process.env.AUTH_LOCKOUT_DURATION || '15m'); }, // Default 15m

  // Security
  get DUMMY_PASSWORD_HASH() { return process.env.AUTH_DUMMY_PASSWORD_HASH || '$argon2id$v=19$m=65536,t=3,p=4$nQX58JdpAHj04FlImXHVGg$KqRBXlHTOlTtTorAd6friuDAvPPmpa+0E7cDUf/5p9I'; },
  get SIMULATED_DELAY_MS() { return parseInt(process.env.AUTH_SIMULATED_DELAY_MS || '500', 10); },
  get MFA_CODE_EXPIRATION() { return parseInt(process.env.AUTH_MFA_CODE_EXPIRATION || '300000', 10); }, // 5 mins

  // Argon2 Configuration (Performance Tuning)
  // Default values are usually fine, but exposing them allows tuning for high load to avoid Event Loop blocking
  get ARGON2_MEMORY_COST() { return parseInt(process.env.AUTH_ARGON2_MEMORY_COST || '65536', 10); }, // 64 MB
  get ARGON2_TIME_COST() { return parseInt(process.env.AUTH_ARGON2_TIME_COST || '3', 10); },
  get ARGON2_PARALLELISM() { return parseInt(process.env.AUTH_ARGON2_PARALLELISM || '4', 10); },

  // Circuit Breaker
  get CACHE_RETRY_DELAY() { return parseInt(process.env.AUTH_CACHE_RETRY_DELAY || '30000', 10); },

  // Twilio
  get TWILIO_ACCOUNT_SID() { return process.env.TWILIO_ACCOUNT_SID; },
  get TWILIO_AUTH_TOKEN() { return process.env.TWILIO_AUTH_TOKEN; },
  get TWILIO_PHONE_NUMBER() { return process.env.TWILIO_PHONE_NUMBER; },

  // Impossible Travel
  get IMPOSSIBLE_TRAVEL_MAX_SPEED() { return parseInt(process.env.AUTH_IMPOSSIBLE_TRAVEL_MAX_SPEED || '1500', 10); }, // km/h
  get IMPOSSIBLE_TRAVEL_MIN_DISTANCE() { return parseInt(process.env.AUTH_IMPOSSIBLE_TRAVEL_MIN_DISTANCE || '100', 10); }, // km

  // Role Hierarchy
  get ROLE_HIERARCHY() {
    return {
      'ADMINISTRATOR': 100,
      'ACCOUNTANT': 50,
      'SELLER': 50,
      'MEMBER': 10,
    };
  }
};
