
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { STEP_UP_SCOPE_KEY } from '../decorators/step-up.decorator';
import { StepUpScope } from '../enums/step-up-scope.enum';
import { AuthConfig } from '../auth.config';

@Injectable()
export class StepUpGuard implements CanActivate {
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

    const request = context.switchToHttp().getRequest();
    const stepUpToken = request.headers['x-step-up-token'];

    if (!stepUpToken) {
      throw new UnauthorizedException('Step-up authentication required');
    }

    try {
      const payload = this.jwtService.verify(stepUpToken, {
        secret: AuthConfig.JWT_STEP_UP_SECRET,
      });

      if (!payload.stepup || payload.scope !== requiredScope) {
        throw new UnauthorizedException('Invalid step-up token scope');
      }

      const jti = payload.jti;
      const blacklistKey = `stepup_jti:${jti}`;
      const isBlacklisted = await this.cacheManager.get(blacklistKey);

      if (isBlacklisted) {
        throw new UnauthorizedException('Step-up token already used');
      }

      // Single-use: blacklist the jti for the remainder of its life (max 10m)
      await this.cacheManager.set(blacklistKey, true, 10 * 60 * 1000);

      // Verify that the token belongs to the currently authenticated user
      if (request.user && payload.sub !== request.user.id) {
          throw new UnauthorizedException('Step-up token mismatch');
      }

      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) {
          throw e;
      }
      throw new UnauthorizedException('Invalid or expired step-up token');
    }
  }
}
