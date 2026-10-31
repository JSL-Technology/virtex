import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Length, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { RecurringFrequency } from '../entities/recurring-invoice.entity';

export class RecurringLineDto {
  @IsOptional()
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description?: string;

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

export class CreateRecurringInvoiceDto {
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  customerId: string;

  @IsOptional()
  @IsUUID('all', { message: 'validation.constraints.is_uuid' })
  branchId?: string;

  @IsString()
  @MinLength(2, { message: 'validation.constraints.min_length|{"min":2}' })
  @MaxLength(160, { message: 'validation.constraints.max_length|{"max":160}' })
  name: string;

  @IsEnum(RecurringFrequency, { message: 'validation.constraints.is_enum' })
  frequency: RecurringFrequency;

  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  startDate: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(365, { message: 'validation.constraints.max|{"max":365}' })
  paymentTermDays?: number;

  @IsOptional()
  @IsBoolean()
  autoIssue?: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(200, { message: 'validation.constraints.array_max_size|{"max":200}' })
  @ValidateNested({ each: true })
  @Type(() => RecurringLineDto)
  lines: RecurringLineDto[];
}

export class UpdateRecurringInvoiceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160)
  name?: string;

  @IsOptional() @IsEnum(RecurringFrequency, { message: 'validation.constraints.is_enum' })
  frequency?: RecurringFrequency;

  @IsOptional() @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  startDate?: string;

  @IsOptional() @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  endDate?: string;

  @IsOptional() @IsInt() @Min(0) @Max(365)
  paymentTermDays?: number;

  @IsOptional() @IsBoolean()
  autoIssue?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => RecurringLineDto)
  lines?: RecurringLineDto[];
}
