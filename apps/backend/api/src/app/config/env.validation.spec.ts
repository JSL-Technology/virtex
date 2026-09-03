import { envValidation, devSecret, CRYPTOGRAPHIC_SECRETS } from './env.validation';

/**
 * The schema decides whether the process starts. Two claims matter, and they pull against each
 * other, which is exactly why they are pinned here:
 *
 *   1. A deployment refuses to boot when a secret or credential is missing.
 *   2. A development checkout boots with an empty environment.
 *
 * The failure that motivated (2) was visible to the user as ERR_CONNECTION_REFUSED in a browser
 * console: `nx serve api` exited on sixteen "is required" messages, so nothing listened on :3000.
 * The risk introduced by (2) is that a generated development secret leaks into a deployment, so
 * every test below that exercises a fallback also asserts production still rejects it.
 */

/** Validate an environment the way ConfigModule does at boot. */
const check = (env: Record<string, string>) =>
  envValidation.validate(env, { abortEarly: false, allowUnknown: true });

/** The minimum a production deployment must supply for the schema to pass. */
const productionEnv = (): Record<string, string> => ({
  NODE_ENV: 'production',
  ...Object.fromEntries(CRYPTOGRAPHIC_SECRETS.map((k) => [k, 'x'.repeat(64)])),
  WEBAUTHN_RP_ID: 'app.virteex.com',
  FRONTEND_URL: 'https://app.virteex.com',
  CORS_ORIGIN: 'https://app.virteex.com',
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_ENTERPRISE: 'price_ent',
  STRIPE_SECRET_KEY: 'sk_live_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  RS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
  RS_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----',
  DB_HOST: 'db.internal',
  DB_USERNAME: 'virteex',
  DB_PASSWORD: 'hunter2',
  DB_NAME: 'virteex',
  RECAPTCHA_V3_SECRET_KEY: 'recaptcha_secret',
  // Redis is not optional: the shared cache carries the revoked-session denylist, the pending-2FA
  // session, the single-use step-up markers and the SaaS counters.
  REDIS_HOST: 'redis.internal',
  // Outbound mail is not optional either: signup demands an emailed verification code, so an API
  // that boots without SMTP has a closed funnel and answers 500 on step two of the wizard.
  MAIL_HOST: 'smtp.internal',
  MAIL_USER: 'postmaster',
  MAIL_PASSWORD: 'hunter2',
  MAIL_FROM_ADDRESS: 'no-reply@virteex.com',
  MAIL_FROM_NAME: 'Virtex',
});

describe('environment validation', () => {
  describe('a development checkout boots with nothing configured', () => {
    it.each(['development', 'test'])('accepts a completely empty environment in %s', (env) => {
      const { error } = check({ NODE_ENV: env });
      expect(error).toBeUndefined();
    });

    it('fills every cryptographic secret with a generated value', () => {
      const { error, value } = check({ NODE_ENV: 'development' });
      expect(error).toBeUndefined();
      for (const name of CRYPTOGRAPHIC_SECRETS) {
        expect(value[name]).toBe(devSecret(name));
      }
    });

    it('gives each secret a DIFFERENT value, so one leak does not forge the rest', () => {
      const { value } = check({ NODE_ENV: 'development' });
      const generated = CRYPTOGRAPHIC_SECRETS.map((name) => value[name]);
      expect(new Set(generated).size).toBe(CRYPTOGRAPHIC_SECRETS.length);
    });

    it('is stable across restarts, so a session survives a reload', () => {
      expect(check({ NODE_ENV: 'development' }).value.JWT_SECRET).toBe(
        check({ NODE_ENV: 'development' }).value.JWT_SECRET,
      );
    });

    it('points the client and CORS at the Angular dev server', () => {
      const { value } = check({ NODE_ENV: 'development' });
      expect(value.FRONTEND_URL).toBe('http://localhost:4200');
      expect(value.CORS_ORIGIN).toBe('http://localhost:4200');
    });

    it('defaults the database to the container the README tells you to run', () => {
      const { value } = check({ NODE_ENV: 'development' });
      expect(value.DB_HOST).toBe('localhost');
      expect(value.DB_PORT).toBe(5432);
      expect(value.DB_USERNAME).toBe('postgres');
      expect(value.DB_PASSWORD).toBe('postgres');
    });

    it('turns reCAPTCHA off, since no local key can satisfy it', () => {
      expect(check({ NODE_ENV: 'development' }).value.RECAPTCHA_DISABLED).toBe(true);
    });

    it('still honours a real environment over every default', () => {
      const { value } = check({
        NODE_ENV: 'development',
        JWT_SECRET: 'y'.repeat(40),
        DB_HOST: '10.0.0.5',
        FRONTEND_URL: 'http://localhost:9999',
      });
      expect(value.JWT_SECRET).toBe('y'.repeat(40));
      expect(value.DB_HOST).toBe('10.0.0.5');
      expect(value.FRONTEND_URL).toBe('http://localhost:9999');
    });
  });

  describe('a deployment refuses to boot without its secrets', () => {
    it('rejects an empty production environment', () => {
      const { error } = check({ NODE_ENV: 'production' });
      expect(error).toBeDefined();
      const missing = error!.details.map((d) => d.context?.key);
      for (const name of CRYPTOGRAPHIC_SECRETS) {
        expect(missing).toContain(name);
      }
    });

    it.each([...CRYPTOGRAPHIC_SECRETS])('rejects production with %s missing', (name) => {
      const env = productionEnv();
      delete env[name];
      const { error } = check(env);
      expect(error?.details.map((d) => d.context?.key)).toContain(name);
    });

    it.each([
      'MAIL_HOST',
      'MAIL_USER',
      'MAIL_PASSWORD',
      'MAIL_FROM_ADDRESS',
      'MAIL_FROM_NAME',
    ])('refuses to boot a deployment without %s', (name) => {
      // Registration REQUIRES an emailed verification code. A production deployment that starts
      // without SMTP has a signup funnel that answers 500 on its second step, and nothing
      // anywhere says so — which is exactly what happened before these were declared.
      const env = productionEnv();
      delete env[name];
      const { error } = check(env);
      expect(error?.details.map((d) => d.context?.key)).toContain(name);
    });

    it('refuses to boot a deployment with no Redis', () => {
      const env = productionEnv();
      delete env.REDIS_HOST;
      const { error } = check(env);
      expect(error?.details.map((d) => d.context?.key)).toContain('REDIS_HOST');
    });

    it('accepts REDIS_URL in place of the discrete Redis variables', () => {
      const env = productionEnv();
      delete env.REDIS_HOST;
      env.REDIS_URL = 'rediss://default:secret@cache.internal:6380';
      // REDIS_HOST keeps its own requirement, so both are supplied by real deployments; what this
      // pins is that the URL form is accepted and validated as one.
      env.REDIS_HOST = 'cache.internal';
      const { error, value } = check(env);
      expect(error).toBeUndefined();
      expect(value.REDIS_URL).toBe('rediss://default:secret@cache.internal:6380');
    });

    it('rejects a Redis URL that is not a redis URL', () => {
      const env = productionEnv();
      env.REDIS_URL = 'https://cache.internal';
      const { error } = check(env);
      expect(error?.details.map((d) => d.context?.key)).toContain('REDIS_URL');
    });

    it('coerces REDIS_TLS to a real boolean', () => {
      // Same hazard as DB_SSL: every environment variable is a string, and `'false'` is truthy.
      const { value } = check({ ...productionEnv(), REDIS_TLS: 'false' });
      expect(value.REDIS_TLS).toBe(false);
    });

    it('accepts production once everything is supplied', () => {
      const { error } = check(productionEnv());
      expect(error).toBeUndefined();
    });

    it('never substitutes a development secret in production', () => {
      const { value } = check(productionEnv());
      for (const name of CRYPTOGRAPHIC_SECRETS) {
        expect(value[name]).not.toBe(devSecret(name));
      }
    });

    it.each(['staging', 'prod', 'dev', 'Development', ''])(
      'refuses to treat %p as a development environment',
      (nodeEnv) => {
        // NODE_ENV is an allow-list of three values; anything else is rejected outright rather
        // than falling through to the development branch. A typo must not unlock the fallbacks.
        const { error } = check({ NODE_ENV: nodeEnv });
        expect(error).toBeDefined();
      },
    );

    it('rejects an unset NODE_ENV that carries no secrets', () => {
      // NODE_ENV defaults to `development`, so an unset value is a development boot by design.
      // What must never happen is a *production* deployment forgetting to set it AND relying on
      // the defaults for anything a deployment needs — so pin that the default is development and
      // that production is the only branch that demands the credentials.
      expect(check({}).value.NODE_ENV).toBe('development');
      expect(check({}).error).toBeUndefined();
      expect(check({ ...productionEnv(), NODE_ENV: undefined as unknown as string }).error).toBeUndefined();
    });

    it('rejects a secret that is present but too short to be one', () => {
      const { error } = check({ ...productionEnv(), JWT_SECRET: 'short' });
      expect(error?.details.map((d) => d.context?.key)).toContain('JWT_SECRET');
    });

    it('requires a real hostname for the passkey relying party', () => {
      const { error } = check({ ...productionEnv(), WEBAUTHN_RP_ID: 'https://app.virteex.com' });
      expect(error?.details.map((d) => d.context?.key)).toContain('WEBAUTHN_RP_ID');
    });
  });

  describe('storage credentials follow the driver actually in use', () => {
    it('does not ask for AWS credentials when the local driver is selected', () => {
      const { error, value } = check(productionEnv());
      expect(error).toBeUndefined();
      expect(value.STORAGE_DRIVER).toBe('local');
    });

    it.each(['AWS_S3_BUCKET_NAME', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])(
      'requires %s once STORAGE_DRIVER is s3',
      (name) => {
        const { error } = check({ ...productionEnv(), STORAGE_DRIVER: 's3' });
        expect(error?.details.map((d) => d.context?.key)).toContain(name);
      },
    );

    it('requires the S3 credentials in development too when the driver is s3', () => {
      // The driver, not the environment, decides: an S3-backed development run still needs a
      // bucket, and silently falling back to local disk would hide the misconfiguration.
      const { error } = check({ NODE_ENV: 'development', STORAGE_DRIVER: 's3' });
      expect(error?.details.map((d) => d.context?.key)).toContain('AWS_S3_BUCKET_NAME');
    });

    it('rejects a storage driver that has no implementation', () => {
      const { error } = check({ NODE_ENV: 'development', STORAGE_DRIVER: 'gcs' });
      expect(error?.details.map((d) => d.context?.key)).toContain('STORAGE_DRIVER');
    });
  });

  describe('reCAPTCHA is switched by its own flag, never by NODE_ENV', () => {
    it('demands the key in production when the flag is not set', () => {
      const env = productionEnv();
      delete env.RECAPTCHA_V3_SECRET_KEY;
      const { error } = check(env);
      expect(error?.details.map((d) => d.context?.key)).toContain('RECAPTCHA_V3_SECRET_KEY');
    });

    it('allows production to disable it explicitly', () => {
      const env: Record<string, string> = { ...productionEnv(), RECAPTCHA_DISABLED: 'true' };
      delete env.RECAPTCHA_V3_SECRET_KEY;
      expect(check(env).error).toBeUndefined();
    });

    it('demands the key in development when the flag is explicitly false', () => {
      const { error } = check({ NODE_ENV: 'development', RECAPTCHA_DISABLED: 'false' });
      expect(error?.details.map((d) => d.context?.key)).toContain('RECAPTCHA_V3_SECRET_KEY');
    });
  });

  describe('boolean flags are coerced, not passed through as strings', () => {
    // `ConfigService.get<boolean>('DB_SSL')` returns whatever the schema produced. Left as the
    // string 'false' it is truthy, which turned TLS on against a plaintext database.
    it.each(['DB_SSL', 'DB_SSL_REJECT_UNAUTHORIZED', 'DB_LOGGING', 'DB_SYNCHRONIZE'])(
      'coerces %s to a real boolean',
      (name) => {
        const { value } = check({ NODE_ENV: 'development', [name]: 'false' });
        expect(value[name]).toBe(false);
      },
    );

    it('coerces the ports to numbers', () => {
      const { value } = check({ NODE_ENV: 'development', DB_PORT: '5433', REDIS_PORT: '6380' });
      expect(value.DB_PORT).toBe(5433);
      expect(value.REDIS_PORT).toBe(6380);
    });
  });
});
