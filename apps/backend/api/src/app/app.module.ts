

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt/jwt.guard';
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
import { CountryModule } from '../../../../../libs/api/country/src/lib/country.module';
import { GeoModule } from './geo/geo.module';
import { CommonModule } from './common/common.module';
import { SaasModule } from './saas/saas.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { SupplyChainModule } from './supply-chain/supply-chain.module';
import { ProjectsModule } from './projects/projects.module';
import { HcmModule } from './hcm/hcm.module';
import { ProcurementModule } from './procurement/procurement.module';

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
            // H-11 FIX: Redact PII and secrets from HTTP access logs (OWASP Logging Cheat Sheet; CWE-532).
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.token',
                'req.body.code',
                'req.body.recaptchaToken',
                'req.body.currentPassword',
                'req.body.newPassword',
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
      useFactory: (config: ConfigService) => ({
        secretKey: config.get('RECAPTCHA_V3_SECRET_KEY'),
        response: (req) => req.body.recaptchaToken,
        score: 0.7,
        // H-04 FIX: Skip only when RECAPTCHA_DISABLED=true — never couple to NODE_ENV.
        // Staging/preprod keep reCAPTCHA active unless the flag is explicitly set.
        skipIf: config.get<boolean>('RECAPTCHA_DISABLED', false) === true,
      }),
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
    CountryModule,
    GeoModule,
    CommonModule,
    SaasModule,
    ManufacturingModule,
    SupplyChainModule,
    ProjectsModule,
    HcmModule,
    ProcurementModule
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
  ],
})
export class AppModule {}