import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

/** The window and currency of a statement of account. Defaults: this year to date, base currency. */
export class StatementQueryDto {
  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  @IsOptional()
  from?: string;

  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  @IsOptional()
  to?: string;

  @IsString()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  @IsOptional()
  currency?: string;
}
