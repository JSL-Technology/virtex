import * as Joi from 'joi';
import * as crypto from 'crypto';

/**
 * Startup validation for the process environment.
 *
 * Lives in its own file rather than inside `app.module.ts` because the rule it encodes is
 * security-critical and therefore has to be testable on its own: a deployment must refuse to
 * start when a secret is missing, and a developer must be able to start without inventing one.
 * Those two claims are pinned in `env.validation.spec.ts`.
 */

/** The two environments that are allowed to fall back to generated values. */
const DEV_LIKE = Joi.valid('development', 'test');

/** Third-party credentials: mandatory in a deployment, absent-and-degraded in development. */
const optionalInDev = () =>
  Joi.when('NODE_ENV', {
    is: DEV_LIKE,
    then: Joi.string().optional(),
    otherwise: Joi.string().required(),
  });

/** A value that is required in a deployment and has a working local default in development. */
const devDefault = (value: string, base: Joi.StringSchema = Joi.string()) =>
  Joi.when('NODE_ENV', {
    is: DEV_LIKE,
    then: base.default(value),
    otherwise: base.required(),
  });

/** Credentials that only matter when the S3 storage driver is selected. */
const requiredForS3 = () =>
  Joi.when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  });

/**
 * A cryptographic secret: mandatory in a deployment, auto-filled for local development.
 *
 * The secrets have always been required unconditionally, which is right for a deployment and made
 * the application impossible to run locally: `nx serve api` refused to start with a wall of
 * sixteen "is required" messages, and a developer who only wanted to work on the login screen had
 * to invent JWT secrets, an encryption key, Stripe price ids, a Stripe secret key, a webhook
 * secret and an S3 bucket before seeing a single request served. The visible symptom is the one a
 * browser console reports: every call to :3000 answers ERR_CONNECTION_REFUSED, because nothing is
 * listening.
 *
 * The fallback is derived from the variable's own name, so it is stable across restarts (sessions
 * survive a reload), different for every secret (one leaked value does not forge the others), and
 * public knowledge — it is in this file — so it is worthless anywhere real. It is reachable ONLY
 * when NODE_ENV is exactly `development` or `test`; every other value, including unset, `staging`
 * and `prod`, still fails fast. That is the same allow-list `auth.config.ts` enforces one layer
 * down; this applies it early enough for the process to actually reach that code.
 */
export const devSecret = (name: string): string =>
  crypto.createHash('sha256').update(`virteex-dev-only:${name}`).digest('hex');

const secret = (name: string, min = 32) =>
  Joi.when('NODE_ENV', {
    is: DEV_LIKE,
    then: Joi.string().min(min).default(devSecret(name)),
    otherwise: Joi.string().min(min).required(),
  });

/** Every secret that gets a generated development value. Exported so the spec can sweep them. */
export const CRYPTOGRAPHIC_SECRETS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_2FA_TEMP_SECRET',
  'JWT_PREVERIFY_SECRET',
  'CSRF_SECRET',
  'ENCRYPTION_SECRET',
  'AUTH_SALT',
  'JWT_SOCIAL_REGISTER_SECRET',
  'JWT_STEP_UP_SECRET',
] as const;

export const envValidation = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  // H-01 FIX: All cryptographic secrets required at startup — fail fast before any module
  // initializes. Development gets a generated, deployment-unusable value; see `secret` above.
  JWT_SECRET: secret('JWT_SECRET'),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
  JWT_2FA_TEMP_SECRET: secret('JWT_2FA_TEMP_SECRET'),
  JWT_PREVERIFY_SECRET: secret('JWT_PREVERIFY_SECRET'),
  CSRF_SECRET: secret('CSRF_SECRET'),
  ENCRYPTION_SECRET: secret('ENCRYPTION_SECRET'),
  AUTH_SALT: secret('AUTH_SALT', 16),

  // Used with `getOrThrow` at runtime but absent from this schema, so the application started
  // happily and then failed on the first social sign-up with a 500 that named no cause.
  JWT_SOCIAL_REGISTER_SECRET: secret('JWT_SOCIAL_REGISTER_SECRET'),
  JWT_STEP_UP_SECRET: secret('JWT_STEP_UP_SECRET'),

  // Passkeys are bound to the relying-party id. It defaulted to 'localhost', which does not match
  // any production origin, so every WebAuthn operation failed the origin check — silently, since
  // the browser simply refuses. Required wherever a real origin exists.
  WEBAUTHN_RP_ID: devDefault('localhost', Joi.string().hostname()),

  // Where the client lives. Every emailed link and OAuth redirect is built from it. Defaulted to
  // the Angular dev server in development so a local run needs no configuration at all.
  FRONTEND_URL: devDefault('http://localhost:4200', Joi.string().uri()),
  CORS_ORIGIN: devDefault('http://localhost:4200'),
  API_PREFIX: Joi.string().optional().default('api/v1'),

  // Stripe price ids, one per plan. Without them the plans exist but cannot be subscribed to, and
  // signup fails at the last step with "this plan is not available" — which is the correct local
  // behaviour, and a much better one than refusing to start the whole API.
  STRIPE_PRICE_STARTER: optionalInDev(),
  STRIPE_PRICE_PRO: optionalInDev(),
  STRIPE_PRICE_ENTERPRISE: optionalInDev(),

  // Outbound SMS fraud controls. Both have safe defaults; naming them here documents that they
  // exist and are meant to be tuned per market.
  SMS_ALLOWED_COUNTRY_CODES: Joi.string().optional(),
  SMS_GLOBAL_DAILY_LIMIT: Joi.number().integer().positive().optional(),

  // Electronic invoicing (e-CF, Dominican Republic / DGII).
  // AES-256-GCM key that encrypts DGII signing certificates at rest. Mandatory to ISSUE e-CF — the
  // certificate vault refuses to operate without it — but optional here so tenants that do not use
  // electronic invoicing can boot without configuring it.
  ECF_CERT_ENCRYPTION_KEY: Joi.string().min(16).optional(),
  // Which DGII environment to transmit to, and optional per-service endpoint overrides (the DGII
  // versions its paths; overrides let an operator pin the exact ones its environment publishes).
  DGII_ECF_ENVIRONMENT: Joi.string().valid('TesteCF', 'CerteCF', 'Produccion').optional(),
  DGII_ECF_BASE_URL: Joi.string().uri().optional(),
  DGII_ECF_SEED_URL: Joi.string().uri().optional(),
  DGII_ECF_VALIDATE_SEED_URL: Joi.string().uri().optional(),
  DGII_ECF_RECEPTION_URL: Joi.string().uri().optional(),
  DGII_ECF_STATUS_URL: Joi.string().uri().optional(),
  DGII_ECF_TRACKIDS_URL: Joi.string().uri().optional(),
  DGII_ECF_APPROVAL_URL: Joi.string().uri().optional(),
  DGII_ECF_HTTP_TIMEOUT_MS: Joi.number().integer().positive().optional(),

  // RS256 keys: required in production, optional in development (ephemeral key is generated).
  RS_PRIVATE_KEY: Joi.when('NODE_ENV', { is: 'production', then: Joi.string().required(), otherwise: Joi.string().optional() }),
  RS_PUBLIC_KEY: Joi.when('NODE_ENV', { is: 'production', then: Joi.string().required(), otherwise: Joi.string().optional() }),
  RS_KEY_ID: Joi.string().optional().default('key-1'),

  // Database. The development defaults match the `docker run postgres:16` command in the README
  // exactly, so a checkout plus that one container is a working environment with no .env at all.
  DB_HOST: devDefault('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: devDefault('postgres'),
  DB_PASSWORD: devDefault('postgres', Joi.string().allow('')),
  DB_NAME: devDefault('erp'),
  DB_SYNCHRONIZE: Joi.boolean().default(false),

  // Declared so Joi COERCES them to real booleans.
  //
  // `ConfigService.get<boolean>(key, false)` returns whatever is in the environment, and every
  // environment variable is a string: `'false'` is truthy. `DB_SSL=false` therefore turned TLS ON
  // and the application failed to connect with `DEPTH_ZERO_SELF_SIGNED_CERT` against a database
  // that speaks plaintext — the opposite of what the setting says. The type parameter on `get` is
  // an assertion, not a conversion; only the validation schema converts. Every boolean flag the
  // application reads is declared here for that reason.
  DB_SSL: Joi.boolean().default(false),
  DB_SSL_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  DB_SSL_CA: Joi.string().optional(),
  DB_LOGGING: Joi.boolean().default(false),

  /**
   * Redis. Not optional: the shared cache carries the revoked-session denylist, the pending-2FA
   * session, the single-use step-up markers, the re-authentication attempt budget, the cached
   * principal and the SaaS usage counters. Every one of those degrades into a per-process
   * approximation without it, silently.
   *
   * `REDIS_URL` is what every managed provider hands out and takes precedence when set; the
   * discrete variables remain for local development. Credentials and TLS are declared here
   * because nothing read them before — `CacheModule`, `QueuesModule` and the throttler each built
   * a host-and-port connection, so no managed Redis (which all require AUTH, most require TLS)
   * could be used at all.
   */
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).optional(),
  REDIS_HOST: devDefault('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_USERNAME: Joi.string().optional(),
  REDIS_PASSWORD: Joi.string().optional(),
  // Declared so Joi coerces it; see the DB_SSL note above for why a bare string flag is a hazard.
  REDIS_TLS: Joi.boolean().default(false),
  REDIS_NAMESPACE: Joi.string().default('virteex'),

  /**
   * Outbound mail. Required in a deployment, and this is not a nicety.
   *
   * Signup demands an emailed verification code before it will accept a registration, so an API
   * that starts without SMTP has a closed funnel and answers 500 on the second step of the
   * wizard. None of these variables were declared here at all, so a production deployment booted
   * cleanly into exactly that state with nothing to indicate it — while the README claimed
   * "los correos transaccionales fallan al enviarse y se registra el error; el flujo no se rompe".
   */
  MAIL_HOST: optionalInDev(),
  MAIL_PORT: Joi.number().port().default(587),
  MAIL_USER: optionalInDev(),
  MAIL_PASSWORD: optionalInDev(),
  MAIL_FROM_ADDRESS: Joi.when('NODE_ENV', {
    is: DEV_LIKE,
    then: Joi.string().email().default('no-reply@virteex.local'),
    otherwise: Joi.string().email().required(),
  }),
  MAIL_FROM_NAME: devDefault('Virteex'),
  /** Implicit TLS (port 465). Port 587 upgrades with STARTTLS and must leave this false. */
  MAIL_SECURE: Joi.boolean().default(false),

  // H-04 FIX: reCAPTCHA controlled by explicit flag, not NODE_ENV.
  // (crypto secrets are already validated above — do not redeclare them here)
  //
  // Off by default in development, on everywhere else: a bot check that cannot be satisfied
  // locally is the difference between a registration form a developer can exercise and one that
  // rejects every submission. It is never inferred from NODE_ENV at the point of use — the flag
  // is the single switch, and in a deployment leaving it unset demands the real key.
  RECAPTCHA_DISABLED: Joi.when('NODE_ENV', {
    is: DEV_LIKE,
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),
  RECAPTCHA_V3_SECRET_KEY: Joi.when('RECAPTCHA_DISABLED', {
    is: true,
    then: Joi.string().optional(),
    otherwise: Joi.string().required(),
  }),

  // Web push. Optional as a group: all three or none. The service used to call
  // `webpush.setVapidDetails` unconditionally, which throws on a missing key — from a constructor,
  // so a missing VAPID key stopped the whole application from booting. `VAPID_SUBJECT` must be a
  // real contact address (`mailto:` or an https URL): push services use it to reach the operator,
  // and it was hardcoded to `mailto:youremail@example.com`.
  VAPID_PUBLIC_KEY: Joi.string().optional(),
  VAPID_PRIVATE_KEY: Joi.string().optional(),
  VAPID_SUBJECT: Joi.string()
    .pattern(/^(mailto:.+@.+\..+|https:\/\/.+)$/)
    .optional(),

  /**
   * Object storage. Required only when the S3 driver is actually selected.
   *
   * `StorageModule` picks `LocalStorageStrategy` unless `STORAGE_DRIVER === 's3'`, so demanding
   * these four credentials unconditionally demanded them for a driver that is not in use. It was
   * the single largest reason a developer could not start the API.
   */
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  AWS_S3_BUCKET_NAME: requiredForS3(),
  AWS_REGION: requiredForS3(),
  AWS_ACCESS_KEY_ID: requiredForS3(),
  AWS_SECRET_ACCESS_KEY: requiredForS3(),

  // Billing. `stripeProvider` returns null without a key and `ensureStripe()` answers 503, so a
  // local run works with billing disabled instead of not running at all.
  STRIPE_SECRET_KEY: optionalInDev(),
  STRIPE_WEBHOOK_SECRET: optionalInDev(),
});
