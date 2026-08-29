import {
  Injectable,
  UnauthorizedException,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as ipaddr from 'ipaddr.js';
import * as crypto from 'crypto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
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
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { AuthConfig } from '../auth.config';
import { SessionRegistryService } from './session-registry.service';
import { KeyManagementService } from './key-management.service';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

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
    private readonly geoService: GeoService,
    private readonly cryptoUtil: CryptoUtil,
    private readonly sessionRegistry: SessionRegistryService,
    private readonly keyManagementService: KeyManagementService
  ) {}

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
      const payload = this.jwtService.verify<JwtPayload & { jti?: string }>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        issuer: 'virteex-api',
        audience: 'virteex-web',
      });

      const user = await this.usersService.findUserByIdForAuth(payload.id);

      if (!user) {
        throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException(AuthError.USER_INACTIVE);
      }

      // The refresh path must honour global invalidation exactly like the access path does.
      // Without this check a refresh token issued before a password change or a "log out
      // everywhere" kept minting fresh access tokens, because only the access-token validator
      // ever compared tokenVersion.
      const currentTokenVersion = user.security?.tokenVersion ?? 0;
      if (currentTokenVersion !== (payload.tokenVersion ?? 0)) {
        this.logger.warn(
          { event: 'refresh_stale_token_version', userId: user.id },
          '[SECURITY] Refresh token predates a global session invalidation',
        );
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_REVOKED);
      }

      // A refresh token without a jti cannot be tied to a session and therefore cannot be
      // rotated or revoked. Reject rather than silently issuing an unanchored session.
      if (!payload.jti) {
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
      }

      const refreshTokenEntity = await this.refreshTokenRepository.findOne({
        where: { id: payload.jti },
        select: [
          'id', 'sessionId', 'isRevoked', 'revokedAt', 'replacedByToken',
          'userAgent', 'ipAddress', 'userId', 'expiresAt',
        ],
      });

      if (!refreshTokenEntity) {
        // Unknown id: never issued by us (forged) or already purged. Fail closed WITHOUT
        // invalidating the family — we cannot attribute it to a live session.
        this.logger.warn(
          { event: 'refresh_unknown_jti', jtiPrefix: payload.jti.substring(0, 8) },
          '[SECURITY] Refresh token with unknown id',
        );
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
      }

      // Defence in depth: the jti is signed, but binding it to the subject means a row/token
      // mix-up can never authenticate the wrong account.
      if (refreshTokenEntity.userId !== user.id) {
        this.logger.warn(
          { event: 'refresh_subject_mismatch', userId: user.id },
          '[SECURITY] Refresh token does not belong to the token subject',
        );
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
      }

      if (refreshTokenEntity.expiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
      }

      // Verify the presented token against the stored hash. The hash column was previously
      // written on every issue and never read, so it protected nothing. Comparing it means the
      // database row is bound to the exact token string handed to the client.
      await this.assertTokenHashMatches(payload.jti, token);

      const sessionId = refreshTokenEntity.sessionId ?? refreshTokenEntity.id;

      // A session revoked out-of-band (logout, "revoke device", admin action) must not be
      // resurrectable by a refresh token that is still cryptographically valid.
      if (await this.sessionRegistry.isRevoked(sessionId)) {
        this.logger.warn(
          { event: 'refresh_revoked_session', sessionPrefix: sessionId.substring(0, 8) },
          '[SECURITY] Refresh attempted on a revoked session',
        );
        throw new UnauthorizedException(AuthError.REFRESH_TOKEN_REVOKED);
      }

      // L-14: atomically claim the token (flip is_revoked false→true in one UPDATE). Only one
      // concurrent request can win, eliminating the read-then-write race that caused
      // false-positive reuse detection when an SPA fires several refreshes at once.
      const claim = await this.refreshTokenRepository.update(
        { id: payload.jti, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() },
      );

      if (claim.affected === 0) {
        // Already revoked. Distinguish a benign concurrent refresh from genuine reuse.
        //
        // C-3 FIX: the discriminator is `replacedByToken`, NOT elapsed time. Time alone was
        // wrong because logout and "revoke session" also stamp revokedAt: presenting a refresh
        // token within the 2-second grace window of a logout landed in the "benign" branch and
        // minted a brand-new session, resurrecting the session the user had just ended.
        //
        // A token that was superseded by rotation has replacedByToken set; a token revoked by
        // logout never does. Time is still required as a second condition so a genuinely
        // replayed old token (stolen after a legitimate rotation) is still caught.
        const fresh = await this.refreshTokenRepository.findOne({
          where: { id: payload.jti },
          select: ['id', 'revokedAt', 'replacedByToken'],
        });

        const wasRotated = Boolean(fresh?.replacedByToken);
        const revokedAt = fresh?.revokedAt ?? refreshTokenEntity.revokedAt ?? null;
        const withinGrace =
          !!revokedAt && Date.now() - revokedAt.getTime() <= AuthConfig.REFRESH_GRACE_PERIOD;

        if (!wasRotated || !withinGrace) {
          const reason = !wasRotated ? 'revoked_not_rotated' : 'outside_grace_window';
          this.logger.warn(
            { event: 'refresh_reuse', reason, sessionPrefix: sessionId.substring(0, 8) },
            '[SECURITY] Refresh token reuse detected — invalidating the whole family',
          );
          await this.invalidateSessionFamily(user, sessionId);
          throw new UnauthorizedException(AuthError.REFRESH_TOKEN_REVOKED);
        }

        // Genuine concurrent rotation (RFC 9700 §4.14.2 concurrency tolerance).
        this.logger.log(
          { event: 'refresh_grace', sessionPrefix: sessionId.substring(0, 8) },
          '[SECURITY] Concurrent refresh tolerated within grace period',
        );
      } else {
        // We claimed the token. Run device heuristics on the rotation.
        const sanitized = this.sanitizeUserAgent(userAgent);

        if (refreshTokenEntity.userAgent && sanitized && refreshTokenEntity.userAgent !== sanitized) {
          const storedUA = this.securityAnalysisService.parseUserAgent(refreshTokenEntity.userAgent);
          const currentUA = this.securityAnalysisService.parseUserAgent(sanitized);

          if (storedUA.browser !== currentUA.browser || storedUA.os !== currentUA.os) {
            // H14: log the browser/OS summary only, never the full UA string.
            this.logger.warn(
              { event: 'ua_mismatch', stored: storedUA.browser, current: currentUA.browser },
              '[SECURITY] User agent mismatch on refresh',
            );
            // The token was already consumed by the claim above; revoke the family so a stolen
            // token replayed from another device cannot continue the session.
            await this.invalidateSessionFamily(user, sessionId);
            throw new UnauthorizedException(AuthError.DEVICE_MISMATCH);
          }
          this.logger.log(
            { event: 'ua_minor_change', browser: storedUA.browser },
            '[SECURITY] Minor user agent change (likely a browser update)',
          );
        }

        if (refreshTokenEntity.ipAddress && ipAddress && refreshTokenEntity.ipAddress !== this.maskIp(ipAddress)) {
          this.logger.log(
            { event: 'ip_change', from: refreshTokenEntity.ipAddress, to: this.maskIp(ipAddress) },
            '[SECURITY] IP change on refresh',
          );
        }
      }

      const sanitizedUserAgent = this.sanitizeUserAgent(userAgent);
      const parsedUA = this.securityAnalysisService.parseUserAgent(sanitizedUserAgent || '');

      // Continue the SAME session family so the access token's sessionId claim — and therefore
      // the entry the user sees under "Sesiones activas" — stays stable across rotations.
      const authResponse = await this.tokenService.generateAuthResponse(
        user,
        {},
        ipAddress,
        sanitizedUserAgent ?? undefined,
        false,
        { sessionId },
      );

      const updateData: Partial<RefreshToken> = {
        lastActiveAt: new Date(),
        browser: parsedUA.browser,
        os: parsedUA.os,
        deviceType: parsedUA.deviceType,
      };

      if (ipAddress) {
        // H9: masked IP for display, encrypted IP for forensics.
        updateData.ipAddress = this.maskIp(ipAddress);
        updateData.encryptedIp = this.encryptIp(ipAddress);

        const location = this.geoService.getLocation(ipAddress);
        if (location) {
          updateData.country = location.country ?? undefined;
          updateData.city = location.city ?? undefined;
          updateData.region = location.region ?? undefined;
          updateData.latitude = location.ll ? location.ll[0] : undefined;
          updateData.longitude = location.ll ? location.ll[1] : undefined;
        }
      }

      // Awaited: this was previously fire-and-forget, so a failure left the new session row
      // without device/geo metadata and the "Sesiones activas" list showed a blank device.
      await this.refreshTokenRepository.update(authResponse.refreshTokenId, updateData);

      await this.refreshTokenRepository.update(payload.jti, {
        replacedByToken: authResponse.refreshTokenId,
      });

      // H9 FIX: Emit audit event with hashed email and masked IP — no PII in plaintext logs.
      this.eventEmitter.emit(
          AuthEvents.AUDIT_ACTION,
          new AuthAuditActionEvent(
              user.id,
              'User',
              user.id,
              ActionType.REFRESH,
              {
                  emailHash: crypto.createHash('sha256').update((user.email || '').toLowerCase().trim()).digest('hex').slice(0, 12),
                  ipAddress: ipAddress ? this.maskIp(ipAddress) : undefined,
                  ua: userAgent ? userAgent.slice(0, 80) : undefined,
              }
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

  /**
   * Confirm the presented refresh token matches the hash recorded when it was issued.
   * `tokenHash` is `select: false`, so it is fetched explicitly.
   */
  private async assertTokenHashMatches(tokenId: string, presentedToken: string): Promise<void> {
    const row = await this.refreshTokenRepository
      .createQueryBuilder('rt')
      .select('rt.tokenHash', 'tokenHash')
      .where('rt.id = :id', { id: tokenId })
      .getRawOne<{ tokenHash: string | null }>();

    // Rows issued before hashing existed have no hash; accept them rather than logging out
    // every user at deploy time. Every token issued from now on carries one.
    if (!row?.tokenHash) return;

    const presentedHash = crypto.createHash('sha256').update(presentedToken).digest('hex');
    const a = Buffer.from(presentedHash, 'hex');
    const b = Buffer.from(row.tokenHash, 'hex');

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.logger.warn(
        { event: 'refresh_hash_mismatch', jtiPrefix: tokenId.substring(0, 8) },
        '[SECURITY] Refresh token does not match its stored hash',
      );
      throw new UnauthorizedException(AuthError.REFRESH_TOKEN_INVALID);
    }
  }

  /**
   * Kill an entire refresh-token family: every row that shares the session id, plus the
   * denylist entry that stops already-issued access tokens.
   */
  private async invalidateSessionFamily(user: User, sessionId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { sessionId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );
    await this.sessionRegistry.revoke(sessionId);
    await this.userCacheService.clearUserSession(user.id);
  }

  /**
   * List a user's live sessions, one entry per device rather than one per rotation.
   *
   * Rows are grouped by `sessionId` (the family), because a long-lived session produces a new
   * refresh-token row on every rotation. Grouping keeps the list stable and makes `isCurrent`
   * meaningful — it is matched against the caller's session claim, which no longer changes when
   * the token rotates.
   */
  async getUserSessions(userId: string, currentSessionId?: string) {
    const rows = await this.refreshTokenRepository.find({
      where: { userId, isRevoked: false, expiresAt: MoreThan(new Date()) },
      order: { lastActiveAt: 'DESC', createdAt: 'DESC' },
    });

    const latestPerFamily = new Map<string, RefreshToken>();
    for (const row of rows) {
      const family = row.sessionId ?? row.id;
      const seen = latestPerFamily.get(family);
      const rowActivity = (row.lastActiveAt ?? row.createdAt).getTime();
      if (!seen || rowActivity > (seen.lastActiveAt ?? seen.createdAt).getTime()) {
        latestPerFamily.set(family, row);
      }
    }

    // H9: the stored ipAddress is already masked at write time; never expose a full IP.
    return [...latestPerFamily.entries()]
      .map(([family, session]) => ({
        id: family,
        ipAddress: session.ipAddress ?? null,
        browser: session.browser,
        os: session.os,
        deviceType: session.deviceType,
        lastActiveAt: session.lastActiveAt || session.createdAt,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: currentSessionId ? family === currentSessionId : false,
        country: session.country,
        city: session.city,
      }))
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  /**
   * Revoke one session (the "cerrar sesión en este dispositivo" action).
   *
   * C-2: revoking must reach the access token too. Flagging the refresh row alone left the
   * corresponding access token valid for up to its full lifetime, so the button appeared to work
   * while the device kept making authenticated calls. Adding the family to the denylist makes
   * the next request from that device fail.
   */
  async revokeSession(userId: string, sessionId: string) {
    const result = await this.refreshTokenRepository.update(
      { sessionId, userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );

    if (!result.affected) {
      // Either it does not exist, belongs to someone else, or is already revoked. The message is
      // deliberately identical in all three cases so it cannot be used to probe other users' ids.
      throw new NotFoundException('Sesión no encontrada o no pertenece al usuario.');
    }

    await this.sessionRegistry.revoke(sessionId);
    await this.userCacheService.clearUserSession(userId);

    return { message: 'Sesión revocada exitosamente.' };
  }

  /** Revoke every session except the caller's own — "cerrar las demás sesiones". */
  async terminateOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    const families = await this.refreshTokenRepository.find({
      where: { userId, isRevoked: false },
      select: ['id', 'sessionId'],
    });

    const toRevoke = [
      ...new Set(
        families
          .map((row) => row.sessionId ?? row.id)
          .filter((family) => family !== currentSessionId),
      ),
    ];

    if (!toRevoke.length) return;

    await this.refreshTokenRepository.update(
      { sessionId: In(toRevoke), isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );
    await this.sessionRegistry.revokeMany(toRevoke);
    await this.userCacheService.clearUserSession(userId);
  }

  /**
   * End the caller's own session (logout).
   *
   * C-2: the denylist entry is what actually stops the access token. Without it, logout only
   * cleared cookies — a token already captured by an attacker stayed valid until expiry.
   */
  async terminateCurrentSession(userId: string, sessionId?: string): Promise<void> {
    if (!sessionId) {
      // No session anchor (token predates the claim): fall back to a full logout rather than
      // silently ending nothing.
      await this.terminateAllSessions(userId);
      return;
    }

    await this.refreshTokenRepository.update(
      { sessionId, userId },
      { isRevoked: true, revokedAt: new Date() },
    );
    await this.sessionRegistry.revoke(sessionId);
    await this.userCacheService.clearUserSession(userId);
  }

  /**
   * Global logout: bump tokenVersion (invalidates every access token at once), revoke every
   * refresh row, and denylist each family so nothing survives on a stale cache read.
   */
  async terminateAllSessions(userId: string): Promise<void> {
    const rows = await this.refreshTokenRepository.find({
      where: { userId, isRevoked: false },
      select: ['id', 'sessionId'],
    });
    const families = [...new Set(rows.map((row) => row.sessionId ?? row.id))];

    await this.userSecurityRepository.increment({ userId }, 'tokenVersion', 1);
    await this.refreshTokenRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );
    await this.sessionRegistry.revokeMany(families);
    await this.userCacheService.clearUserSession(userId);
  }

  /**
   * Validate an access token outside the HTTP pipeline (WebSocket handshake).
   *
   * This previously verified with `JWT_SECRET` using the default HS256, but access tokens have
   * been RS256-signed with a rotating `kid` since the key-management change — so it rejected
   * every token it was given and always returned null. It now goes through the same key ring and
   * the same session/status checks as the HTTP path.
   */
  async verifyUserFromToken(token: string): Promise<User | null> {
    try {
      const header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
      ) as { kid?: string };

      const publicKey = this.keyManagementService.getPublicKey(header?.kid);
      if (!publicKey) return null;

      const payload = this.jwtService.verify<JwtPayload>(token, {
        publicKey,
        algorithms: ['RS256'],
        issuer: 'virteex-api',
        audience: 'virteex-web',
      });

      if (await this.sessionRegistry.isRevoked(payload.sessionId)) {
        return null;
      }

      const user = await this.usersService.findUserByIdForAuth(payload.id);

      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        (user.security?.tokenVersion || 0) !== (payload.tokenVersion ?? 0)
      ) {
        return null;
      }

      return user;
    } catch {
      return null;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleTokenCleanup() {
    // Every instance runs its own scheduler, so without coordination each replica would execute
    // the same batched DELETE sweep simultaneously — multiplying database load and contending on
    // the same rows. A PostgreSQL advisory lock is held for the duration of the job; whichever
    // instance acquires it does the work and the rest return immediately.
    // The lock is session-scoped and released explicitly (and implicitly if the process dies),
    // so a crash mid-sweep cannot wedge the job permanently.
    const LOCK_KEY = 4_812_552_001; // arbitrary but stable application-wide identifier
    const runner = this.refreshTokenRepository.manager.connection.createQueryRunner();
    await runner.connect();

    try {
      const [{ locked }] = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [LOCK_KEY],
      );

      if (!locked) {
        this.logger.debug('Token cleanup already running on another instance — skipping.');
        return;
      }

      try {
        await this.runTokenCleanup();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      }
    } catch (error) {
      this.logger.error(`Token cleanup failed: ${(error as Error).message}`);
    } finally {
      await runner.release();
    }
  }

  private async runTokenCleanup() {
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
        const ipv6 = addr as ipaddr.IPv6;

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

  // L-13 FIX: delegate to the centralized CryptoUtil so all encryption shares one key
  // derivation (ENCRYPTION_SECRET + AUTH_SALT). Removes the third, divergent derivation.
  private encryptIp(ip: string): string {
     return this.cryptoUtil.encrypt(ip);
  }
}
