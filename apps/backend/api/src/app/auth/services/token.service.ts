
import { Injectable, UnauthorizedException, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import ms from 'ms';
import * as crypto from 'crypto';
import * as ipaddr from 'ipaddr.js';
import * as jwt from 'jsonwebtoken';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { KeyManagementService } from './key-management.service';

import { User } from '../../users/entities/user.entity/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthConfig } from '../auth.config';
import { UserCacheService } from '../modules/user-cache.service';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { GeoService } from '../../geo/geo.service';
import { UserIdentityService } from './user-identity.service';

@Injectable()
export class TokenService implements OnModuleInit {
  private encryptionKey!: Buffer;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly userCacheService: UserCacheService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly geoService: GeoService,
    private readonly keyManagementService: KeyManagementService,
    private readonly userIdentityService: UserIdentityService,
  ) {}

  onModuleInit(): void {
    // H-01 FIX: Fail fast — getOrThrow throws at startup if any required secret is absent.
    const secret = this.configService.getOrThrow<string>('ENCRYPTION_SECRET');
    const salt = this.configService.getOrThrow<string>('AUTH_SALT');
    const isProduction = process.env['NODE_ENV'] === 'production';
    if (isProduction && /change-me|default/i.test(secret + salt)) {
      throw new Error('FATAL: weak ENCRYPTION_SECRET or AUTH_SALT detected in production environment.');
    }
    this.encryptionKey = crypto.scryptSync(secret, salt, 32);
  }

  private maskIp(ip?: string): string | undefined {
    if (!ip) return undefined;
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
      return `${parts[0].toString(16)}:${parts[1].toString(16)}:${parts[2].toString(16)}:*:*:*:*:*`;
    } catch {
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

  // A-3: identity resolution is centralised in UserIdentityService. These two methods used to
  // carry their own copy of the cache/status/tokenVersion logic, which had already drifted from
  // the copy in JwtStrategy (notably on which UserStatus values may authenticate). They now
  // delegate so there is exactly one policy.
  async validateTokenAndGetUser(payload: JwtPayload): Promise<AuthenticatedUser> {
    return this.userIdentityService.resolveFromPayload(payload);
  }

  async getFreshUserStatus(userFromJwt: AuthenticatedUser) {
    return { user: await this.userIdentityService.resolveFresh(userFromJwt) };
  }

  /**
   * Issue an access/refresh token pair and persist the refresh-token row that anchors the session.
   *
   * @param options.sessionId  Family id to continue. Omit when starting a NEW session (login,
   *                           social login, invitation); pass the previous token's `sessionId`
   *                           when rotating, so the session keeps a stable identity across
   *                           rotations (see RefreshToken.sessionId).
   */
  async generateAuthResponse(
    user: User,
    extraPayload: Partial<JwtPayload> = {},
    ipAddress?: string,
    userAgent?: string,
    rememberMe: boolean = false,
    options: { sessionId?: string; refreshExpirationOverride?: string } = {},
  ) {
    const payload = this.buildPayload(user, extraPayload);
    const safeUser = this.buildSafeUser(user);

    const userWithImpersonationStatus = {
      ...safeUser,
      isImpersonating: payload.isImpersonating || false,
      originalUserId: payload.originalUserId || undefined,
    };

    // "Remember me" must widen the DB row's expiry too, not just the cookie, otherwise the
    // server-side record expires while the browser still holds a usable cookie.
    const refreshExpiration =
      options.refreshExpirationOverride ??
      (rememberMe
        ? AuthConfig.JWT_REFRESH_REMEMBER_ME_EXPIRATION
        : AuthConfig.JWT_REFRESH_EXPIRATION);

    const expirationDate = new Date(Date.now() + ms(refreshExpiration as ms.StringValue));

    // H9: masked IP is what we display; the encrypted copy exists only for incident forensics
    // (GDPR Art.4 data minimisation, CWE-312).
    const maskedIp = ipAddress ? this.maskIp(ipAddress) : undefined;
    const encryptedIp = ipAddress ? this.encryptIp(ipAddress) : undefined;

    // The row id is generated up-front rather than by the database so both tokens can be signed
    // and the token hash computed BEFORE the row is written. The previous implementation saved
    // the row, signed the refresh token, then issued a second UPDATE to store its hash — leaving
    // a window in which a live refresh token had no hash on record to verify against.
    const rowId = crypto.randomUUID();
    const familyId = options.sessionId ?? rowId;

    const payloadWithSession: JwtPayload = { ...payload, sessionId: familyId };
    const accessToken = this.getJwtToken(payloadWithSession, AuthConfig.JWT_ACCESS_EXPIRATION);

    const refreshTokenPayload = { ...payload, jti: rowId, sessionId: familyId };
    const refreshToken = this.getJwtToken(
      refreshTokenPayload,
      refreshExpiration,
      this.configService.getOrThrow('JWT_REFRESH_SECRET')
    );

    const refreshTokenRecord = this.refreshTokenRepository.create({
      id: rowId,
      sessionId: familyId,
      user: user,
      userId: user.id,
      isRevoked: false,
      expiresAt: expirationDate,
      ipAddress: maskedIp,
      encryptedIp,
      userAgent,
      // Bind the row to the exact token string that was handed out, so a forged JWT that happens
      // to carry a valid jti cannot be swapped in (verified on every refresh).
      tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      lastActiveAt: new Date(),
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

    return {
      user: userWithImpersonationStatus,
      accessToken,
      refreshToken,
      refreshTokenId: rowId,
      sessionId: familyId,
    };
  }

  getJwtToken(payload: JwtPayload, expiresIn?: string, secret?: string) {
    // H-05 FIX: Access tokens use RS256 with kid for key rotation support (OWASP JWT Cheat Sheet;
    // NIST SP 800-57). Special-purpose tokens (refresh, 2FA, preverify) keep HS256 with their own secrets.
    if (secret) {
      return this.jwtService.sign(payload, {
        secret,
        expiresIn: expiresIn || AuthConfig.JWT_ACCESS_EXPIRATION,
        algorithm: 'HS256',
        issuer: 'virteex-api',
        audience: 'virteex-web',
      });
    }

    // Use jsonwebtoken directly to avoid @nestjs/jwt picking the module-level
    // `secret` (HS256) over the `privateKey` we pass (RS256).
    const { kid, privateKey } = this.keyManagementService.getActiveKey();
    // Cast required: ms() types expect StringValue (template literal), not string
    const expSeconds = Math.floor((ms as (v: string) => number)(expiresIn || AuthConfig.JWT_ACCESS_EXPIRATION) / 1000);
    return jwt.sign(payload as object, privateKey, {
      expiresIn: expSeconds,
      algorithm: 'RS256',
      keyid: kid,
      issuer: 'virteex-api',
      audience: 'virteex-web',
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
}
