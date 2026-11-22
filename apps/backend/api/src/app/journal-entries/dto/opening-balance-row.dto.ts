import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** One line of an imported opening balance: an account and the side its balance sits on. */
export class OpeningBalanceRowDto {
  @IsDateString()
  date!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50, { message: 'validation.constraints.max_length|{"max":50}' })
  accountCode!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  debit?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  credit?: number;

  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  description?: string;

  /**
   * When the balance originated, if before the opening date (FIN-AC-04): property bought in 2019,
   * capital contributed in 2015. A company restating for inflation for the first time restates each
   * amount from when it arose (IAS 29.15, 24), so an account may come in several rows, one per
   * origin. Omitted: the opening date — a balance already expressed in that day's currency.
   */
  @IsDateString({}, { message: 'validation.constraints.is_date_string' })
  @IsOptional()
  originDate?: string;

  /**
   * The account's name, as the export writes it. Read and ignored — the code decides — so a file
   * exported from here, or a trial balance that names its accounts, imports as it is.
   */
  @IsString()
  @IsOptional()
  accountName?: string;
}
