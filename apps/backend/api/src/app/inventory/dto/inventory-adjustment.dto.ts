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

  /**
   * What the warehouse held when the count was taken — the figure shown beside it. Lets posting
   * notice that the balance moved since, instead of silently undoing that movement.
   */
  @ValidateIf((line: InventoryAdjustmentLineDto) => line.countedQuantity !== undefined && line.countedQuantity !== null)
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  expectedQuantity?: number | null;

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

/**
 * What to do when a count's balance moved between counting and posting.
 *
 * - `apply_count`: the shelf holds what was counted; the change is taken against today's balance.
 * - `keep_difference`: what was found missing (or extra) when counting is what is booked; the
 *   movements since are left as they are.
 *
 * Omitted, a moved balance refuses the posting and reports every line that moved.
 */
export const BALANCE_CHANGE_DECISIONS = ['apply_count', 'keep_difference'] as const;
export type BalanceChangeDecision = (typeof BALANCE_CHANGE_DECISIONS)[number];

export class PostInventoryAdjustmentDto {
  @IsIn(BALANCE_CHANGE_DECISIONS)
  @IsOptional()
  onBalanceChange?: BalanceChangeDecision;
}

/** Undo a posted adjustment with its mirror image, a document of its own. */
export class ReverseInventoryAdjustmentDto {
  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  reason: string;

  /** The reversal's date. Omitted, today in the company's calendar. */
  @IsDateString()
  @IsOptional()
  date?: string;
}

export class AdjustmentDateQueryDto {
  @IsDateString()
  date: string;
}
