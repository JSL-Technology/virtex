import { Type } from 'class-transformer';
import {
  IsEnum,
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
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DepreciationMethod, FixedAssetStatus } from '../entities/fixed-asset.entity';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_MESSAGE = 'validation.constraints.is_iso_date';

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

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsUUID()
  @IsOptional()
  branchId?: string | null;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  acquisitionDate: string;

  /** Defaults to the acquisition date. */
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
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

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(1200, { message: 'validation.constraints.max|{"max":1200}' })
  usefulLifeMonths: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod;

  @IsUUID()
  assetAccountId: string;

  @IsUUID()
  accumulatedDepreciationAccountId: string;

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

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsUUID()
  @IsOptional()
  branchId?: string | null;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  @IsOptional()
  acquisitionDate?: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
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
}

/** Retiring an asset: sold, scrapped, lost. */
export class DisposeAssetDto {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
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
}

/** A month to depreciate, `YYYY-MM`. */
export class DepreciationRunDto {
  @Matches(ISO_MONTH)
  period: string;
}
