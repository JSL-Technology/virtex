
import { Injectable, UnauthorizedException, Inject, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import CircuitBreaker = require('opossum');
import { KeyManagementService } from '../../services/key-management.service';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../../organizations/entities/organization.entity';

import { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { User, UserStatus } from '../../../users/entities/user.entity/user.entity';
import { AuthConfig } from '../../auth.config';
import { UsersService } from '../../../users/users.service';
import { AuthenticatedUser } from '../../interfaces/authenticated-user.interface';
import { AuthError } from '../../enums/auth-error.enum';
import { CachedUser } from '../../interfaces/cached-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private circuitBreaker: CircuitBreaker;

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    private readonly keyManagementService: KeyManagementService,
  ) {
    super({
      // H1 FIX: Cookie-only extraction. The previous ExtractJwt.fromAuthHeaderAsBearerToken()
      // was removed: access tokens are delivered exclusively via httpOnly cookies and never
      // returned in the response body, so accepting `Authorization: Bearer` only widened the
      // attack surface (any accidental leak of the JWT to JS/logs/3rd parties would be directly
      // replayable as a header). Machine-to-machine APIs must use a dedicated strategy with their
      // own scopes/audience/rotation. (OWASP Session Management & JWT Cheat Sheets; CWE-922/CWE-200.)
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request | undefined) => {
          const cookies = req?.cookies ?? {};
          const isProduction = configService.get('NODE_ENV') === 'production';
          return cookies['__Host-access_token'] ??
            (isProduction ? null : cookies['access_token']) ??
            null;
        },
      ]),
      ignoreExpiration: false,
      // H-05 FIX: Use secretOrKeyProvider to support RS256 with key ID (kid) rotation.
      // The provider resolves the public key from the token header's kid claim, enabling
      // key ring rotation without invalidating all active sessions (NIST SP 800-57; RFC 7515).
      secretOrKeyProvider: async (_req: Request, rawJwt: string, done: (err: Error | null, key?: unknown) => void) => {
        try {
          const parts = rawJwt.split('.');
          if (parts.length < 2) return done(new UnauthorizedException('Malformed JWT'), undefined);
          const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
          const publicKey = keyManagementService.getPublicKey(header.kid);
          if (!publicKey) return done(new UnauthorizedException('Unknown key ID'), undefined);
          done(null, publicKey);
        } catch {
          done(new UnauthorizedException('JWT key resolution failed'), undefined);
        }
      },
      algorithms: ['RS256'],
      issuer: 'virteex-api',
      audience: 'virteex-web',
    });

    // Initialize Opossum Circuit Breaker
    this.circuitBreaker = new CircuitBreaker(
      (key: string) => this.cacheManager.get<CachedUser>(key),
      {
        timeout: 3000, // 3 seconds timeout for Redis
        errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
        resetTimeout: AuthConfig.CACHE_RETRY_DELAY || 30000, // Retry after 30s
      }
    );

    this.circuitBreaker.fallback(() => Promise.resolve(null)); // Fallback returns null (proceed to DB)

    this.circuitBreaker.on('open', () => this.logger.warn('Redis Circuit Breaker OPEN: Using Database Fallback'));
    this.circuitBreaker.on('halfOpen', () => this.logger.log('Redis Circuit Breaker HALF-OPEN: Testing connection'));
    this.circuitBreaker.on('close', () => this.logger.log('Redis Circuit Breaker CLOSED: Cache restored'));
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const { id, tokenVersion, organizationId } = payload;
    const cacheKey = `user_session:${id}`;

    // 1. Try to get user from cache (Circuit Breaker Protected)
    let user: CachedUser | null = null;
    try {
        // Fire the circuit breaker
        // Note: The circuit breaker wraps the cacheManager.get call
        user = await this.circuitBreaker.fire(cacheKey) as CachedUser | null;
    } catch (e) {
        this.logger.error(`Circuit Breaker Execution Error: ${(e as Error).message}`);
        // Fallback is handled by configuration, but if fire throws, we ensure user is null
        user = null;
    }

    // Check if cached user is stale (token version mismatch)
    if (user) {
      const cachedTokenVersion = user.security?.tokenVersion || 0;
      if (cachedTokenVersion !== tokenVersion) {
        this.logger.debug(`Cached user stale (Version ${cachedTokenVersion} vs Token ${tokenVersion}). Invalidating cache locally.`);
        user = null; // Force DB lookup
      }
    }

    if (!user) {
        // 2. Fallback to DB
        const dbUser = await this.usersService.findUserByIdForAuth(id);

        if (dbUser) {
             // 3. Store in cache (TTL 15 mins or matching token expiration)
             // We only attempt to set cache if the circuit breaker is closed or half-open (i.e. we think it might work)
             // Opossum doesn't expose "can I write" easily for a different operation (set vs get),
             // but generally if GET is failing, SET likely will too.
             // We can check `this.circuitBreaker.opened`.
             if (!this.circuitBreaker.opened) {
                 try {
                    // Pre-calculate permissions and attach to user object in cache to avoid re-calc
                    user = {
                      ...dbUser,
                      _cachedPermissions: this.getPermissionsFromRoles(dbUser.roles ?? [])
                    } as CachedUser;

                    await this.cacheManager.set(cacheKey, user, AuthConfig.CACHE_TTL);
                 } catch (e) {
                    this.logger.warn(`Failed to set user cache during JWT validation: ${(e as Error).message}`);
                    user = dbUser as CachedUser;
                 }
             } else {
                 user = dbUser as CachedUser;
             }
        }
    }

    if (!user) {
      throw new UnauthorizedException(AuthError.USER_NOT_FOUND);
    }

    // Handle security entity access safely
    const currentTokenVersion = user.security?.tokenVersion || 0;

    if (currentTokenVersion !== tokenVersion) {
      throw new UnauthorizedException(AuthError.SESSION_EXPIRED);
    }

    if (this.isDisallowedStatus(user.status)) {
      throw new UnauthorizedException(AuthError.USER_BLOCKED);
    }

    const permissions = user._cachedPermissions || this.getPermissionsFromRoles(user.roles ?? []);

    // 10/10 SECURITY: Organization Context Validation
    // Enforce strict multi-tenancy context. User MUST belong to an organization.
    // In a future Multi-Tenancy (ManyToMany) setup, we would validate payload.orgId against user.organizations.
    // For now (1:1), the existence of user.organization is mandatory.
    if (!user.organization) {
         this.logger.error(`User ${user.id} authenticated but has no linked Organization. Access Denied.`);
         throw new UnauthorizedException(AuthError.USER_NOT_FOUND); // Or a specific error code like ORG_NOT_FOUND
    }

    // Strict validation: The token's organization context must match one of the user's organizations
    // If organizationId is present in the token (context-aware token), we verify access.
    if (organizationId) {
        // First check active context
        const isCurrentOrg = user.organization?.id === organizationId;

        // Then check full list if not current
        const hasAccess = isCurrentOrg || (user.organizations && user.organizations.some(o => o.id === organizationId));

        if (!hasAccess) {
            this.logger.warn(`User ${user.id} attempted to access with token for Organization ${organizationId} but has no access to it.`);
            throw new UnauthorizedException(AuthError.INVALID_CREDENTIALS);
        }

        // If organization context switched, we might want to update the returned user object's active organization
        // to match the token context, so controllers don't need to look it up again.
        // However, we must ensure strict type safety.
        if (!isCurrentOrg && hasAccess) {
            const switchedOrg = await this.orgRepository.findOneBy({ id: organizationId });
            if (switchedOrg) {
                user.organization = switchedOrg;
            }
        }
    }

    // Return SafeUser / AuthenticatedUser
    // We construct it explicitly to avoid 'as any' and ensure type safety
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationId: user.organizationId,
      roles: user.roles,
      permissions,
      organization: user.organization,
      isTwoFactorEnabled: user.security?.isTwoFactorEnabled || false,
      isImpersonating: payload.isImpersonating,
      originalUserId: payload.originalUserId,
      sessionId: payload.sessionId,
    };

    return authenticatedUser;
  }

  private isDisallowedStatus(status: UserStatus | undefined): boolean {
    return (
      status === UserStatus.BLOCKED ||
      status === UserStatus.INACTIVE ||
      status === UserStatus.ARCHIVED
    );
  }

  private getPermissionsFromRoles(roles: Array<{ permissions?: string[] }>): string[] {
    const perms = roles.flatMap((r) => r.permissions ?? []);
    return [...new Set(perms)];
  }
}
