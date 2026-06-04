
import { SetMetadata } from '@nestjs/common';

export const StepUpScope = (scope: string) => SetMetadata('stepUpScope', scope);
