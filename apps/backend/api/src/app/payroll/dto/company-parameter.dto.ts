import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class WithholdingBracketDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  over: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  upTo?: number | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  rate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  baseAmount: number;
}

/**
 * A company payroll parameter as of a date: a new parameter, a new figure for an existing one, or a
 * correction of the figure recorded for that same date.
 *
 * Rates are fractions (0.062 is 6.2 %), amounts are annual.
 */
export class RecordCompanyParameterDto {
  @IsString()
  @MinLength(2, { message: 'validation.constraints.min_length|{"min":2}' })
  @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  @Matches(/^[A-Za-z0-9_]+$/, { message: 'payroll.company_parameters.code_format' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(160, { message: 'validation.constraints.max_length|{"max":160}' })
  name: string;

  @IsIn(['CONTRIBUTION', 'TABLE', 'AMOUNT'])
  kind: 'CONTRIBUTION' | 'TABLE' | 'AMOUNT';

  @IsString()
  @IsOptional()
  @MaxLength(8, { message: 'validation.constraints.max_length|{"max":8}' })
  jurisdiction?: string | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  employeeRate?: number | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  employerRate?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  wageBase?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  threshold?: number | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  creditRate?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  amount?: number | null;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => WithholdingBracketDto)
  brackets?: WithholdingBracketDto[] | null;

  @IsDateString()
  effectiveFrom: string;

  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'validation.constraints.max_length|{"max":200}' })
  legalBasis?: string | null;
}

/** Retire a parameter from the company's payroll, or bring it back. */
export class SetCompanyParameterActiveDto {
  @IsBoolean()
  active: boolean;
}
