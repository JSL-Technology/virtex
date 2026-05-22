import { Injectable, UnauthorizedException } from '@nestjs/common';
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
      if (user.authProvider !== socialUser.provider || user.authProviderId !== socialUser.providerId) {
        await this.usersService.update(user.id, {
          authProvider: socialUser.provider,
          authProviderId: socialUser.providerId,
          avatarUrl: user.avatarUrl || socialUser.picture
        });

        user.authProvider = socialUser.provider;
        user.authProviderId = socialUser.providerId;
      }

       if (user.status !== UserStatus.ACTIVE) {
         throw new UnauthorizedException('Usuario inactivo o bloqueado.');
       }

      await this.securityAnalysisService.checkImpossibleTravel(user.id, ipAddress);

      await this.auditService.record(
        user.id,
        'User',
        user.id,
        ActionType.LOGIN,
        { email: user.email, provider: socialUser.provider, ipAddress, userAgent },
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
        secret: this.configService.getOrThrow('JWT_SECRET'),
        expiresIn: '10m'
      }
    );
  }

  async getSocialRegisterInfo(token: string): Promise<SocialUser> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
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
