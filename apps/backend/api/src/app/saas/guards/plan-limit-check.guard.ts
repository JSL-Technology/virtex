import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { SaasService } from '../saas.service';
import { PLAN_LIMIT_KEY } from '../decorators/plan-limit.decorator';
import { SaasResource } from '../enums/saas-resource.enum';
import { SaasLimitReachedException } from '../exceptions/saas-exception';
import { SaasCacheKeyFactory } from '../utils/saas-cache-key.factory';

/**
 * PlanLimitCheckGuard
 *
 * This guard performs a "Fail-Fast" check for plan limits to improve UX.
 * It DOES NOT increment the usage counter.
 *
 * WARNING: Developers must call `SaasService.enforceLimit()` within the business logic (Service layer)
 * to atomically increment usage and ensure data integrity.
 * This guard is strictly for preventing obvious over-limit requests from reaching the controller logic.
 */
@Injectable()
export class PlanLimitCheckGuard implements CanActivate {
  private readonly logger = new Logger(PlanLimitCheckGuard.name);
  private readonly cacheTtl: number;

  constructor(
    private reflector: Reflector,
    private saasService: SaasService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {
      // Configure TTL from config or default to 60s
      this.cacheTtl = this.configService.get<number>('SAAS_LIMIT_CACHE_TTL', 60000);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitMetadata = this.reflector.get<{ resource: SaasResource; increment: number }>(
      PLAN_LIMIT_KEY,
      context.getHandler(),
    );

    if (!limitMetadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
       throw new ForbiddenException('Organization context required for limit check');
    }

    const organizationId = user.organization?.id ?? user.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context required for limit check');
    }

    // Use Factory for consistent keys
    // Note: We might need to get the "version" for strict invalidation, but for Fail-Fast
    // checking the simple key might be enough?
    // Actually SaasService uses versioning. We should probably read the version here too to ensure we don't read stale cache after a plan upgrade.

    const versionKey = SaasCacheKeyFactory.limitVersion(organizationId);
    const version = await this.cacheManager.get<number>(versionKey) || 0;
    const cacheKey = SaasCacheKeyFactory.limitCheck(organizationId, version, limitMetadata.resource);

    // 1. Try Cache first (Fail-Fast)
    const cachedResult = await this.cacheManager.get<boolean>(cacheKey);
    if (cachedResult !== undefined) {
      if (!cachedResult) {
        throw new SaasLimitReachedException(limitMetadata.resource);
      }
      return true;
    }

    // 2. Check Limit (Read-Only)
    const canProceed = await this.saasService.checkLimit(
      organizationId,
      limitMetadata.resource,
      limitMetadata.increment
    );

    // 3. Cache the result
    // If blocked, cache for a longer period (e.g. 5 mins) to reduce DB load
    // If allowed, cache for shorter period (e.g. 60s) defined in config
    const ttl = canProceed ? this.cacheTtl : 5 * 60 * 1000;
    await this.cacheManager.set(cacheKey, canProceed, ttl);

    if (!canProceed) {
      throw new SaasLimitReachedException(limitMetadata.resource);
    }

    return true;
  }
}
