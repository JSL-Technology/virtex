import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { DEPRECIATION_CONVENTIONS, type DepreciationConvention, type LocalizedName } from '@virtex/shared/types';
import { IsLocalizedName } from '../../common/validators/is-localized-name.validator';
import { DepreciationMethod } from '../entities/fixed-asset.entity';
import type { TaxDepreciationMethod } from '../entities/fixed-asset-category.entity';

/** A yearly rate, as a fraction: more than nothing, at most all of it. */
const RATE = { min: 0.000001, max: 1 };

/** A category of fixed assets, and what an asset of it starts with (FINB-16). */
export class CreateFixedAssetCategoryDto {
  /** `VEH`, `EQ-COMP`. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  @Matches(/^\s*[A-Za-z0-9][A-Za-z0-9_.-]*\s*$/, { message: 'fixed_assets.category_code_format' })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'validation.constraints.max_length|{"max":200}' })
  name: string;

  @IsOptional()
  @IsLocalizedName()
  nameTranslations?: LocalizedName;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  description?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(1200, { message: 'validation.constraints.max|{"max":1200}' })
  @IsOptional()
  usefulLifeMonths?: number | null;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod | null;

  /** The yearly rate of a `DECLINING_BALANCE` method, as a fraction. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(RATE.min, { message: `validation.constraints.min|{"min":${RATE.min}}` })
  @Max(RATE.max, { message: `validation.constraints.max|{"max":${RATE.max}}` })
  @IsOptional()
  decliningAnnualRate?: number | null;

  @IsIn(DEPRECIATION_CONVENTIONS, { message: 'validation.constraints.is_in' })
  @IsOptional()
  depreciationConvention?: DepreciationConvention | null;

  /** The share of the cost left at the end of the life, as a fraction. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(0.999999, { message: 'validation.constraints.max|{"max":0.999999}' })
  @IsOptional()
  residualRate?: number;

  @IsUUID()
  @IsOptional()
  assetAccountId?: string | null;

  @IsUUID()
  @IsOptional()
  accumulatedDepreciationAccountId?: string | null;

  @IsUUID()
  @IsOptional()
  depreciationExpenseAccountId?: string | null;

  @IsUUID()
  @IsOptional()
  gainOnDisposalAccountId?: string | null;

  @IsUUID()
  @IsOptional()
  lossOnDisposalAccountId?: string | null;

  /** The market's tax category: `DO-2`. Its method and rate are the defaults below. */
  @IsString()
  @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  @IsOptional()
  taxCategoryCode?: string | null;

  @IsIn([DepreciationMethod.STRAIGHT_LINE, DepreciationMethod.DECLINING_BALANCE], { message: 'validation.constraints.is_in' })
  @IsOptional()
  taxMethod?: TaxDepreciationMethod | null;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(RATE.min, { message: `validation.constraints.min|{"min":${RATE.min}}` })
  @Max(RATE.max, { message: `validation.constraints.max|{"max":${RATE.max}}` })
  @IsOptional()
  taxAnnualRate?: number | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/** Editing a category. What its assets were registered with is theirs: nothing here rewrites them. */
export class UpdateFixedAssetCategoryDto extends PartialType(CreateFixedAssetCategoryDto) {}
