import { applyDecorators, UseGuards } from '@nestjs/common';
import { StepUp } from '../decorators/step-up.decorator';
import { StepUpScope } from '../enums/step-up-scope.enum';
import { StepUpGuard } from '../guards/step-up.guard';

export { StepUpScope };

/**
 * Require a fresh step-up proof of identity, for `scope`, before the handler runs.
 *
 * This is how a module outside Identity protects an action. The guard and the scope metadata are
 * applied together on purpose: `@StepUp(scope)` alone only records metadata and protects nothing,
 * so a route that carried it without `@UseGuards(StepUpGuard)` would look guarded and be open.
 * One decorator cannot be half-applied.
 */
export const RequireStepUp = (scope: StepUpScope) =>
  applyDecorators(UseGuards(StepUpGuard), StepUp(scope));
