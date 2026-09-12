import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { ContributionBase, ContributionRegime } from '../entities/statutory-contribution.entity';
import { StatutoryReferenceKey } from '../entities/statutory-reference.entity';

export class UpsertContributionDto {
  @Length(2, 2)
  countryCode: string;

  @IsEnum(ContributionRegime)
  regime: ContributionRegime;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  employeeRate: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
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
  @Length(2, 2)
  countryCode: string;

  @IsEnum(StatutoryReferenceKey)
  key: StatutoryReferenceKey;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value: number;

  @Length(3, 3)
  @IsOptional()
  currencyCode?: string;
}

export class TaxBracketDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lowerAnnual: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  upperAnnual?: number | null;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  rate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  accumulatedTax: number;
}

/** Replace a whole income-tax scale for a country as of a date — the brackets are a set, not rows. */
export class ReplaceTaxScaleDto {
  @Length(2, 2)
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
