import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject, SetMetadata, forwardRef } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SaasService } from '../saas.service';

export const FEATURE_FLAG_KEY = 'feature_flag';
export const CheckFeature = (featureKey: string) => SetMetadata(FEATURE_FLAG_KEY, featureKey);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(forwardRef(() => SaasService)) private saasService: SaasService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.get<string>(FEATURE_FLAG_KEY, context.getHandler());
    if (!featureKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.organization) {
       throw new ForbiddenException('Organization context required for feature check');
    }

    const isEnabled = await this.saasService.checkFeature(user.organization.id, featureKey);
    if (!isEnabled) {
        throw new ForbiddenException(`FEATURE_DISABLED: ${featureKey}`);
    }

    return true;
  }
}
