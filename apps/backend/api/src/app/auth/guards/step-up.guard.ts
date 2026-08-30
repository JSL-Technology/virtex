import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import type { HttpRequest as Request } from '../../common/http/http.types';
import { STEP_UP_SCOPE_KEY } from '../decorators/step-up.decorator';
import { SINGLE_USE_SCOPES, StepUpScope } from '../enums/step-up-scope.enum';
import { AuthConfig } from '../auth.config';
import { STEP_UP_COOKIE_NAMES } from '../services/cookie.service';

interface StepUpPayload {
  sub: string;
  stepup: boolean;
  scope: StepUpScope;
  jti: string;
}

/**
 * Requires a recent proof of the caller's own identity for a specific action, not merely a live
 * session.
 *
 * This is the ONLY re-authentication mechanism in the product. It used to share the job with
 * `TwoFactorVerifiedGuard`, which read the raw password or a TOTP code from an
 * `x-reauth-password` / `x-otp-code` request header. No client ever sent those headers, so every
 * route that guard protected — the entire user-administration surface, change-password, disabling
 * 2FA, impersonation, session revocation — returned 403 to the real application. Its design was
 * also wrong on its own terms: `pino-http` serialises request headers in full, so a plaintext
 * password would have been written to the access log on every administrative action.
 *
 * The token is minted by `POST /auth/step-up` after verifying the strongest factor the account
 * holds (TOTP when 2FA is on, the password otherwise) and is delivered as an httpOnly cookie, so
 * the value never reaches JavaScript and an XSS cannot lift a credential capable of authorising
 * 2FA changes, impersonation, account deletion or session revocation.
 *
 * Reuse policy is declared by the scope, not by the route: irreversible or access-granting
 * actions burn the token on first use, routine administration may reuse it until it expires.
 * See `SINGLE_USE_SCOPES`.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  private readonly logger = new Logger(StepUpGuard.name);

  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScope = this.reflector.getAllAndOverride<StepUpScope>(
      STEP_UP_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScope) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const token = STEP_UP_COOKIE_NAMES.map((name) => request.cookies?.[name]).find(Boolean);

    if (!token) {
      throw new UnauthorizedException('Step-up authentication required');
    }

    let payload: StepUpPayload;
    try {
      payload = this.jwtService.verify<StepUpPayload>(token, {
        secret: AuthConfig.JWT_STEP_UP_SECRET,
        issuer: 'virteex-api',
        audience: 'virteex-step-up',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired step-up token');
    }

    if (!payload.stepup || payload.scope !== requiredScope) {
      throw new UnauthorizedException('Invalid step-up token scope');
    }

    // Ownership is checked BEFORE the token is consumed. The previous order burned the jti
    // first, so a token presented against the wrong session was still spent — letting an
    // attacker invalidate a victim's in-flight step-up token at will.
    if (!request.user?.id || payload.sub !== request.user.id) {
      this.logger.warn(
        { event: 'step_up_subject_mismatch', userId: request.user?.id },
        '[SECURITY] Step-up token does not belong to the authenticated user',
      );
      throw new UnauthorizedException('Step-up token mismatch');
    }

    if (SINGLE_USE_SCOPES.has(payload.scope)) {
      await this.consumeSingleUse(payload.jti);
    }

    return true;
  }

  /**
   * Enforce single use by claiming the jti ATOMICALLY.
   *
   * A get-then-set leaves a window in which two concurrent requests both read "unused" and both
   * proceed — and for the scopes that are single-use, that window is the whole protection:
   * impersonation, account deletion, session revocation. The previous implementation documented
   * the race and accepted it "because cache-manager has no atomic set-if-absent". Redis does:
   * `SET key value NX PX ttl` returns nil when the key already exists, so the claim and the check
   * are one round trip and exactly one caller can win.
   *
   * The in-memory store used in development and tests has no NX either, so the get-then-set path
   * remains as a fallback — correct there, because that store is single-process by construction.
   */
  private async consumeSingleUse(jti: string): Promise<void> {
    if (!jti) {
      throw new UnauthorizedException('Malformed step-up token');
    }

    const key = `stepup_jti:${jti}`;
    const ttl = AuthConfig.STEP_UP_TOKEN_TTL;

    const redis = this.redisClient();
    if (redis) {
      // NX: set only if absent. A nil reply means somebody already spent this token.
      const claimed = await redis.set(key, '1', 'PX', ttl, 'NX');
      if (claimed !== 'OK') {
        throw new UnauthorizedException('Step-up token already used');
      }
      return;
    }

    if (await this.cacheManager.get(key)) {
      throw new UnauthorizedException('Step-up token already used');
    }
    await this.cacheManager.set(key, 1, ttl);
  }

  /**
   * The underlying Redis client, when the cache is backed by one.
   *
   * Reached through the store rather than injected so this guard keeps working unchanged with the
   * in-memory store, and so no module has to gain a Redis dependency it otherwise would not have.
   */
  private redisClient(): {
    set(key: string, value: string, mode: 'PX', ttl: number, nx: 'NX'): Promise<string | null>;
  } | null {
    const store = (this.cacheManager as unknown as { store?: Record<string, unknown> }).store;
    const client = (store?.['client'] ?? store?.['redis'] ?? store?.['getClient']) as
      | { set?: unknown }
      | undefined;
    const resolved = typeof client === 'function' ? (client as () => unknown)() : client;
    return resolved && typeof (resolved as { set?: unknown }).set === 'function'
      ? (resolved as never)
      : null;
  }
}
