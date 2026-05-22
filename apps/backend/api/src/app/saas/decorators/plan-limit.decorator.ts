import { SetMetadata } from '@nestjs/common';
import { SaasResource } from '../enums/saas-resource.enum';

export const PLAN_LIMIT_KEY = 'plan_limit';
export const CheckPlanLimit = (resource: SaasResource, increment: number = 1) =>
  SetMetadata(PLAN_LIMIT_KEY, { resource, increment });
