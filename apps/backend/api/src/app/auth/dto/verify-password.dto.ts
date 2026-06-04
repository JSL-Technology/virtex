
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { StepUpScope } from '../enums/step-up-scope.enum';

export class VerifyPasswordDto {
  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsEnum(StepUpScope)
  @IsNotEmpty()
  scope!: StepUpScope;
}
