import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class InventoryAdjustmentLineDto {
  @IsUUID()
  productId: string;

  /** What was counted. Set this OR `quantityChange`: a count is compared with the balance on posting. */
  @ValidateIf((line: InventoryAdjustmentLineDto) => line.quantityChange === undefined || line.quantityChange === null)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  countedQuantity?: number | null;

  /** The signed change, when it is known rather than counted (breakage, samples). */
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  quantityChange?: number | null;

  /** What a surplus is worth per unit. Omitted: the product's average cost. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  unitCost?: number | null;

  /** A new unit cost for the product, revaluing its whole stock. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  newUnitCost?: number | null;
}

export class SaveInventoryAdjustmentDto {
  @IsDateString()
  date: string;

  @IsUUID()
  warehouseId: string;

  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  reason: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentLineDto)
  lines: InventoryAdjustmentLineDto[];
}

export class InventoryAdjustmentQueryDto {
  @IsIn(['DRAFT', 'POSTED', 'CANCELLED'])
  @IsOptional()
  status?: 'DRAFT' | 'POSTED' | 'CANCELLED';

  @IsUUID()
  @IsOptional()
  warehouseId?: string;
}
