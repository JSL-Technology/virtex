
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TokenService } from '../services/token.service';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly auditService: AuditTrailService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScope = this.reflector.get<string>(
      'stepUpScope',
      context.getHandler(),
    );

    if (!requiredScope) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-step-up-token'];

    if (!token) {
      throw new UnauthorizedException('Step-up authentication required');
    }

    const { sub, jti } = await this.tokenService.verifyStepUpToken(
      token,
      requiredScope,
    );

    // Verify user matches the authenticated session
    if (request.user && request.user.id !== sub) {
        throw new UnauthorizedException('Step-up token does not match current user');
    }

    // Check blacklist for single-use (jti)
    const blacklisted = await this.cacheManager.get(`stepup_jti:${jti}`);
    if (blacklisted) {
      throw new UnauthorizedException('Step-up token has already been used');
    }

    // Mark as used immediately (single-use)
    await this.cacheManager.set(`stepup_jti:${jti}`, true, 10 * 60 * 1000);

    // Audit Logging
    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    await this.auditService.record(
        sub,
        'STEP_UP',
        jti,
        ActionType.UPDATE,
        { scope: requiredScope, status: 'success', userAgent },
        undefined,
        ip,
        request.user?.organizationId
    );

    return true;
  }
}
