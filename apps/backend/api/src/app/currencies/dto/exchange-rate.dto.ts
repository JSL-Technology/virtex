import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
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

/** Which rates the history shows: the company's own, the shared market table, or both. */
export enum RateScope {
  TENANT = 'TENANT',
  SHARED = 'SHARED',
  ALL = 'ALL',
}

export class RateHistoryQueryDto {
  /** Rates involving this currency, on either side. */
  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  @IsOptional()
  currency?: string;

  @IsEnum(ExchangeRateType)
  @IsOptional()
  rateType?: ExchangeRateType;

  @IsEnum(RateScope)
  @IsOptional()
  scope?: RateScope;

  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  @IsOptional()
  from?: string;

  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  @IsOptional()
  to?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(500, { message: 'validation.constraints.max|{"max":500}' })
  @IsOptional()
  limit?: number;
}

/** Many rates at once — a month of the authority's published table pasted from a spreadsheet. */
export class ImportRatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => RecordRateDto)
  rates: RecordRateDto[];
}
