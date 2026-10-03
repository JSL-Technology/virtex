import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class DecisionParamsDto {
  @IsString()
  @Matches(/^[a-z][a-z_]{1,48}$/)
  source: string;

  @IsString()
  @Matches(/^[0-9a-f-]{36}$/i)
  id: string;
}

export class ApproveDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  comment?: string;
}

export class RejectDecisionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
