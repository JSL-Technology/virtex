import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const toBoolean = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class StockOnHandQueryDto {
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  /** Rows at zero too: a count sheet lists everything a warehouse has ever held. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeZero?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'SALE_DISPATCH',
  'SALE_RETURN',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
] as const;

export class StockMovementsQueryDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsIn(MOVEMENT_TYPES)
  @IsOptional()
  type?: (typeof MOVEMENT_TYPES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}
