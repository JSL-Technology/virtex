import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject, SetMetadata, UseGuards, applyDecorators, forwardRef } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SaasService } from '../saas.service';
import type { SaasFeatureKey } from '../saas.config';

export const FEATURE_FLAG_KEY = 'feature_flag';

/**
 * Gate a route on a plan capability.
 *
 * The decorator applies the guard itself. As bare `SetMetadata` it only worked if the route also
 * remembered to list `FeatureFlagGuard` in its own `@UseGuards`, and no route ever did — so
 * together with an unseeded `saas_plan_features` table the entire capability mechanism was
 * unreachable. This is the same shape `@HasPermission` already uses, for the same reason.
 *
 * The key is typed, so a flag that no plan declares is a compile error rather than a route that
 * silently refuses everybody.
 */
export const CheckFeature = (featureKey: SaasFeatureKey) =>
  applyDecorators(SetMetadata(FEATURE_FLAG_KEY, featureKey), UseGuards(FeatureFlagGuard));

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(forwardRef(() => SaasService)) private saasService: SaasService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!featureKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.organizationId) {
       throw new ForbiddenException('Organization context required for feature check');
    }

    const isEnabled = await this.saasService.checkFeature(user.organizationId, featureKey);
    if (!isEnabled) {
        throw new ForbiddenException(`FEATURE_DISABLED: ${featureKey}`);
    }

    return true;
  }
}
