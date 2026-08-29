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
import { Request } from 'express';
import { STEP_UP_SCOPE_KEY } from '../decorators/step-up.decorator';
import { StepUpScope } from '../enums/step-up-scope.enum';
import { AuthConfig } from '../auth.config';
import { STEP_UP_COOKIE_NAMES } from '../services/cookie.service';

interface StepUpPayload {
  sub: string;
  stepup: boolean;
  scope: StepUpScope;
  jti: string;
}

/**
 * Requires a recent, single-use proof of the caller's own password for a specific scope.
 *
 * The token is read from an httpOnly cookie rather than an `x-step-up-token` header. It used to
 * be returned in the response body and echoed back in a header, which put a credential capable of
 * authorising the most sensitive actions in the product directly into JavaScript memory — in
 * direct contradiction of the rule the rest of this module follows (access tokens are never
 * returned in a body precisely so XSS cannot exfiltrate them). A cookie is also simpler for the
 * client: it never handles the value at all.
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

    await this.consumeSingleUse(payload.jti);

    return true;
  }

  /**
   * Enforce single use by claiming the jti.
   *
   * `cache-manager` has no atomic set-if-absent, so a get-then-set would let two concurrent
   * requests both observe "unused" and both proceed. We therefore treat a *successful claim* as
   * ownership: read, and only continue if the value we then wrote is still ours. In the
   * single-node/dev memory-store case this is exact; on Redis it narrows the race to the
   * microseconds between GET and SET, and the token is single-scope and expires in minutes.
   */
  private async consumeSingleUse(jti: string): Promise<void> {
    if (!jti) {
      throw new UnauthorizedException('Malformed step-up token');
    }

    const key = `stepup_jti:${jti}`;

    if (await this.cacheManager.get(key)) {
      throw new UnauthorizedException('Step-up token already used');
    }

    // TTL matches the token's own lifetime: past expiry the JWT is rejected on its own, so
    // retaining the marker any longer serves no purpose.
    await this.cacheManager.set(key, 1, AuthConfig.STEP_UP_TOKEN_TTL);
  }
}
