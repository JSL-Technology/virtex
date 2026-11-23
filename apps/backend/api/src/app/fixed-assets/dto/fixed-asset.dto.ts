import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';
import { DepreciationMethod, FixedAssetStatus } from '../entities/fixed-asset.entity';
import { DepreciationRunTrigger } from '../entities/fixed-asset-depreciation-run.entity';
import { DEPRECIATION_CONVENTIONS, type DepreciationConvention } from '@virtex/shared/types';

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A yearly rate, as a fraction: more than nothing, at most all of it. */
const RATE = { min: 0.000001, max: 1 };

/**
 * An asset's tax book (audit 2026-11-07, FINB-16): what the tax authority lets the company deduct,
 * kept beside the accounting book and posted nowhere. Each field left out comes from the asset's
 * category, and the category's from the market's tax category.
 */
export class TaxBookDto {
  /** The authority's category: `DO-2`. Where the market fixes its categories, one of them. */
  @IsString()
  @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  @IsOptional()
  taxCategoryCode?: string | null;

  @IsIn([DepreciationMethod.STRAIGHT_LINE, DepreciationMethod.DECLINING_BALANCE], { message: 'validation.constraints.is_in' })
  @IsOptional()
  method?: DepreciationMethod.STRAIGHT_LINE | DepreciationMethod.DECLINING_BALANCE;

  /** The yearly rate, as a fraction: 0.25 for 25 %. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(RATE.min, { message: `validation.constraints.min|{"min":${RATE.min}}` })
  @Max(RATE.max, { message: `validation.constraints.max|{"max":${RATE.max}}` })
  @IsOptional()
  annualRate?: number;

  /** The convention the book follows; the asset's when not stated. */
  @IsIn(DEPRECIATION_CONVENTIONS, { message: 'validation.constraints.is_in' })
  @IsOptional()
  convention?: DepreciationConvention;

  /** The basis the book depreciates; the asset's cost when not stated. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  cost?: number;

  /** What was deducted before the asset entered this product — a migration's opening tax balance. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  openingAccumulated?: number;

  /** The last month that opening balance covers, `YYYY-MM`. Required with it. */
  @Matches(ISO_MONTH)
  @IsOptional()
  openingThrough?: string | null;
}

/**
 * Registering an asset.
 *
 * Nothing here was validated: the DTO declared bare fields, so a negative cost, a useful life of
 * zero months or a method nobody implemented reached the database, and an account id was checked
 * by nothing until the depreciation run posted to it.
 */
export class CreateFixedAssetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /**
   * The asset's category (FINB-16): what is not stated here — life, method, convention, residual
   * share, accounts, tax book — is taken from it, and copied onto the asset.
   */
  @IsUUID()
  @IsOptional()
  categoryId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsUUID()
  @IsOptional()
  branchId?: string | null;

  @IsIsoDate()
  acquisitionDate: string;

  /** Defaults to the acquisition date. */
  @IsIsoDate()
  @IsOptional()
  inServiceDate?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'validation.constraints.min|{"min":0.01}' })
  cost: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  residualValue?: number;

  /** Required unless the category gives it. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(1200, { message: 'validation.constraints.max|{"max":1200}' })
  @IsOptional()
  usefulLifeMonths?: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod;

  /** The yearly rate of a `DECLINING_BALANCE` method, as a fraction. Required with it. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(RATE.min, { message: `validation.constraints.min|{"min":${RATE.min}}` })
  @Max(RATE.max, { message: `validation.constraints.max|{"max":${RATE.max}}` })
  @IsOptional()
  decliningAnnualRate?: number | null;

  /** How the month it enters service, and the month it leaves, are charged. Defaults to the company's. */
  @IsIn(DEPRECIATION_CONVENTIONS, { message: 'validation.constraints.is_in' })
  @IsOptional()
  depreciationConvention?: DepreciationConvention;

  /** Required unless the category gives it. */
  @IsUUID()
  @IsOptional()
  assetAccountId?: string;

  /** The category's, or else the company's default, when not stated. */
  @IsUUID()
  @IsOptional()
  accumulatedDepreciationAccountId?: string;

  /** Null charges the company's default depreciation expense account. */
  @IsUUID()
  @IsOptional()
  depreciationExpenseAccountId?: string | null;

  @IsUUID()
  @IsOptional()
  vendorBillId?: string | null;

  /** Depreciation charged before the asset entered this product — a migration's opening balance. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  openingAccumulatedDepreciation?: number;

  /** The last month that opening balance covers, `YYYY-MM`. Required with it. */
  @Matches(ISO_MONTH)
  @IsOptional()
  openingDepreciatedThrough?: string;

  /**
   * The asset's tax book. Left out, the category's terms open it — or none, where the category has
   * no tax rate; null keeps none.
   */
  @ValidateNested()
  @Type(() => TaxBookDto)
  @IsOptional()
  taxBook?: TaxBookDto | null;
}

/**
 * Editing an asset. Everything is optional; which fields may still change depends on whether the
 * asset has been depreciated here — see `FixedAssetsService.update`.
 */
export class UpdateFixedAssetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  /** Reclassifies the asset; nothing it was registered with changes. */
  @IsUUID()
  @IsOptional()
  categoryId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsUUID()
  @IsOptional()
  branchId?: string | null;

  @IsIsoDate()
  @IsOptional()
  acquisitionDate?: string;

  @IsIsoDate()
  @IsOptional()
  inServiceDate?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'validation.constraints.min|{"min":0.01}' })
  @IsOptional()
  cost?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  residualValue?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(1200, { message: 'validation.constraints.max|{"max":1200}' })
  @IsOptional()
  usefulLifeMonths?: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(RATE.min, { message: `validation.constraints.min|{"min":${RATE.min}}` })
  @Max(RATE.max, { message: `validation.constraints.max|{"max":${RATE.max}}` })
  @IsOptional()
  decliningAnnualRate?: number | null;

  @IsIn(DEPRECIATION_CONVENTIONS, { message: 'validation.constraints.is_in' })
  @IsOptional()
  depreciationConvention?: DepreciationConvention;

  @IsUUID()
  @IsOptional()
  assetAccountId?: string;

  @IsUUID()
  @IsOptional()
  accumulatedDepreciationAccountId?: string;

  @IsUUID()
  @IsOptional()
  depreciationExpenseAccountId?: string | null;

  @IsUUID()
  @IsOptional()
  vendorBillId?: string | null;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  openingAccumulatedDepreciation?: number;

  @Matches(ISO_MONTH)
  @IsOptional()
  openingDepreciatedThrough?: string | null;

  /**
   * The asset's tax book: opened when it has none, edited when it has one, removed by null while
   * nothing was charged in it. Once it was, its basis and opening balance are fixed; its method and
   * rate change from the next month on.
   */
  @ValidateNested()
  @Type(() => TaxBookDto)
  @IsOptional()
  taxBook?: TaxBookDto | null;
}

/** Retiring an asset: sold, scrapped, lost. */
export class DisposeAssetDto {
  @IsIsoDate()
  disposalDate: string;

  /** What it was sold for. Zero for a write-off. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  salePrice: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  disposalReason: string;

  /** Where the proceeds went — a bank, cash or a receivable. Required when there are proceeds. */
  @IsUUID()
  @IsOptional()
  cashAccountId?: string;

  /** Required when the proceeds exceed the carrying amount. */
  @IsUUID()
  @IsOptional()
  gainOnDisposalAccountId?: string;

  /** Required when the proceeds fall short of the carrying amount. */
  @IsUUID()
  @IsOptional()
  lossOnDisposalAccountId?: string;
}

export class FixedAssetsQueryDto extends PaginationQueryDto {
  @IsEnum(FixedAssetStatus)
  @IsOptional()
  status?: FixedAssetStatus;

  /** Number or name. */
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;
}

/** A month to depreciate, `YYYY-MM`. */
export class DepreciationRunDto {
  @Matches(ISO_MONTH)
  period: string;
}

/** The runs on the board: what set them going, or the runs that charged one asset. */
export class DepreciationRunsQueryDto extends PaginationQueryDto {
  @IsEnum(DepreciationRunTrigger)
  @IsOptional()
  trigger?: DepreciationRunTrigger;

  @IsUUID()
  @IsOptional()
  fixedAssetId?: string;
}

/** The categories on the board: the inactive ones too, when asked. */
export class FixedAssetCategoriesQueryDto {
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  @IsOptional()
  includeInactive?: boolean;
}

/** The months a tax depreciation report covers, `YYYY-MM` through `YYYY-MM`. */
export class TaxDepreciationReportQueryDto extends PaginationQueryDto {
  @Matches(ISO_MONTH)
  from: string;

  @Matches(ISO_MONTH)
  to: string;

  /** Only the assets of one tax category: `DO-2`. */
  @IsString()
  @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  @IsOptional()
  taxCategoryCode?: string;
}
