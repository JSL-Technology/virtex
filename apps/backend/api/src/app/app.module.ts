

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import { SubscriptionActiveGuard } from './saas/guards/subscription-active.guard';
import { JwtAuthGuard } from './auth/guards/jwt/jwt.guard';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { GoogleRecaptchaModule } from '@nestlab/google-recaptcha';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';


import { CacheModule } from './cache/cache.module';


import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

import { JournalEntriesModule } from './journal-entries/journal-entries.module';
import { AccountingModule } from './accounting/accounting.module';
import { ConsolidationModule } from './consolidation/consolidation.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { SharedModule } from './shared/shared.module';
import { ChartOfAccountsModule } from './chart-of-accounts/chart-of-accounts.module';
import { RolesModule } from './roles/roles.module';
import { InvoicesModule } from './invoices/invoices.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PriceListsModule } from './price-lists/price-lists.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { TaxesModule } from './taxes/taxes.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { AccountsPayableModule } from './accounts-payable/accounts-payable.module';
import { FixedAssetsModule } from './fixed-assets/fixed-assets.module';
import { BudgetsModule } from './budgets/budgets.module';
import { DimensionsModule } from './dimensions/dimensions.module';
import { MailModule } from './mail/mail.module';
import { WebsocketsModule } from './websockets/websockets.module';
import { AuditModule } from './audit/audit.module';
import { ComplianceModule } from './compliance/compliance.module';
import { QueuesModule } from './queues/queues.module';
import { HealthModule } from './health/health.module';
import { SearchModule } from './search/search.module';
import { MyWorkModule } from './my-work/my-work.module';
import { LocalizationModule } from './localization/localization.module';
import { UnitsOfMeasureModule } from './units-of-measure/units-of-measure.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushNotificationsModule } from './push-notifications/push-notifications.module';
import { BiModule } from './bi/bi.module';
import { PaymentModule } from './payment/payment.module';
import { GeoModule } from './geo/geo.module';
import { CommonModule } from './common/common.module';
import { SaasModule } from './saas/saas.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { SupplyChainModule } from './supply-chain/supply-chain.module';
import { ProjectsModule } from './projects/projects.module';
import { HcmModule } from './hcm/hcm.module';
import { ProcurementModule } from './procurement/procurement.module';
import { DatasheetsModule } from './datasheets/datasheets.module';

const requiredSecret = Joi.string().min(32).required();

const envValidation = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  // H-01 FIX: All cryptographic secrets required at startup — fail fast before any module initializes.
  JWT_SECRET: requiredSecret,
  JWT_REFRESH_SECRET: requiredSecret,
  JWT_2FA_TEMP_SECRET: requiredSecret,
  JWT_PREVERIFY_SECRET: requiredSecret,
  CSRF_SECRET: requiredSecret,
  ENCRYPTION_SECRET: requiredSecret,
  AUTH_SALT: Joi.string().min(16).required(),

  // Used with `getOrThrow` at runtime but absent from this schema, so the application started
  // happily and then failed on the first social sign-up with a 500 that named no cause.
  JWT_SOCIAL_REGISTER_SECRET: requiredSecret,
  JWT_STEP_UP_SECRET: requiredSecret,

  // Passkeys are bound to the relying-party id. It defaulted to 'localhost', which does not match
  // any production origin, so every WebAuthn operation failed the origin check — silently, since
  // the browser simply refuses. Required wherever a real origin exists.
  WEBAUTHN_RP_ID: Joi.when('NODE_ENV', {
    is: Joi.valid('development', 'test'),
    then: Joi.string().optional().default('localhost'),
    otherwise: Joi.string().hostname().required(),
  }),

  // Where the client lives. Every emailed link and OAuth redirect is built from it.
  FRONTEND_URL: Joi.string().uri().required(),
  CORS_ORIGIN: Joi.string().required(),
  API_PREFIX: Joi.string().optional().default('api/v1'),

  // Stripe price ids, one per plan. Without them the plans exist but cannot be subscribed to,
  // and signup fails at the last step with "this plan is not available".
  STRIPE_PRICE_STARTER: Joi.string().required(),
  STRIPE_PRICE_PRO: Joi.string().required(),
  STRIPE_PRICE_ENTERPRISE: Joi.string().required(),

  // Outbound SMS fraud controls. Both have safe defaults; naming them here documents that they
  // exist and are meant to be tuned per market.
  SMS_ALLOWED_COUNTRY_CODES: Joi.string().optional(),
  SMS_GLOBAL_DAILY_LIMIT: Joi.number().integer().positive().optional(),

  // RS256 keys: required in production, optional in development (ephemeral key is generated).
  RS_PRIVATE_KEY: Joi.when('NODE_ENV', { is: 'production', then: Joi.string().required(), otherwise: Joi.string().optional() }),
  RS_PUBLIC_KEY: Joi.when('NODE_ENV', { is: 'production', then: Joi.string().required(), otherwise: Joi.string().optional() }),
  RS_KEY_ID: Joi.string().optional().default('key-1'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
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

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),

  // H-04 FIX: reCAPTCHA controlled by explicit flag, not NODE_ENV.
  // (crypto secrets are already validated above — do not redeclare them here)
  RECAPTCHA_DISABLED: Joi.boolean().default(false),
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

  AWS_S3_BUCKET_NAME: Joi.string().required(),
  AWS_REGION: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),

  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationSchema: envValidation,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        return {
          pinoHttp: {
            level: config.get<string>('NODE_ENV') !== 'production' ? 'debug' : 'info',
            transport: config.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty' }
              : undefined,
            genReqId: (req) => req.headers['x-correlation-id'] || crypto.randomUUID(),
            // Redact PII and secrets from HTTP access logs (OWASP Logging Cheat Sheet; CWE-532).
            //
            // `pino-http`'s default request serializer writes the ENTIRE header object, so this
            // list has to name every header that can carry a credential — not only the obvious
            // two. The `x-*` entries below are why: re-authentication used to accept the raw
            // account password in `x-reauth-password`, which this list did not cover, so an
            // administrator's password was written to the access log on every sensitive action.
            // That mechanism is gone, but the headers stay listed: a redaction rule that is only
            // correct for today's code is not a redaction rule.
            //
            // Response headers matter too — `set-cookie` carries the session on every login.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-xsrf-token"]',
                'req.headers["x-reauth-password"]',
                'req.headers["x-otp-code"]',
                'req.headers["x-api-key"]',
                'req.headers["stripe-signature"]',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.newPassword',
                'req.body.currentPassword',
                'req.body.confirmPassword',
                'req.body.token',
                'req.body.code',
                'req.body.otpCode',
                'req.body.recaptchaToken',
                'req.body.emailVerificationCode',
                'req.body.phoneVerificationCode',
                'req.body.clientSecret',
                'req.body.email',
                'req.body.phone',
                'req.body.taxId',
              ],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),


    CacheModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'), // Dist structure usually apps/backend/api/public
      serveRoot: '/',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({

      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: config.get<boolean>('DB_SYNCHRONIZE', false),
        logging: config.get<boolean>('DB_LOGGING', false),
        // M-04 FIX: When TLS is enabled, validate the server certificate (rejectUnauthorized:true)
        // to prevent MITM of credentials/tokens/2FA secrets in transit. An optional CA bundle
        // (DB_SSL_CA) supports private/managed-CA deployments. rejectUnauthorized can only be
        // disabled via an explicit opt-out flag, never by default.
        ssl: config.get<boolean>('DB_SSL', false)
          ? {
              rejectUnauthorized: config.get<boolean>('DB_SSL_REJECT_UNAUTHORIZED', true),
              ...(config.get<string>('DB_SSL_CA')
                ? { ca: fs.readFileSync(config.get<string>('DB_SSL_CA') as string).toString() }
                : {}),
            }
          : false,
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): ThrottlerModuleOptions => {
        const redisHost = config.get<string>('REDIS_HOST');
        const isProduction = config.get<string>('NODE_ENV') === 'production';

        if (isProduction && !redisHost) {
          throw new Error('REDIS_HOST is required for distributed throttling in production');
        }

        const storage = redisHost
          ? new ThrottlerStorageRedisService({
              host: redisHost,
              port: config.get<number>('REDIS_PORT', 6379),
            })
          : undefined; // Default to memory if no Redis host

        return {
          throttlers: [{ ttl: 60000, limit: 20 }],
          storage,
        };
      },
    }),
    GoogleRecaptchaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const disabled = config.get<boolean>('RECAPTCHA_DISABLED', false) === true;

        // The library validates its own options and rejects a missing `secretKey` outright
        // ("Google recaptcha options must be contains \"secretKey\" xor \"enterprise\""), even
        // when every check is skipped. The environment schema makes the key optional precisely
        // when RECAPTCHA_DISABLED is set, so the documented way to turn reCAPTCHA off stopped the
        // application from booting at all. A placeholder satisfies the validator; `skipIf` means
        // it is never sent anywhere.
        const secretKey = config.get<string>('RECAPTCHA_V3_SECRET_KEY');

        return {
          secretKey: secretKey || (disabled ? 'recaptcha-disabled' : ''),
          response: (req) => req.body.recaptchaToken,
          score: 0.7,
          // H-04 FIX: Skip only when RECAPTCHA_DISABLED=true — never couple to NODE_ENV.
          // Staging/preprod keep reCAPTCHA active unless the flag is explicitly set.
          skipIf: disabled,
        };
      },
    }),


    AuthModule,
    UsersModule,
    OrganizationsModule,
    SharedModule,
    ChartOfAccountsModule,
    RolesModule,
    InvoicesModule,
    InventoryModule,
    CustomersModule,
    SuppliersModule,
    PriceListsModule,
    CurrenciesModule,
    TaxesModule,
    JournalEntriesModule,
    DashboardModule,
    ReconciliationModule,
    AccountsPayableModule,
    FixedAssetsModule,
    BudgetsModule,
    DimensionsModule,
    MailModule,
    WebsocketsModule,
    AuditModule,
    ComplianceModule,
    AccountingModule,
    ConsolidationModule,
    QueuesModule,
    HealthModule, 
    SearchModule,
    MyWorkModule,
    LocalizationModule,
    UnitsOfMeasureModule,
    NotificationsModule,
    PushNotificationsModule,
    BiModule,
    PaymentModule,
    GeoModule,
    CommonModule,
    SaasModule,
    ManufacturingModule,
    SupplyChainModule,
    ProjectsModule,
    HcmModule,
    ProcurementModule,
    DatasheetsModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // CSRF is enforced by default on every state-changing request. Declared per-endpoint it
      // reached 4 of the 50 controllers that mutate state; a control that has to be remembered
      // is a control that is missing. Routes that genuinely cannot use it opt out with
      // @SkipCsrf() and say why.
      //
      // Ordering matters: this runs after JwtAuthGuard, so `request.user` is populated and the
      // token's user binding can be verified rather than only its signature.
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      // Entitlement, enforced by default. Declared per-controller it reached 1 of 67 controllers,
      // so every module except invoices kept working indefinitely after a subscription lapsed.
      // Runs after JwtAuthGuard so the tenant and its subscription status are on the request.
      // Routes a suspended customer must still reach opt out with @AllowInactiveSubscription().
      provide: APP_GUARD,
      useClass: SubscriptionActiveGuard,
    },
  ],
})
export class AppModule {}