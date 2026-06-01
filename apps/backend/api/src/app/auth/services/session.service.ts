import {
  Injectable,
  UnauthorizedException,
  Logger,
  NotFoundException,
  Inject,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as ms from 'ms';

import * as ipaddr from 'ipaddr.js';
import * as crypto from 'crypto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthConfig } from '../auth.config';
// AuditTrailService removed from here, used via event
import { ActionType } from '../../audit/entities/audit-log.entity';
import { UserCacheService } from '../modules/user-cache.service';
import { UsersService } from '../../users/users.service';
import { SecurityAnalysisService } from './security-analysis.service';
import { TokenService } from './token.service';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { AuthEvents, AuthAuditActionEvent } from '../events/auth.events';
import { AuthError } from '../enums/auth-error.enum';
import { GeoService } from '../../geo/geo.service';

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  private encryptionKey: Buffer;

  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(UserSecurity)
    private readonly userSecurityRepository: Repository<UserSecurity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userCacheService: UserCacheService,
    private readonly securityAnalysisService: SecurityAnalysisService,
    private readonly tokenService: TokenService,
    private readonly eventEmitter: EventEmitter2,
    private readonly geoService: GeoService
  ) {}

  onModuleInit() {
      const secret = this.configService.get<string>('ENCRYPTION_SECRET');
      const salt = this.configService.get<string>('AUTH_SALT');
      const isProduction = process.env['NODE_ENV'] === 'production';

      if (!secret) {
          if (isProduction) {
              throw new Error('FATAL: ENCRYPTION_SECRET is not defined in production environment.');
          }
          this.logger.warn('ENCRYPTION_SECRET not found. Using fallback for development.');
      }

      if (isProduction) {
          if (!salt || salt === 'default-salt-change-me-in-prod') {
               throw new Error('FATAL: AUTH_SALT is not defined or is using default value in production.');
          }
      } else {
          if (!salt) {
             this.logger.warn('AUTH_SALT not found. Using fallback for development.');
          }
      }

      const effectiveSecret = secret || 'default-secret-change-me-in-prod-32';
      const effectiveSalt = salt || 'default-salt-change-me-in-prod';
      // Derive key once during startup (blocking here is acceptable/expected)
      this.encryptionKey = crypto.scryptSync(effectiveSecret, effectiveSalt, 32);
  }

  private sanitizeUserAgent(userAgent?: string): string | null {
      if (!userAgent) return null;
      // Truncate to avoid DB errors
      const truncated = userAgent.substring(0, 500);
      // Basic sanitization to remove potentially malicious control characters (e.g. log injection)
      // We allow standard alphanumeric and punctuation commonly found in UAs.
      // Ideally, we treat this as opaque string but remove newlines.
      return truncated.replace(/[\r\n]/g, '');
  }

  async refreshAccessToken(token: string, ipAddress?: string, userAgent?: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload & { jti: string }>(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      if (!payload.jti) {
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
      }

      const user = await this.usersService.findUserByIdForAuth(payload.id);

      if (!user) {
        throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException(AuthError.USER_INACTIVE);
      }

      // 10/10 SECURITY: Validate tokenVersion
      if ((user.security?.tokenVersion ?? 0) !== payload.tokenVersion) {
        throw new UnauthorizedException(AuthError.SESSION_EXPIRED);
      }

      // Select encryptedIp if needed for future forensic analysis, though we don't expose it
      const refreshTokenEntity = await this.refreshTokenRepository.findOne({
        where: { id: payload.jti, userId: payload.id },
        select: ['id', 'isRevoked', 'revokedAt', 'replacedByToken', 'userAgent', 'ipAddress', 'userId', 'expiresAt', 'tokenHash']
      });

      const currentTokenHash = crypto.createHash('sha256').update(token).digest('hex');

      if (!refreshTokenEntity || refreshTokenEntity.isRevoked || refreshTokenEntity.expiresAt <= new Date() || refreshTokenEntity.tokenHash !== currentTokenHash) {
        const GRACE_PERIOD = AuthConfig.REFRESH_GRACE_PERIOD;
        if (
          refreshTokenEntity?.revokedAt &&
          Date.now() - refreshTokenEntity.revokedAt.getTime() < GRACE_PERIOD
        ) {
          const maskedJti = payload.jti.substring(0, 8) + '...';
          this.logger.warn(
            `[SECURITY] Refresh token ${maskedJti} reused within grace period. Issuing new token.`
          );

          if (refreshTokenEntity.replacedByToken) {
            await this.refreshTokenRepository.update(refreshTokenEntity.replacedByToken, {
              isRevoked: true,
              revokedAt: new Date(),
            });
          }
        } else {
          const maskedJti = payload.jti.substring(0, 8) + '...';
          const maskedUserId = user.id.substring(0, 8) + '...';
          this.logger.warn(
            `[SECURITY] Reuse detection: Refresh token ${maskedJti} was used but is revoked/missing/expired. Invalidating user ${maskedUserId} session family.`
          );

          // 10/10 SECURITY: NUCLEAR FAMILY INVALIDATION
          // When a revoked token is reused (outside grace period), we assume the token family is compromised.
          // Incrementing tokenVersion invalidates ALL existing Access and Refresh tokens for this user globally.
          await this.revokeTokenFamily(user.id);

          throw new UnauthorizedException(AuthError.REFRESH_TOKEN_REVOKED);
        }
      } else {
        // User Agent Analysis (using new SecurityAnalysisService)
        const sanitizedUserAgent = this.sanitizeUserAgent(userAgent);

        if (
          refreshTokenEntity.userAgent &&
          sanitizedUserAgent &&
          refreshTokenEntity.userAgent !== sanitizedUserAgent
        ) {
          const storedUA = this.securityAnalysisService.parseUserAgent(
            refreshTokenEntity.userAgent
          );
          const currentUA = this.securityAnalysisService.parseUserAgent(sanitizedUserAgent);

          const isBrowserMatch = storedUA.browser === currentUA.browser;
          const isOSMatch = storedUA.os === currentUA.os;

          if (!isBrowserMatch || !isOSMatch) {
            const maskedOldUA = refreshTokenEntity.userAgent.substring(0, 50).replace(/[^\w\s]/g, '') + '...';
            const maskedNewUA = userAgent?.substring(0, 50).replace(/[^\w\s]/g, '') + '...';
            this.logger.warn(
              `[SECURITY] User Agent mismatch detected (OS/Browser changed). Potential session hijacking. Stored: '${maskedOldUA}', Current: '${maskedNewUA}'`
            );
            throw new UnauthorizedException(
              AuthError.DEVICE_MISMATCH
            );
          }
        }

        if (
          refreshTokenEntity.ipAddress &&
          ipAddress &&
          refreshTokenEntity.ipAddress !== ipAddress
        ) {
          // Mask IP in logs
          const maskedIp = this.maskIp(refreshTokenEntity.ipAddress);
          const maskedNewIp = this.maskIp(ipAddress);
          this.logger.log(
            `[SECURITY] IP Change for Refresh: ${maskedIp} -> ${maskedNewIp}`
          );
        }

        refreshTokenEntity.isRevoked = true;
        refreshTokenEntity.revokedAt = new Date();
        await this.refreshTokenRepository.save(refreshTokenEntity);
      }

      const sanitizedUserAgent = this.sanitizeUserAgent(userAgent);
      const authResponse = await this.tokenService.generateAuthResponse(user, {}, ipAddress, sanitizedUserAgent);

      // Parse UA for detailed storage
      const parsedUA = this.securityAnalysisService.parseUserAgent(sanitizedUserAgent || '');

      // Update new refresh token with extended info
      const updateData: Partial<RefreshToken> = {
          lastActiveAt: new Date(),
          browser: parsedUA.browser,
          os: parsedUA.os,
          deviceType: parsedUA.deviceType,
      };

      if (ipAddress) {
          const encryptedIp = this.encryptIp(ipAddress);
          updateData.encryptedIp = encryptedIp;
          
          const location = this.geoService.getLocation(ipAddress);
          if (location) {
             updateData.country = location.country;
             updateData.city = location.city;
             updateData.region = location.region;
             updateData.latitude = location.ll ? location.ll[0] : null;
             updateData.longitude = location.ll ? location.ll[1] : null;
          }
      }

      this.refreshTokenRepository.update(authResponse.refreshTokenId, updateData).catch(e =>
          this.logger.error(`Failed to update refresh token metadata: ${e.message}`)
      );

      if (payload.jti) {
        await this.refreshTokenRepository.update(payload.jti, {
          replacedByToken: authResponse.refreshTokenId,
        });
      }

      this.eventEmitter.emit(
          AuthEvents.AUDIT_ACTION,
          new AuthAuditActionEvent(
              user.id,
              'User',
              user.id,
              ActionType.REFRESH,
              { email: user.email, ipAddress, userAgent }
          )
      );

      return {
        user: authResponse.user,
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
      };
    } catch (error) {
      this.logger.error('Error al verificar el refresh token:', (error as Error).message);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
    }
  }

  async getUserSessions(userId: string, currentRefreshTokenId?: string) {
    const sessions = await this.refreshTokenRepository.find({
      where: {
        userId,
        isRevoked: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { lastActiveAt: 'DESC', createdAt: 'DESC' },
    });

    return sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress ? this.maskIp(session.ipAddress) : null,
      userAgent: session.userAgent,
      browser: session.browser,
      os: session.os,
      deviceType: session.deviceType,
      lastActiveAt: session.lastActiveAt || session.createdAt,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: currentRefreshTokenId ? session.id === currentRefreshTokenId : false,
      country: session.country,
      city: session.city,
      region: session.region,
      // 10/10 SECURITY: DO NOT expose lat/long unless strictly necessary for business logic.
      // These are PII and should be restricted to administrative forensic tools.
    }));
  }

  async revokeTokenFamily(userId: string) {
      const security = await this.userSecurityRepository.findOne({ where: { userId } });
      if (security) {
          security.tokenVersion = (security.tokenVersion || 0) + 1;
          await this.userSecurityRepository.save(security);
      }

      await this.userCacheService.clearUserSession(userId);
      // Also explicitly revoke all refresh tokens in DB for audit purposes
      await this.refreshTokenRepository.update(
          { userId, isRevoked: false },
          { isRevoked: true, revokedAt: new Date() }
      );
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.refreshTokenRepository.findOne({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Sesión no encontrada o no pertenece al usuario.');
    }

    session.isRevoked = true;
    session.revokedAt = new Date();
    await this.refreshTokenRepository.save(session);

    return { message: 'Sesión revocada exitosamente.' };
  }

  async terminateOtherSessions(userId: string, currentSessionId: string) {
    if (!currentSessionId) {
      await this.refreshTokenRepository.update(
        { userId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() },
      );
      return;
    }

    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(
        'userId = :userId AND id != :currentSessionId AND isRevoked = false',
        { userId, currentSessionId },
      )
      .execute();
  }

  async terminateAllSessions(userId: string) {
      await this.userCacheService.clearUserSession(userId);
      await this.refreshTokenRepository.update(
        { userId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() },
      );
  }

  async verifyUserFromToken(token: string): Promise<User | null> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });

      const user = await this.usersService.findUserByIdForAuth(payload.id);

      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        (user.security?.tokenVersion || 0) !== payload.tokenVersion
      ) {
        return null;
      }

      return user;
    } catch (e) {
      return null;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleTokenCleanup() {
    this.logger.log('Starting expired refresh token cleanup...');
    const retentionPeriod = 30; // days

    // Ensure UTC consistency for Cron jobs
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - retentionPeriod);
    // Force UTC comparison effectively by ensuring we are consistent.
    const utcExpiration = new Date(Date.UTC(
        expirationDate.getFullYear(),
        expirationDate.getMonth(),
        expirationDate.getDate()
    ));

    // Optimized: Batched deletion to prevent table locking and transaction log overflow
    const BATCH_SIZE = 1000;
    let totalDeleted = 0;
    let deletedCount = 0;

    // 1. Cleanup Expired Tokens
    do {
      const expiredTokens = await this.refreshTokenRepository.find({
        where: { expiresAt: LessThan(utcExpiration) },
        take: BATCH_SIZE,
        select: ['id'], // Only select ID for performance
      });

      if (expiredTokens.length > 0) {
        const ids = expiredTokens.map((t) => t.id);
        const result = await this.refreshTokenRepository.delete(ids);
        deletedCount = result.affected || 0;
        totalDeleted += deletedCount;
        // Small delay to allow other transactions
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        deletedCount = 0;
      }
    } while (deletedCount > 0);

    // 2. Cleanup Revoked Tokens (older than retention)
    let totalRevokedDeleted = 0;
    deletedCount = 0;
    do {
      const revokedTokens = await this.refreshTokenRepository.find({
        where: { isRevoked: true, revokedAt: LessThan(utcExpiration) },
        take: BATCH_SIZE,
        select: ['id'],
      });

      if (revokedTokens.length > 0) {
        const ids = revokedTokens.map((t) => t.id);
        const result = await this.refreshTokenRepository.delete(ids);
        deletedCount = result.affected || 0;
        totalRevokedDeleted += deletedCount;
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        deletedCount = 0;
      }
    } while (deletedCount > 0);

    this.logger.log(
      `Cleanup complete. Deleted ${totalDeleted} expired tokens and ${totalRevokedDeleted} revoked tokens.`
    );
  }

  private maskIp(ip: string): string {
    try {
      if (!ipaddr.isValid(ip)) {
        return '***';
      }

      const addr = ipaddr.parse(ip);

      if (addr.kind() === 'ipv4') {
        // Mask last two octets: 192.168.x.x
        const ipv4 = addr as ipaddr.IPv4;
        return `${ipv4.octets[0]}.${ipv4.octets[1]}.*.*`;
      } else if (addr.kind() === 'ipv6') {
        let ipv6 = addr as ipaddr.IPv6;

        // Handle IPv4-mapped IPv6 addresses (::ffff:127.0.0.1)
        if (ipv6.isIPv4MappedAddress()) {
            const ipv4 = ipv6.toIPv4Address();
            return `::ffff:${ipv4.octets[0]}.${ipv4.octets[1]}.*.*`;
        }

        const parts = ipv6.parts;
        return `${parts[0].toString(16)}:${parts[1].toString(16)}:${parts[2].toString(16)}:*:*:*:*:*`;
      }
      return '***';
    } catch (e) {
      return '***';
    }
  }

  private encryptIp(ip: string): string {
     const iv = crypto.randomBytes(16);
     const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

     let encrypted = cipher.update(ip, 'utf8', 'hex');
     encrypted += cipher.final('hex');
     const authTag = cipher.getAuthTag().toString('hex');

     return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  }
}
