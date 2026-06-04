
import { SetMetadata } from '@nestjs/common';
import { StepUpScope } from '../enums/step-up-scope.enum';

export const STEP_UP_SCOPE_KEY = 'step_up_scope';
export const StepUp = (scope: StepUpScope) => SetMetadata(STEP_UP_SCOPE_KEY, scope);
