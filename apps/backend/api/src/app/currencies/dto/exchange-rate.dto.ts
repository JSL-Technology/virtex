import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExchangeRateType } from '../entities/exchange-rate.entity';

export class RecordRateDto {
  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  fromCurrency: string;

  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  toCurrency: string;

  /**
   * Units of `toCurrency` for one unit of `fromCurrency`.
   *
   * Stated in the field names rather than left to a comment, because a rate is just a number and
   * reading the direction backwards is the mistake that recorded a USD 100 invoice as 1.70 DOP.
   */
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  rate: number;

  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  date: string;

  @IsEnum(ExchangeRateType)
  @IsOptional()
  rateType?: ExchangeRateType;

  /** `DGII`, `DOF`, `TRM`, `BCRA`, `SUNAT`… The authority or provider the figure comes from. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32, { message: 'validation.constraints.max_length|{"max":32}' })
  @IsOptional()
  source?: string;
}

export class BackfillRatesDto {
  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  startDate: string;

  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  endDate: string;

  /**
   * How many days at most. A backfill is one upstream request per day, and an unbounded range is
   * an unbounded bill.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(370, { message: 'validation.constraints.max|{"max":370}' })
  @IsOptional()
  maxDays?: number;
}

export class RateLookupDto {
  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  from: string;

  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  to: string;

  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  date: string;

  @IsEnum(ExchangeRateType)
  @IsOptional()
  rateType?: ExchangeRateType;
}
