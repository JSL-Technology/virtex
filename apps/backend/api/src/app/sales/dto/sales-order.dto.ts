import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
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

export class SalesOrderLineDto {
  @IsOptional()
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  productId?: string;

  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0.000001}' })
  quantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(0.999999)
  discountRate?: number;
}

export class CreateSalesOrderDto {
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  customerId: string;

  @IsOptional()
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  branchId?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  orderDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  expectedDate?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'validation.constraints.max_length|{"max":80}' })
  customerReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(500, { message: 'validation.constraints.array_max_size|{"max":500}' })
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineDto)
  lines: SalesOrderLineDto[];
}

export class DeliveryLineDto {
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  orderLineId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0.000001}' })
  quantity: number;
}

export class DeliverDto {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  deliveryDate?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(500, { message: 'validation.constraints.array_max_size|{"max":500}' })
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineDto)
  lines: DeliveryLineDto[];

  @IsOptional() @IsString() @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  driverName?: string;

  @IsOptional() @IsString() @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  vehiclePlate?: string;

  @IsOptional() @IsString() @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  deliveryAddress?: string;

  @IsOptional() @IsString() @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  receivedBy?: string;

  @IsOptional() @IsString() @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;
}

export class InvoiceOrderDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100, { message: 'validation.constraints.array_max_size|{"max":100}' })
  @IsUUID('all', { each: true, message: 'validation.constraints.is_uuid' })
  deliveryNoteIds?: string[];
}

export class ReasonDto {
  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
