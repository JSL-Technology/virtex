import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ISO_MONTH_PATTERN } from '@virtex/shared/types';

/** One month of an index, as a person or a file states it. */
export class PriceIndexEntryDto {
  /** `2026-03`. */
  @Matches(ISO_MONTH_PATTERN, { message: 'validation.price_indices.period_format' })
  period: string;

  /**
   * The level as published, as decimal TEXT (`"7694.0072"`): a JSON number cannot carry every
   * digit of a long-running index, and the coefficient it divides into must be exact.
   */
  @IsString({ message: 'validation.price_indices.value_format' })
  @Matches(/^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/, { message: 'validation.price_indices.value_format' })
  value: string;

  @IsOptional()
  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  publishedOn?: string;

  /** The publication it was read from. */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reference?: string;
}

export class RecordPriceIndexValuesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  // Fifty years of months: a whole series' history in one load, and no more.
  @ArrayMaxSize(600, { message: 'validation.constraints.array_max_size|{"max":600}' })
  @ValidateNested({ each: true })
  @Type(() => PriceIndexEntryDto)
  values: PriceIndexEntryDto[];
}

export class PriceIndexRangeQueryDto {
  @Matches(ISO_MONTH_PATTERN, { message: 'validation.price_indices.period_format' })
  from: string;

  @Matches(ISO_MONTH_PATTERN, { message: 'validation.price_indices.period_format' })
  to: string;
}
