import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One line as the till SENDS it: which product, how many, and the price it SHOWED.
 *
 * The price is not what the sale is charged at — the server prices every line from the catalogue.
 * It is sent so the server can refuse a sale whose customer was shown a different amount.
 */
export class PosSaleItemDto {
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  productId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  productName?: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  price: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0.000001}' })
  @Max(100_000, { message: 'validation.constraints.max|{"max":100000}' })
  quantity: number;
}

/** One tender: how part (or all) of the sale was paid. */
export class PosPaymentDto {
  @IsIn(['cash', 'card', 'transfer', 'other'], { message: 'validation.constraints.is_in' })
  method: 'cash' | 'card' | 'transfer' | 'other';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'validation.constraints.min|{"min":0.01}' })
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'validation.constraints.max_length|{"max":80}' })
  reference?: string;
}

export class ProcessSaleDto {
  @IsString()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  terminalId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(500, { message: 'validation.constraints.array_max_size|{"max":500}' })
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items: PosSaleItemDto[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  subtotal: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  tax: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  total: number;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'validation.constraints.max_length|{"max":60}' })
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  customerName?: string;

  /**
   * How the customer paid (QA C-04). Several entries make a mixed payment. Optional so an older
   * till keeps working; when present it must cover the total, and only cash may exceed it — the
   * difference is the change.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'validation.constraints.array_max_size|{"max":10}' })
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments?: PosPaymentDto[];
}
