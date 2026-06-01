import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { SocialUser } from '../interfaces/social-user.interface';
import { UsersService } from '../../users/users.service';
import { SecurityAnalysisService } from './security-analysis.service';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';
import { TokenService } from './token.service';

@Injectable()
export class SocialAuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditTrailService,
    private readonly securityAnalysisService: SecurityAnalysisService,
    private readonly tokenService: TokenService
  ) {}

  async validateOAuthLogin(socialUser: SocialUser, ipAddress?: string, userAgent?: string): Promise<{ user: User | null; tokens?: any }> {
    // 1. Use findUserForAuth to ensure security relation is loaded (required for tokenVersion)
    const user = await this.usersService.findUserForAuth(socialUser.email);

    if (user) {
      // H-03 FIX: Prevent cross-provider account linking without step-up verification.
      // Auto-linking by email only is safe when the existing account was created via the
      // SAME provider (updating providerId) but NOT when the account uses a different
      // sign-in method — that requires explicit user consent + re-authentication.
      // (OWASP ASVS 2.1.5; OAuth 2.0 Security BCP; CWE-287)
      if (user.authProvider && user.authProvider !== socialUser.provider) {
        throw new UnauthorizedException(
          'An account with this email already exists using a different sign-in method. ' +
          'Please sign in using your original provider.'
        );
      }

      if (user.authProvider === socialUser.provider && user.authProviderId !== socialUser.providerId) {
        await this.usersService.update(user.id, {
          authProviderId: socialUser.providerId,
          avatarUrl: user.avatarUrl || socialUser.picture,
        });
        user.authProviderId = socialUser.providerId;
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Usuario inactivo o bloqueado.');
      }

      await this.securityAnalysisService.checkImpossibleTravel(user.id, ipAddress);

      // H-13 FIX: Minimize PII — store hashed email, truncated UA, masked IP
      // (OWASP Logging Cheat Sheet; GDPR data minimization; CWE-532).
      await this.auditService.record(
        user.id,
        'User',
        user.id,
        ActionType.LOGIN,
        {
          emailHash: createHash('sha256').update(user.email).digest('hex').slice(0, 16),
          provider: socialUser.provider,
          ipAddressMasked: ipAddress ? ipAddress.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*') : undefined,
          userAgentTruncated: userAgent ? userAgent.substring(0, 100) : undefined,
        },
        undefined,
      );

       const authResponse = await this.tokenService.generateAuthResponse(user, {}, ipAddress, userAgent);
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
      const payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow('JWT_SOCIAL_REGISTER_SECRET'),
      });

      if (payload.type !== 'social-register') {
        throw new UnauthorizedException('Token inválido para registro.');
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
      throw new UnauthorizedException('Token de registro inválido o expirado.');
    }
  }
}
