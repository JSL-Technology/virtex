import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { HttpRequest as Request } from '../../common/http/http.types';
import { STEP_UP_SCOPE_KEY } from '../decorators/step-up.decorator';
import { SINGLE_USE_SCOPES, StepUpScope } from '../enums/step-up-scope.enum';
import { AuthConfig } from '../auth.config';
import { STEP_UP_COOKIE_NAMES } from '../services/cookie.service';
import { AtomicCacheService } from '../../cache/atomic-cache.service';
import { UnauthorizedError } from '../../i18n/localized.exception';

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
    private readonly atomicCache: AtomicCacheService,
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
      throw new UnauthorizedError('AUTH.STEP_UP_AUTHENTICATION_REQUIRED');
    }

    let payload: StepUpPayload;
    try {
      payload = this.jwtService.verify<StepUpPayload>(token, {
        secret: AuthConfig.JWT_STEP_UP_SECRET,
        issuer: 'virteex-api',
        audience: 'virteex-step-up',
      });
    } catch {
      throw new UnauthorizedError('AUTH.INVALID_OR_EXPIRED_STEP_UP_TOKEN');
    }

    if (!payload.stepup || payload.scope !== requiredScope) {
      throw new UnauthorizedError('AUTH.INVALID_STEP_UP_TOKEN_SCOPE');
    }

    // Ownership is checked BEFORE the token is consumed. The previous order burned the jti
    // first, so a token presented against the wrong session was still spent — letting an
    // attacker invalidate a victim's in-flight step-up token at will.
    if (!request.user?.id || payload.sub !== request.user.id) {
      this.logger.warn(
        { event: 'step_up_subject_mismatch', userId: request.user?.id },
        '[SECURITY] Step-up token does not belong to the authenticated user',
      );
      throw new UnauthorizedError('AUTH.STEP_UP_TOKEN_MISMATCH');
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
   * impersonation, account deletion, session revocation.
   *
   * The atomic claim lives in `AtomicCacheService`. It used to live here, reaching into
   * `cacheManager.store` for a Redis client — a property cache-manager 7 does not have, so the
   * lookup always returned null and the guard always took the non-atomic in-memory branch. The
   * shared service finds the client through Keyv's documented accessor and refuses to boot a
   * deployment that has none, so the fallback can no longer be reached without anyone noticing.
   */
  private async consumeSingleUse(jti: string): Promise<void> {
    if (!jti) {
      throw new UnauthorizedError('AUTH.MALFORMED_STEP_UP_TOKEN');
    }

    const claimed = await this.atomicCache.claimOnce(
      `stepup_jti:${jti}`,
      AuthConfig.STEP_UP_TOKEN_TTL,
    );

    if (!claimed) {
      throw new UnauthorizedError('AUTH.STEP_UP_TOKEN_ALREADY_USED');
    }
  }
}
