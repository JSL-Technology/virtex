import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  DATE_ORDERS,
  DATE_SEPARATORS,
  DateOrder,
  DateSeparator,
  NUMBER_FORMATS,
  NumberFormat,
  TIME_FORMATS,
  TimeFormat,
  WEEK_STARTS,
  WeekStart,
} from '@virteex/shared/types';

/**
 * One level of `RegionalFormat`, as a request body: the company's default or a person's own.
 *
 * Every field is optional and accepts `null`, which means «automatic» — inherit from the next
 * level. Values outside the catalogue are refused rather than stored, because a formatter handed
 * an unknown separator would print it.
 */
export class RegionalFormatDto {
  @ApiPropertyOptional({ enum: DATE_ORDERS, nullable: true })
  @IsOptional()
  @IsIn(DATE_ORDERS as readonly string[], { message: 'validation.regional_format.date_order' })
  dateOrder?: DateOrder | null;

  @ApiPropertyOptional({ enum: DATE_SEPARATORS, nullable: true })
  @IsOptional()
  @IsIn(DATE_SEPARATORS as readonly string[], { message: 'validation.regional_format.date_separator' })
  dateSeparator?: DateSeparator | null;

  @ApiPropertyOptional({ enum: NUMBER_FORMATS, nullable: true })
  @IsOptional()
  @IsIn(NUMBER_FORMATS as readonly string[], { message: 'validation.regional_format.number_format' })
  numberFormat?: NumberFormat | null;

  @ApiPropertyOptional({ enum: TIME_FORMATS, nullable: true })
  @IsOptional()
  @IsIn(TIME_FORMATS as readonly string[], { message: 'validation.regional_format.time_format' })
  timeFormat?: TimeFormat | null;

  @ApiPropertyOptional({ enum: WEEK_STARTS, nullable: true })
  @IsOptional()
  @IsIn(WEEK_STARTS as readonly number[], { message: 'validation.regional_format.first_day_of_week' })
  firstDayOfWeek?: WeekStart | null;
}
