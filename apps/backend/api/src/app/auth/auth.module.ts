
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
import { TwoFactorAuthService } from './services/two-factor-auth.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { WebAuthnService } from './services/webauthn.service';
import { ImpersonationService } from './services/impersonation.service';
import { JwtStrategy } from './strategies/jwt.strategy/jwt.strategy';
import { CookieService } from './services/cookie.service';
import { SessionService } from './services/session.service';
import { SecurityAnalysisService } from './services/security-analysis.service';
import { TokenService } from './services/token.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { MicrosoftStrategy } from './strategies/microsoft.strategy';
import { OktaStrategy } from './strategies/okta.strategy';

import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationCode } from './entities/verification-code.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { UserSecurity } from '../users/entities/user-security.entity';
import { Passkey } from '../users/entities/passkey.entity';
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
import { DoRegistrationStrategy } from './strategies/registration/do-registration.strategy';
import { UsRegistrationStrategy } from './strategies/registration/us-registration.strategy';
import { AuthAuditListener } from './listeners/auth-audit.listener';
import { CsrfGuard } from './guards/csrf.guard';
import { IsOrganizationOwnerPolicy } from './policies/is-organization-owner.policy';
import { KeyManagementService } from './services/key-management.service';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConfigModule,
    AuditModule,
    OrganizationsModule,
    GeoModule,
    forwardRef(() => UsersModule),
    UserCacheModule,
    TypeOrmModule.forFeature([RefreshToken, Organization, VerificationCode, User, UserSecurity, Passkey]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRATION_TIME', '1h'),
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
    GoogleRecaptchaModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secretKey: config.get<string>('RECAPTCHA_V3_SECRET_KEY'),
        response: (req) => req.body.recaptchaToken,
        score: 0.7,
        // H-04 FIX: Controlled by explicit RECAPTCHA_DISABLED flag, not NODE_ENV.
        // String comparison is required because ConfigService returns env vars as strings.
        skipIf: String(config.get('RECAPTCHA_DISABLED', 'false')).toLowerCase() === 'true',
      }),
    }),
    MailModule,
    LocalizationModule,
    PaymentModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthFacade,
    RegistrationService,
    TwoFactorAuthService,
    PasswordRecoveryService,
    WebAuthnService,
    ImpersonationService,
    JwtStrategy,
    CookieService,
    SessionService,
    SecurityAnalysisService,
    TokenService,
    GoogleRecaptchaGuard,
    GoogleStrategy,
    MicrosoftStrategy,
    OktaStrategy,
    SocialAuthService,
    MfaOrchestratorService,
    PasswordService,
    AuthSubscriber,
    RegistrationStrategyFactory,
    DoRegistrationStrategy,
    UsRegistrationStrategy,
    AuthAuditListener,
    CsrfGuard,
    // M-05 FIX: register the ABAC policy so PermissionsGuard can resolve it via DI
    // (moduleRef.get). Previously it was never provided, so it failed-secure as "not found".
    IsOrganizationOwnerPolicy,
    KeyManagementService,
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
    CsrfGuard,
    IsOrganizationOwnerPolicy,
    KeyManagementService,
  ],
})
export class AuthModule {}
