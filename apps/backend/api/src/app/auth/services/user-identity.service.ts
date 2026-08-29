import { Injectable, Logger, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import CircuitBreaker = require('opossum');

import { Organization } from '../../organizations/entities/organization.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { UsersService } from '../../users/users.service';
import { AuthConfig } from '../auth.config';
import { AuthError } from '../enums/auth-error.enum';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { CachedUser } from '../interfaces/cached-user.interface';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { SessionRegistryService } from './session-registry.service';

/**
 * The single place where a JWT payload becomes an authenticated principal.
 *
 * ## Why this exists (A-3)
 *
 * Identity resolution used to be implemented twice — in `JwtStrategy.validate` and in
 * `TokenService.validateTokenAndGetUser` — and the two copies had drifted:
 *
 *   | | JwtStrategy | TokenService |
 *   |---|---|---|
 *   | accepted statuses | everything except BLOCKED/INACTIVE/ARCHIVED (**PENDING passed**) | ACTIVE only |
 *   | organization check | yes | no |
 *   | cached object shape | User + `_cachedPermissions` | User without it |
 *
 * The status divergence was a real hole: a PENDING user — invited but who has never set a
 * password — satisfied the global `JwtAuthGuard`. The differing cached shapes meant the
 * permissions attached to a cache entry depended on which code path happened to populate it.
 *
 * One implementation, one status policy, one cache key, one cached shape.
 */
@Injectable()
export class UserIdentityService {
  private readonly logger = new Logger(UserIdentityService.name);
  private readonly cacheBreaker: CircuitBreaker;

  /**
   * Statuses allowed to hold an authenticated session.
   *
   * Deliberately an allow-list. The previous deny-list (`BLOCKED | INACTIVE | ARCHIVED`) let any
   * status added later — PENDING among them — authenticate by default. An allow-list fails
   * closed when the enum grows.
   */
  private static readonly AUTHENTICABLE_STATUSES: ReadonlySet<UserStatus> = new Set([
    UserStatus.ACTIVE,
  ]);

  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly sessionRegistry: SessionRegistryService,
  ) {
    // Redis sits on the hot path of every authenticated request. If it degrades, we must fall
    // through to the database rather than pile up timeouts.
    this.cacheBreaker = new CircuitBreaker(
      (key: string) => this.cacheManager.get<CachedUser>(key),
      {
        timeout: 3000,
        errorThresholdPercentage: 50,
        resetTimeout: AuthConfig.CACHE_RETRY_DELAY,
      },
    );
    this.cacheBreaker.fallback(() => null);
    this.cacheBreaker.on('open', () => this.logger.warn('User cache circuit OPEN — serving from database'));
    this.cacheBreaker.on('halfOpen', () => this.logger.log('User cache circuit HALF-OPEN'));
    this.cacheBreaker.on('close', () => this.logger.log('User cache circuit CLOSED'));
  }

  /** Cache key. Must stay identical to UserCacheService's, which performs the invalidation. */
  private cacheKey(userId: string): string {
    return `user_session:${userId}`;
  }

  /**
   * Validate a JWT payload and build the request principal.
   * Throws UnauthorizedException for every rejection path.
   */
  async resolveFromPayload(payload: JwtPayload): Promise<AuthenticatedUser> {
    const { id, tokenVersion, organizationId, sessionId } = payload;

    // C-2: an access token is only as good as the session behind it. Checked before anything
    // expensive so a revoked token costs one cache lookup.
    if (await this.sessionRegistry.isRevoked(sessionId)) {
      this.logger.debug({ event: 'session_revoked', userId: id }, 'Rejected token from revoked session');
      throw new UnauthorizedException(AuthError.SESSION_EXPIRED);
    }

    const user = await this.loadUser(id, tokenVersion);

    if (!user) {
      throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
    }

    // Re-checked against the freshly loaded record: the cached copy may have been stale.
    if ((user.tokenVersion ?? 0) !== (tokenVersion ?? 0)) {
      throw new UnauthorizedException(AuthError.SESSION_EXPIRED);
    }

    this.assertAuthenticable(user);

    const organization = await this.resolveOrganizationContext(user, organizationId);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationId: user.organizationId as string,
      roles: user.roleNames.map((name) => ({ name })) as never,
      permissions: user.permissions,
      organization,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      isImpersonating: payload.isImpersonating,
      originalUserId: payload.originalUserId,
      sessionId,
    };
  }

  /**
   * Re-read a principal from the source of truth, bypassing nothing but keeping the same
   * validation policy. Backs `GET /auth/status`.
   */
  async resolveFresh(current: AuthenticatedUser): Promise<AuthenticatedUser> {
    const user = await this.loadUser(current.id);
    if (!user) {
      throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
    }
    this.assertAuthenticable(user);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationId: user.organizationId as string,
      roles: user.roleNames.map((name) => ({ name })) as never,
      permissions: user.permissions,
      organization: await this.resolveOrganizationContext(user, current.organization?.id),
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      isImpersonating: current.isImpersonating ?? false,
      originalUserId: current.originalUserId,
      sessionId: current.sessionId,
    };
  }

  /**
   * Cache-through load. `expectedTokenVersion`, when supplied, discards a cache entry whose
   * version no longer matches so a privilege change takes effect on the next request rather
   * than at cache expiry.
   */
  private async loadUser(userId: string, expectedTokenVersion?: number): Promise<CachedUser | null> {
    const key = this.cacheKey(userId);

    let cached: CachedUser | null = null;
    try {
      cached = (await this.cacheBreaker.fire(key)) as CachedUser | null;
    } catch (error) {
      this.logger.error(`User cache read failed: ${(error as Error).message}`);
      cached = null;
    }

    if (cached && expectedTokenVersion !== undefined) {
      if ((cached.tokenVersion ?? 0) !== expectedTokenVersion) {
        cached = null; // stale — fall through to the database
      }
    }

    if (cached) return cached;

    const dbUser = await this.usersService.findUserByIdForAuth(userId);
    if (!dbUser) return null;

    const toCache = UserIdentityService.project(dbUser);

    if (!this.cacheBreaker.opened) {
      try {
        await this.cacheManager.set(key, toCache, AuthConfig.CACHE_TTL);
      } catch (error) {
        this.logger.warn(`User cache write failed: ${(error as Error).message}`);
      }
    }

    return toCache;
  }

  /**
   * Reduce a loaded user to what the request pipeline reads.
   *
   * The cache used to hold the entity itself, `security` relation included, which put password
   * hashes, TOTP secrets and backup codes into Redis for the lifetime of every session. Nothing
   * on the authenticated path needs them: authorisation needs permissions, tenancy needs the
   * organization, and session validity needs `tokenVersion`. The paths that DO need a secret
   * (login, step-up, 2FA) read the database, which is correct for them anyway — they must never
   * see a stale value.
   */
  private static project(user: User): CachedUser {
    const permissions = [...new Set((user.roles ?? []).flatMap((role) => role.permissions ?? []))];

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      organizationId: user.organizationId,
      permissions,
      roleNames: (user.roles ?? []).map((role) => role.name),
      tokenVersion: user.security?.tokenVersion ?? 0,
      isTwoFactorEnabled: user.security?.isTwoFactorEnabled ?? false,
      organization: user.organization,
      organizations: user.organizations,
    };
  }

  private assertAuthenticable(user: Pick<CachedUser, 'status'>): void {
    if (!UserIdentityService.AUTHENTICABLE_STATUSES.has(user.status)) {
      if (user.status === UserStatus.BLOCKED) {
        throw new UnauthorizedException(AuthError.USER_BLOCKED);
      }
      throw new UnauthorizedException(AuthError.USER_INACTIVE);
    }
  }

  /**
   * Enforce tenant context. A user must belong to an organization, and a token carrying an
   * explicit organizationId is only honoured if the user actually has access to that tenant.
   */
  private async resolveOrganizationContext(
    user: CachedUser,
    requestedOrganizationId?: string,
  ): Promise<Organization | undefined> {
    if (!user.organization) {
      this.logger.error(
        { event: 'user_without_organization', userId: user.id },
        'Authenticated user has no linked organization',
      );
      throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
    }

    if (!requestedOrganizationId || requestedOrganizationId === user.organization.id) {
      return user.organization;
    }

    const hasAccess = (user.organizations ?? []).some((org) => org.id === requestedOrganizationId);
    if (!hasAccess) {
      this.logger.warn(
        { event: 'tenant_context_denied', userId: user.id, requested: requestedOrganizationId },
        'Token carries an organization the user cannot access',
      );
      throw new UnauthorizedException(AuthError.INVALID_CREDENTIALS);
    }

    const switched = await this.orgRepository.findOneBy({ id: requestedOrganizationId });
    return switched ?? user.organization;
  }
}
