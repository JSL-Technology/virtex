import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PurchaseOrderStatus } from '../entities/purchase-order.entity';

export class PurchaseOrderLineDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  /** Required even when a product is named: what the supplier will read on the order. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0}' })
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice: number;

  /** A fraction, not a percentage: 0.18, never 18. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  @IsOptional()
  taxRate?: number;

  @IsString()
  @IsOptional()
  @MaxLength(16, { message: 'validation.constraints.max_length|{"max":16}' })
  unitOfMeasure?: string;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @IsDateString()
  @IsOptional()
  orderDate?: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  /** An order with no lines is not an order. */
  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsDateString()
  @IsOptional()
  orderDate?: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  @IsOptional()
  lines?: PurchaseOrderLineDto[];
}

export class PurchaseOrderQueryDto {
  @IsEnum(PurchaseOrderStatus)
  @IsOptional()
  status?: PurchaseOrderStatus;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(200, { message: 'validation.constraints.max|{"max":200}' })
  @IsOptional()
  pageSize?: number;
}

/** One line of a delivery: which order line, and how much of it arrived. */
export class ReceiptLineDto {
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  quantity: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines: ReceiptLineDto[];
}

export class RejectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
