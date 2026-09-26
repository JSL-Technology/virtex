import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { SocialUser } from '../interfaces/social-user.interface';
import { UsersService } from '../../users/users.service';
import { SecurityAnalysisService } from './security-analysis.service';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';
import { TokenService } from './token.service';
import { ConflictError, UnauthorizedError } from '../../i18n/localized.exception';
import { MfaPolicyPort } from '../ports/mfa-policy.port';
import { resolveMfaEnrolmentClaim } from './mfa-enrolment-claim.util';

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditTrailService,
    private readonly securityAnalysisService: SecurityAnalysisService,
    private readonly tokenService: TokenService,
    private readonly mfaPolicy: MfaPolicyPort,
  ) {}

  // L-10: Hash PII (email/IP/UA) to a short, non-reversible digest before persisting in logs/audit.
  private hashPii(value: string): string {
    return crypto.createHash('sha256').update((value || '').toLowerCase().trim()).digest('hex').slice(0, 12);
  }

  async validateOAuthLogin(socialUser: SocialUser, ipAddress?: string, userAgent?: string): Promise<{ user: User | null; tokens?: any }> {
    // 1. Use findUserForAuth to ensure security relation is loaded (required for tokenVersion)
    const user = await this.usersService.findUserForAuth(socialUser.email);

    if (user) {
      // M-02 / H-03: An OAuth identity is "new" to this account if either the provider or the
      // provider-id differs from what is stored. Cross-provider/cross-method linking is the
      // pre-account-hijacking risk (OWASP ASVS 2.1.5; OAuth 2.0 Security BCP; CWE-287).
      const isNewLink =
        user.authProvider !== socialUser.provider || user.authProviderId !== socialUser.providerId;

      if (isNewLink) {
        // M-02 FIX: Never (re)link an OAuth identity to an existing local account unless the
        // provider asserts the email is verified. A malicious/custom IdP could otherwise claim
        // a victim's email and take over the account (pre-account-hijacking).
        if (!socialUser.emailVerified) {
          throw new UnauthorizedError('auth.provider_has_not_verified_your_email');
        }

        // M-02 FIX: If the account already has a local password (or a different provider),
        // refuse silent linking and require an authenticated account-linking step (user must
        // sign in with their original method first). This prevents a second sign-in method
        // from hijacking an existing account.
        if (user.security?.passwordHash || (user.authProvider && user.authProvider !== socialUser.provider)) {
          throw new ConflictError('auth.account_already_exists_email_sign_with');
        }

        await this.usersService.update(user.id, {
          authProviderId: socialUser.providerId,
          avatarUrl: user.avatarUrl || socialUser.picture,
        });
        user.authProviderId = socialUser.providerId;
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedError('auth.user_inactive_blocked');
      }

      await this.securityAnalysisService.checkImpossibleTravel(user.id, ipAddress);

      // L-10 / H-13 FIX: Do not store raw PII (email/IP/UA) in the audit trail. Mirror the
      // hashing used elsewhere (mfa-orchestrator / session.service) for privacy/GDPR
      // minimization (OWASP Logging Cheat Sheet; CWE-532).
      await this.auditService.record(
        user.id,
        'User',
        user.id,
        ActionType.LOGIN,
        {
          emailHash: this.hashPii(user.email),
          provider: socialUser.provider,
          ipHash: ipAddress ? this.hashPii(ipAddress) : undefined,
          uaHash: userAgent ? this.hashPii(userAgent) : undefined,
        },
        undefined,
      );

       const mfaClaim = await resolveMfaEnrolmentClaim(this.mfaPolicy, user.organizationId, this.logger);
       const authResponse = await this.tokenService.generateAuthResponse(user, mfaClaim, ipAddress, userAgent);
       return { user, tokens: authResponse };
    }

    return { user: null };
  }

  async generateRegisterToken(socialUser: SocialUser): Promise<string> {
    return this.jwtService.sign(
      {
        email: socialUser.email,
        firstName: socialUser.firstName,
        lastName: socialUser.lastName,
        provider: socialUser.provider,
        picture: socialUser.picture,
        type: 'social-register'
      },
      {
        secret: this.configService.getOrThrow('JWT_SOCIAL_REGISTER_SECRET'),
        expiresIn: '10m'
      }
    );
  }

  async getSocialRegisterInfo(token: string): Promise<SocialUser> {
    try {
      // session-revocation-allow: a SOCIAL-REGISTER handoff token. It carries the profile an OAuth
      // provider returned, across the one redirect between the callback and the signup form. There
      // is no account behind it yet, so there is no session to revoke.
      const payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow('JWT_SOCIAL_REGISTER_SECRET'),
      });

      if (payload.type !== 'social-register') {
        throw new UnauthorizedError('auth.invalid_registration_token');
      }

      return {
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        provider: payload.provider,
        picture: payload.picture,
        providerId: '',
        accessToken: ''
      };
    } catch (e) {
      throw new UnauthorizedError('auth.registration_token_invalid_has_expired');
    }
  }
}
