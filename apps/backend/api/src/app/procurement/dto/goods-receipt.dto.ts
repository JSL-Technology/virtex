import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
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
