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
  @Length(3, 3, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":3}' })
  fromCurrency: string;

  @IsString()
  @Length(3, 3, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":3}' })
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

  @IsDateString({}, { message: 'VALIDATION.CONSTRAINTS.IS_DATE_STRING' })
  date: string;

  @IsEnum(ExchangeRateType)
  @IsOptional()
  rateType?: ExchangeRateType;

  /** `DGII`, `DOF`, `TRM`, `BCRA`, `SUNAT`… The authority or provider the figure comes from. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @IsOptional()
  source?: string;
}

export class BackfillRatesDto {
  @IsDateString({}, { message: 'VALIDATION.CONSTRAINTS.IS_DATE_STRING' })
  startDate: string;

  @IsDateString({}, { message: 'VALIDATION.CONSTRAINTS.IS_DATE_STRING' })
  endDate: string;

  /**
   * How many days at most. A backfill is one upstream request per day, and an unbounded range is
   * an unbounded bill.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(370)
  @IsOptional()
  maxDays?: number;
}

export class RateLookupDto {
  @IsString()
  @Length(3, 3, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":3}' })
  from: string;

  @IsString()
  @Length(3, 3, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":3}' })
  to: string;

  @IsDateString({}, { message: 'VALIDATION.CONSTRAINTS.IS_DATE_STRING' })
  date: string;

  @IsEnum(ExchangeRateType)
  @IsOptional()
  rateType?: ExchangeRateType;
}
