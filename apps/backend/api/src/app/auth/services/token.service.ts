
import { Injectable, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// import * as ms from 'ms';
import ms from 'ms';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as ipaddr from 'ipaddr.js';
import * as crypto from 'crypto';

import { User } from '../../users/entities/user.entity/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthConfig } from '../auth.config';
import { UserCacheService } from '../modules/user-cache.service';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { AuthError } from '../enums/auth-error.enum';
import { UserStatus } from '../../users/entities/user.entity/user.entity';
import { GeoService } from '../../geo/geo.service';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly userCacheService: UserCacheService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly geoService: GeoService
  ) {}

  async validateTokenAndGetUser(payload: JwtPayload): Promise<AuthenticatedUser> {
    // 10/10 OPTIMIZATION: Use CACHE_MANAGER explicitly or via UserCacheService
    // UserCacheService already handles Redis/Memory caching of User entity.
    let user = await this.userCacheService.getUser(payload.id);

    if (!user) {
      user = await this.usersService.findUserByIdForAuth(payload.id);

      if (user) {
        await this.userCacheService.setUser(payload.id, user, AuthConfig.CACHE_TTL);
      }
    }

    if (!user || user.status === UserStatus.BLOCKED) {
      throw new UnauthorizedException(AuthError.USER_BLOCKED);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(AuthError.USER_INACTIVE);
    }

    // Check token version against user security settings
    const tokenVersion = user.security?.tokenVersion || 0;

    if (tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException(AuthError.SESSION_EXPIRED);
    }

    const safeUser = this.buildSafeUser(user);

    return {
      ...safeUser,
      isImpersonating: payload.isImpersonating,
      originalUserId: payload.originalUserId,
    };
  }

  async getFreshUserStatus(userFromJwt: AuthenticatedUser) {
    let freshUser = await this.userCacheService.getUser(userFromJwt.id);

    if (!freshUser) {
        freshUser = await this.usersService.findUserByIdForAuth(userFromJwt.id);

        if (freshUser) {
            await this.userCacheService.setUser(userFromJwt.id, freshUser, AuthConfig.CACHE_TTL);
        }
    }

    if (!freshUser) {
      throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
    }

    const safeUser = this.buildSafeUser(freshUser);

    const userWithImpersonationStatus: AuthenticatedUser = {
      ...safeUser,
      isImpersonating: userFromJwt.isImpersonating || false,
      originalUserId: userFromJwt.originalUserId || undefined,
    };

    return { user: userWithImpersonationStatus };
  }

  async generateAuthResponse(
    user: User,
    extraPayload: Partial<JwtPayload> = {},
    ipAddress?: string,
    userAgent?: string,
    rememberMe: boolean = false
  ) {
    const payload = this.buildPayload(user, extraPayload);
    const safeUser = this.buildSafeUser(user);

    const userWithImpersonationStatus = {
      ...safeUser,
      isImpersonating: payload.isImpersonating || false,
      originalUserId: payload.originalUserId || undefined,
    };

    // 10/10 SECURITY: Correct "Remember Me" handling
    // Ensure DB record expiration matches the cookie/token intent.
    const refreshExpiration = rememberMe
        ? AuthConfig.JWT_REFRESH_REMEMBER_ME_EXPIRATION
        : AuthConfig.JWT_REFRESH_EXPIRATION;

    const expirationDate = new Date(Date.now() + ms(refreshExpiration));

    // H9 FIX: Store masked IP for display; store encrypted IP for forensics only.
    const maskedIp = ipAddress ? this.maskIp(ipAddress) : undefined;
    const encryptedIp = ipAddress ? this.encryptIp(ipAddress) : undefined;

    const refreshTokenRecord = this.refreshTokenRepository.create({
      user: user,
      userId: user.id,
      isRevoked: false,
      expiresAt: expirationDate,
      ipAddress: maskedIp,
      encryptedIp,
      userAgent,
    });

    if (ipAddress) {
       const location = this.geoService.getLocation(ipAddress);
       if (location) {
          refreshTokenRecord.country = location.country;
          refreshTokenRecord.city = location.city;
          refreshTokenRecord.region = location.region;
          refreshTokenRecord.latitude = location.ll ? location.ll[0] : null;
          refreshTokenRecord.longitude = location.ll ? location.ll[1] : null;
       }
    }

    await this.refreshTokenRepository.save(refreshTokenRecord);

    const payloadWithSession: JwtPayload = { ...payload, sessionId: refreshTokenRecord.id };
    const accessToken = this.getJwtToken(payloadWithSession, AuthConfig.JWT_ACCESS_EXPIRATION);

    const refreshTokenPayload = { ...payload, jti: refreshTokenRecord.id };
    const refreshToken = this.getJwtToken(
      refreshTokenPayload,
      refreshExpiration,
      this.configService.getOrThrow('JWT_REFRESH_SECRET')
    );

    return {
      user: userWithImpersonationStatus,
      accessToken,
      refreshToken,
      refreshTokenId: refreshTokenRecord.id,
    };
  }

  getJwtToken(payload: JwtPayload, expiresIn?: string, secret?: string) {
    return this.jwtService.sign(payload, {
      secret: secret || this.configService.getOrThrow('JWT_SECRET'),
      expiresIn: expiresIn || AuthConfig.JWT_ACCESS_EXPIRATION,
    });
  }

  buildSafeUser(user: User) {
    const permissions = [...new Set(user.roles.flatMap((role) => role.permissions))];
    // Security fields are now in user.security, so they are not directly on user.
    // However, if user.security is loaded (eager: true), we should exclude it or transform it.
    // User entity no longer has passwordHash or twoFactorSecret directly.
    const { security, ...safeUser } = user;
    return {
      ...safeUser,
      permissions,
      organization: user.organization,
      // If we want to expose some security flags (like isTwoFactorEnabled), we should add them back.
      isTwoFactorEnabled: security?.isTwoFactorEnabled || false
    };
  }

  buildPayload(user: User, extra: Partial<JwtPayload> = {}): JwtPayload {
    return {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      roles: user.roles.map((r) => r.name),
      tokenVersion: user.security?.tokenVersion || 0,
      ...extra,
    };
  }

  // H9: Mask last two octets for IPv4, last segments for IPv6.
  private maskIp(ip: string): string {
    try {
      if (!ipaddr.isValid(ip)) return '***';
      const addr = ipaddr.parse(ip);
      if (addr.kind() === 'ipv4') {
        const v4 = addr as ipaddr.IPv4;
        return `${v4.octets[0]}.${v4.octets[1]}.*.*`;
      }
      const v6 = addr as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) {
        const v4 = v6.toIPv4Address();
        return `::ffff:${v4.octets[0]}.${v4.octets[1]}.*.*`;
      }
      const parts = v6.parts;
      return `${parts[0].toString(16)}:${parts[1].toString(16)}:*:*:*:*:*:*`;
    } catch {
      return '***';
    }
  }

  private encryptIp(ip: string): string {
    const secret = this.configService.get<string>('ENCRYPTION_SECRET');
    if (!secret) return '';
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(ip, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  }
}
