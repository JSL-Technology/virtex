import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { GoodsReceiptStatus } from '../entities/purchase-order-receipt.entity';
import { ReceivePurchaseOrderDto } from './purchase-order.dto';

/** A delivery recorded as its own document: which order it arrived against, and what arrived. */
export class CreateGoodsReceiptDto extends ReceivePurchaseOrderDto {
  @IsUUID()
  @IsNotEmpty()
  orderId: string;
}

export class GoodsReceiptQueryDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsUUID()
  @IsOptional()
  orderId?: string;

  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsIn(Object.values(GoodsReceiptStatus))
  @IsOptional()
  status?: GoodsReceiptStatus;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}

/** Undoing a receipt: why, and on which date the stock and the entry go back. */
export class VoidGoodsReceiptDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;

  /** The reversal's booking date (YYYY-MM-DD). Today, in the company's zone, when omitted. */
  @IsDateString()
  @IsOptional()
  reversalDate?: string;
}

/** One line of a return to the supplier (CMP-15). */
export class ReturnLineDto {
  @IsUUID()
  lineId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  quantity: number;
}

/** Send part of a receipt back to the supplier (CMP-15). */
export class ReturnGoodsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines: ReturnLineDto[];

  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;

  @IsDateString()
  @IsOptional()
  date?: string;
}
