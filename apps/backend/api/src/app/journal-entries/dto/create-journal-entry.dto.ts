

import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  IsUUID,
  IsNumber,
  Min,
  IsOptional,
  Length,
  IsEnum,
  IsObject,
  IsDefined,
} from 'class-validator';
import { JournalEntryType } from '../entities/journal-entry.entity';

class LineValuationDto {
  @IsUUID('4', { message: 'validation.create_journal_entry.ledger_id_ledger_id_must_valid' })
  @IsNotEmpty({ message: 'validation.create_journal_entry.ledger_id_ledger_id_required_every' })
  ledgerId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.create_journal_entry.debit_must_valid_number' })
  @IsDefined({ message: 'validation.create_journal_entry.debit_field_required' })
  @Min(0, { message: 'validation.create_journal_entry.debit_cannot_negative' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.create_journal_entry.credit_must_valid_number' })
  @IsDefined({ message: 'validation.create_journal_entry.credit_field_required' })
  @Min(0, { message: 'validation.create_journal_entry.credit_cannot_negative' })
  credit: number;
}


export class CreateJournalEntryLineDto {
  @IsUUID('4', { message: 'validation.create_journal_entry.account_id_account_id_must_valid' })
  @IsNotEmpty({ message: 'validation.create_journal_entry.account_id_account_id_required' })
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.create_journal_entry.debit_transaction_currency_must_number' })
  @IsDefined({ message: 'validation.create_journal_entry.debit_field_required' })
  @Min(0, { message: 'validation.create_journal_entry.debit_cannot_negative' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.create_journal_entry.credit_transaction_currency_must_number' })
  @IsDefined({ message: 'validation.create_journal_entry.credit_field_required' })
  @Min(0, { message: 'validation.create_journal_entry.credit_cannot_negative' })
  credit: number;

  @IsString({ message: 'validation.create_journal_entry.line_description_must_text' })
  @IsOptional()
  description?: string;
  
  @IsObject({ message: 'validation.create_journal_entry.dimensions_must_object' })
  @IsOptional()
  dimensions?: Record<string, string>;

  /**
   * The currency this line was actually transacted in, when it is not the entry's.
   *
   * ## Why the line needs its own currency
   *
   * `journal_entry_lines` has carried `currency_code`, `foreign_currency_debit`,
   * `foreign_currency_credit` and `exchange_rate` since the baseline schema, and
   * `AccountBalancesService.foreignCurrencyBalancesAsOf` reads them: they are what the period-end
   * revaluation restates at the closing rate. No DTO could express them, and the global pipe runs
   * with `forbidNonWhitelisted`, so a caller that sent them got a 400. The only writer was the
   * entry-level `currencyCode`/`exchangeRate` pair, which converts **every** line at one rate.
   *
   * One rate for the whole entry cannot describe a transfer from a dollar account into a peso one:
   * the two sides are in different currencies by construction. So those entries stored no
   * document-currency amount at all, the dollar account's foreign-currency balance excluded every
   * transfer ever made, and the revaluation restated the wrong exposure at each close.
   *
   * When set, `debit` and `credit` remain the LEDGER-currency amounts — the ones that have to
   * balance — and these three fields record what the document said.
   */
  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.create_journal_entry.currency_code_must_exactly_characters' })
  currencyCode?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.create_journal_entry.debit_transaction_currency_must_number' })
  @IsOptional()
  @Min(0, { message: 'validation.create_journal_entry.debit_cannot_negative' })
  foreignCurrencyDebit?: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.create_journal_entry.credit_transaction_currency_must_number' })
  @IsOptional()
  @Min(0, { message: 'validation.create_journal_entry.credit_cannot_negative' })
  foreignCurrencyCredit?: number;

  @IsNumber({}, { message: 'validation.create_journal_entry.exchange_rate_must_number' })
  @IsOptional()
  @Min(0, { message: 'validation.create_journal_entry.exchange_rate_cannot_negative' })
  exchangeRate?: number;

  @IsArray({ message: 'validation.create_journal_entry.valuations_must_array' })
  @ValidateNested({ each: true })
  @Type(() => LineValuationDto)
  @IsOptional()
  valuations?: LineValuationDto[];
}

export class CreateJournalEntryDto {
  @IsDateString({}, { message: 'validation.create_journal_entry.date_must_valid_iso_8601_format' })
  @IsNotEmpty({ message: 'validation.create_journal_entry.entry_date_required' })
  date: string;

  @IsString({ message: 'validation.create_journal_entry.description_must_text' })
  @IsNotEmpty({ message: 'validation.create_journal_entry.entry_description_required' })
  description: string;
  
  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.create_journal_entry.currency_code_must_exactly_characters' })
  currencyCode?: string;

  @IsNumber({}, { message: 'validation.create_journal_entry.exchange_rate_must_number'})
  @IsOptional()
  @Min(0, { message: 'validation.create_journal_entry.exchange_rate_cannot_negative'})
  exchangeRate?: number;

  @IsArray({ message: 'validation.create_journal_entry.entry_lines_must_array' })
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];

  @IsUUID('4', { message: 'validation.create_journal_entry.journal_id_journal_id_must_valid' })
  @IsNotEmpty({ message: 'validation.create_journal_entry.journal_id_journal_id_required' })
  journalId: string;

  @IsEnum(JournalEntryType, { message: 'validation.create_journal_entry.entry_type_entry_type_not_valid'})
  @IsOptional()
  entryType?: JournalEntryType;
}
