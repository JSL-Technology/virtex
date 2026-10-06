import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
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

/**
 * One quoted line. The same shape and limits as an invoice line, because it becomes one: a
 * quantity of 1.5 hours, a six-decimal unit price and a line discount all survive the conversion.
 */
export class QuoteLineDto {
  /** Optional: a service quoted by description alone has no catalogue item. */
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(0.999999)
  @IsOptional()
  discountRate?: number;
}

export class CreateQuoteDto {
  @IsUUID()
  customerId: string;

  /** The branch quoting. Omitted: the person's default branch, else the headquarters. */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  opportunityId?: string;

  @IsDateString()
  issueDate: string;

  /** Valid until. Checked against `issueDate` by the service. */
  @IsDateString()
  expiryDate: string;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(0.999999)
  @IsOptional()
  documentDiscountRate?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
}

/** A draft is rewritten whole: header and lines. A sent quote is not edited, it is revised. */
export class UpdateQuoteDto extends CreateQuoteDto {}

export class QuoteReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000, { message: 'validation.constraints.max_length|{"max":1000}' })
  reason: string;
}

export class CancelQuoteDto {
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'validation.constraints.max_length|{"max":1000}' })
  reason?: string;
}

export class ListQuotesQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(16)
  status?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;
}
