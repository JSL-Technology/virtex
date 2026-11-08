import { Type } from 'class-transformer';
import {
  MaxLength,
  IsString,
  IsNotEmpty,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Matches,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { ContributionBase } from '../entities/statutory-contribution.entity';
import { StatutoryReferenceKey } from '../entities/statutory-reference.entity';

export class UpsertContributionDto {
  /**
   * The instrument that sets this value — law, decree, TSS/DGII resolution — and, where useful, its
   * number and date (audit 2026-11-07, SP-03). Required: a statutory value nobody can trace to its
   * source is the defect this table exists to prevent.
   */
  @IsString()
  @IsNotEmpty({ message: 'payroll.legal_basis_required' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  legalBasis: string;

  /** Date the instrument was published in the official gazette, where known. */
  @IsDateString()
  @IsOptional()
  publishedOn?: string | null;

  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  countryCode: string;

  /** A code of the country's contribution catalogue; the service checks it against the strategy. */
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, { message: 'payroll.contribution_code_invalid' })
  code: string;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  employeeRate: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  employerRate: number;

  @IsEnum(ContributionBase)
  @IsOptional()
  base?: ContributionBase;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsOptional()
  capMinWageMultiplier?: number | null;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsOptional()
  floorMinWageMultiplier?: number | null;
}

export class UpsertReferenceDto {
  /**
   * The instrument that sets this value — law, decree, TSS/DGII resolution — and, where useful, its
   * number and date (audit 2026-11-07, SP-03). Required: a statutory value nobody can trace to its
   * source is the defect this table exists to prevent.
   */
  @IsString()
  @IsNotEmpty({ message: 'payroll.legal_basis_required' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  legalBasis: string;

  /** Date the instrument was published in the official gazette, where known. */
  @IsDateString()
  @IsOptional()
  publishedOn?: string | null;

  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  countryCode: string;

  @IsEnum(StatutoryReferenceKey)
  key: StatutoryReferenceKey;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  value: number;

  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  @IsOptional()
  currencyCode?: string;
}

export class TaxBracketDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  lowerAnnual: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  upperAnnual?: number | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  rate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  accumulatedTax: number;
}

/** Replace a whole income-tax scale for a country as of a date — the brackets are a set, not rows. */
export class ReplaceTaxScaleDto {
  /**
   * The instrument that sets this value — law, decree, TSS/DGII resolution — and, where useful, its
   * number and date (audit 2026-11-07, SP-03). Required: a statutory value nobody can trace to its
   * source is the defect this table exists to prevent.
   */
  @IsString()
  @IsNotEmpty({ message: 'payroll.legal_basis_required' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  legalBasis: string;

  /** Date the instrument was published in the official gazette, where known. */
  @IsDateString()
  @IsOptional()
  publishedOn?: string | null;

  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  countryCode: string;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TaxBracketDto)
  brackets: TaxBracketDto[];
}
