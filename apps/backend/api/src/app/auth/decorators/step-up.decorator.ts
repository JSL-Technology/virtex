import { SetMetadata, applyDecorators } from '@nestjs/common';
import { StepUpScope } from '../enums/step-up-scope.enum';

export const STEP_UP_SCOPE_KEY = 'step_up_scope';
export const STEP_UP_CONDITION_KEY = 'step_up_condition';

/**
 * When a step-up is required only for SOME requests to a route.
 *
 * Receives the raw request (guards run before pipes, so the body is the JSON as sent) and answers
 * whether this particular request is the sensitive kind. Editing an employee's name is routine;
 * changing the bank account their wages are paid into is not, and it arrives through the same
 * PATCH. Declaring the condition next to the route keeps "which requests are sensitive" in the one
 * place a reviewer reads, rather than inside a service where a new caller would never see it.
 */
export type StepUpCondition = (request: { body?: unknown; method?: string }) => boolean;

export const StepUp = (scope: StepUpScope, options: { when?: StepUpCondition } = {}) =>
  options.when
    ? applyDecorators(
        SetMetadata(STEP_UP_SCOPE_KEY, scope),
        SetMetadata(STEP_UP_CONDITION_KEY, options.when),
      )
    : SetMetadata(STEP_UP_SCOPE_KEY, scope);
