
import { Module, forwardRef } from '@nestjs/common';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { GoogleRecaptchaModule, GoogleRecaptchaGuard } from '@nestlab/google-recaptcha';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthFacade } from './auth.facade';
import { RegistrationService } from './services/registration.service';
import { PendingRegistrationCleanupService } from './services/pending-registration-cleanup.service';
import { PendingRegistration } from './entities/pending-registration.entity';
import { UserOrganization } from '../organizations/entities/user-organization.entity';
import { RegistrationPaymentListener } from './listeners/registration-payment.listener';
import { TwoFactorAuthService } from './services/two-factor-auth.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { WebAuthnService } from './services/webauthn.service';
import { ImpersonationService } from './services/impersonation.service';
import { JwtStrategy } from './strategies/jwt.strategy/jwt.strategy';
import { CookieService } from './services/cookie.service';
import { SmsAbuseGuardService } from './services/sms-abuse.guard.service';
import { SessionService } from './services/session.service';
import { SecurityAnalysisService } from './services/security-analysis.service';
import { TokenService } from './services/token.service';
import { SessionRegistryService } from './services/session-registry.service';
import { UserIdentityService } from './services/user-identity.service';
import { OauthStateService } from './services/oauth-state.service';
import { OidcProviderService } from './services/oidc-provider.service';
import { EnterpriseSsoService } from './services/enterprise-sso.service';
import { SecretEncryptionService } from './services/secret-encryption.service';
import { SsoAdminService } from './services/sso-admin.service';
import { SsoAdminController } from './sso-admin.controller';

import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationCode } from './entities/verification-code.entity';
import { IdentityProvider } from './entities/identity-provider.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationDomain } from '../organizations/entities/organization-domain.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { UserSecurity } from '../users/entities/user-security.entity';
import { Passkey } from '../users/entities/passkey.entity';
import { Role } from '../roles/entities/role.entity';
import { MailModule } from '../mail/mail.module';
import { LocalizationModule } from '../localization/localization.module';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { GeoModule } from '../geo/geo.module';
import { UsersModule } from '../users/users.module';
import { TwilioSmsProvider } from './services/sms.provider';
import { AbstractSmsProvider } from './services/abstract-sms.provider';
import { SocialAuthService } from './services/social-auth.service';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { UserCacheModule } from './modules/user-cache.module';
import { PaymentModule } from '../payment/payment.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PasswordService } from './services/password.service';
import { AuthSubscriber } from './events/auth.events';
import { RegistrationStrategyFactory } from './strategies/registration/registration-strategy.factory';
import { ProfileRegistrationStrategy } from './strategies/registration/profile-registration.strategy';
import { AuthAuditListener } from './listeners/auth-audit.listener';
import { CsrfGuard } from './guards/csrf.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { IsOrganizationOwnerPolicy } from './policies/is-organization-owner.policy';
import { KeyManagementModule } from './services/key-management.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConfigModule,
    AuditModule,
    OrganizationsModule,
    GeoModule,
    KeyManagementModule,
    forwardRef(() => UsersModule),
    UserCacheModule,
    TypeOrmModule.forFeature([
      RefreshToken,
      Organization,
      VerificationCode,
      User,
      UserSecurity,
      Passkey,
      IdentityProvider,
      OrganizationDomain,
      Role,
      PendingRegistration,
      // The ownership policy resolves authority by membership, like the rest of the platform.
      UserOrganization,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // Cast because `jsonwebtoken` types `expiresIn` as the template-literal `StringValue`
          // ('1h', '30m', …) rather than plain `string`, and a config value is always a string.
          // `getOrThrow` is deliberate: a JWT module signing with `undefined` as its secret is a
          // failure that must stop the boot, not one that surfaces on the first login.
          expiresIn: config.get<string>('JWT_EXPIRATION_TIME', '1h') as `${number}h`,
        },
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
          : undefined;

        return {
          throttlers: [
            {
              ttl: Number(config.get('THROTTLE_TTL', 60000)),
              limit: Number(config.get('THROTTLE_LIMIT', 10)),
            },
          ],
          storage,
        };
      },
    }),
    // reCAPTCHA is configured ONCE, in AppModule.
    //
    // It used to be registered here as well. `GoogleRecaptchaModule` is global by default, so the
    // application declared the same global module twice with two different `skipIf` expressions —
    // one comparing a boolean, one comparing a lowercased string — and which of them governed a
    // given request depended on provider resolution order. This copy also validated its own
    // options at boot and threw `Google recaptcha options must be contains "secretKey" xor
    // "enterprise"` whenever RECAPTCHA_DISABLED was set, so the documented way to turn reCAPTCHA
    // off stopped the entire application from starting.
    MailModule,
    LocalizationModule,
    forwardRef(() => PaymentModule),
  ],
  controllers: [AuthController, SsoAdminController],
  providers: [
    AuthService,
    AuthFacade,
    RegistrationService,
    // Enforces the retention limit on `pending_registrations`, whose `expires_at` was written
    // and never read — leaving the personal data of people who never became customers on record
    // indefinitely.
    PendingRegistrationCleanupService,
    RegistrationPaymentListener,
    TwoFactorAuthService,
    PasswordRecoveryService,
    WebAuthnService,
    ImpersonationService,
    JwtStrategy,
    SmsAbuseGuardService,
    CookieService,
    SessionService,
    SecurityAnalysisService,
    TokenService,
    // C-2 / A-3: session revocation registry and the single identity-resolution service.
    SessionRegistryService,
    UserIdentityService,
    GoogleRecaptchaGuard,
    OauthStateService,
    OidcProviderService,
    EnterpriseSsoService,
    SecretEncryptionService,
    SsoAdminService,
    SocialAuthService,
    MfaOrchestratorService,
    PasswordService,
    AuthSubscriber,
    RegistrationStrategyFactory,
    ProfileRegistrationStrategy,
    AuthAuditListener,
    CsrfGuard,
    StepUpGuard,
    // M-05 FIX: register the ABAC policy so PermissionsGuard can resolve it via DI
    // (moduleRef.get). Previously it was never provided, so it failed-secure as "not found".
    IsOrganizationOwnerPolicy,
    // KeyManagementService is now provided by the @Global KeyManagementModule so a single
    // instance is shared with the WebSocket gateway (same RS256 key for sign + verify).
    {
      provide: AbstractSmsProvider,
      useClass: TwilioSmsProvider
    }
  ],
  exports: [
    AuthService,
    AuthFacade,
    TwoFactorAuthService,
    PasswordRecoveryService,
    PasswordService,
    WebAuthnService,
    ImpersonationService,
    PassportModule,
    JwtModule,
    JwtStrategy,
    CookieService,
    SocialAuthService,
    MfaOrchestratorService,
    UserCacheModule,
    SessionService,
    SessionRegistryService,
    UserIdentityService,
    TokenService,
    CsrfGuard,
    StepUpGuard,
    IsOrganizationOwnerPolicy,
    KeyManagementModule,
  ],
})
export class AuthModule {}
