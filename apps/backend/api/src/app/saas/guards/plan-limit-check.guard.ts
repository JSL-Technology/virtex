import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SaasService } from '../saas.service';
import { PLAN_LIMIT_KEY } from '../decorators/plan-limit.decorator';
import { SaasResource } from '../enums/saas-resource.enum';
import { SaasLimitReachedException } from '../exceptions/saas-exception';
import { ForbiddenError } from '../../i18n/localized.exception';

/**
 * A fail-fast check of a plan limit, before the handler runs. It consumes nothing.
 *
 * `SaasService.enforceLimit()`, inside the business transaction, is what decides and what counts;
 * this only spares an obviously over-limit request the work of getting that far. It asks
 * `checkLimit`, which owns the caching: a monthly answer is cached under the key `enforceLimit`
 * clears, a lifetime one is counted fresh. The guard used to keep the same cache by hand, with its
 * own TTL setting, as a second implementation of the same decision.
 */
@Injectable()
export class PlanLimitCheckGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly saasService: SaasService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitMetadata = this.reflector.get<{ resource: SaasResource; increment: number }>(
      PLAN_LIMIT_KEY,
      context.getHandler(),
    );

    if (!limitMetadata) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: { organizationId?: string; organization?: { id?: string } } }>().user;
    if (!user) {
       throw new ForbiddenError('saas.organization_context_required_for_limit_check');
    }

    const organizationId = user.organization?.id ?? user.organizationId;
    if (!organizationId) {
      throw new ForbiddenError('saas.organization_context_required_for_limit_check');
    }

    if (!(await this.saasService.checkLimit(organizationId, limitMetadata.resource, limitMetadata.increment))) {
      throw new SaasLimitReachedException(limitMetadata.resource);
    }
    return true;
  }
}
