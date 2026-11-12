import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
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
  ValidateNested,
} from 'class-validator';

export class RfqLineDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0}' })
  quantity: number;

  @IsString()
  @IsOptional()
  @MaxLength(16, { message: 'validation.constraints.max_length|{"max":16}' })
  unitOfMeasure?: string;
}

/** A request for quotation (CMP-15). Lines may be omitted when it sources an approved requisition. */
export class CreateRfqDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'validation.constraints.max_length|{"max":200}' })
  title: string;

  @IsUUID()
  @IsOptional()
  requisitionId?: string;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsDateString()
  @IsOptional()
  responseDueDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(200, { message: 'validation.constraints.array_max_size|{"max":200}' })
  @ValidateNested({ each: true })
  @Type(() => RfqLineDto)
  lines?: RfqLineDto[];

  /** The suppliers asked to quote. */
  @IsArray()
  @ArrayMaxSize(50, { message: 'validation.constraints.array_max_size|{"max":50}' })
  @IsUUID('4', { each: true })
  supplierIds: string[];
}

export class QuoteLineDto {
  @IsUUID()
  rfqLineId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice: number;

  /** A fraction: 0.18, never 18. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  @IsOptional()
  taxRate?: number;
}

/** A supplier's quotation, recorded against the RFQ it answers. */
export class RecordQuoteDto {
  @IsUUID()
  supplierId: string;

  @IsString()
  @IsOptional()
  @MaxLength(60, { message: 'validation.constraints.max_length|{"max":60}' })
  reference?: string;

  @IsDateString()
  @IsOptional()
  receivedOn?: string;

  @IsDateString()
  validUntil: string;

  @IsInt()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(3650, { message: 'validation.constraints.max|{"max":3650}' })
  @IsOptional()
  leadTimeDays?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(200, { message: 'validation.constraints.array_max_size|{"max":200}' })
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
}

/** Award a quotation; the reason is required when it is not the cheapest valid one. */
export class AwardQuoteDto {
  @IsUUID()
  quoteId: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'validation.constraints.max_length|{"max":1000}' })
  reason?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;
}
