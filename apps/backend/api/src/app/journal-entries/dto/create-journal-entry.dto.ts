

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
  @IsUUID('4', { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.ID_LIBRO_CONTABLE_LEDGERID_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.ID_LIBRO_CONTABLE_LEDGERID_OBLIGATORIO_CADA_VALORACION' })
  ledgerId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_DEBE_NUMERO_VALIDO' })
  @IsDefined({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CAMPO_DEBITO_OBLIGATORIO' })
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_NO_PUEDE_NEGATIVO' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CREDITO_DEBE_NUMERO_VALIDO' })
  @IsDefined({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CAMPO_CREDITO_OBLIGATORIO' })
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CREDITO_NO_PUEDE_NEGATIVO' })
  credit: number;
}


export class CreateJournalEntryLineDto {
  @IsUUID('4', { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.ID_CUENTA_ACCOUNTID_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.ID_CUENTA_ACCOUNTID_OBLIGATORIO' })
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_MONEDA_TRANSACCION_DEBE_NUMERO' })
  @IsDefined({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CAMPO_DEBITO_OBLIGATORIO' })
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_NO_PUEDE_NEGATIVO' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CREDITO_MONEDA_TRANSACCION_DEBE_NUMERO' })
  @IsDefined({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CAMPO_CREDITO_OBLIGATORIO' })
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CREDITO_NO_PUEDE_NEGATIVO' })
  credit: number;

  @IsString({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DESCRIPCION_LINEA_DEBE_TEXTO' })
  @IsOptional()
  description?: string;
  
  @IsObject({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DIMENSIONES_DEBEN_OBJETO' })
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
  @Length(3, 3, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CODIGO_MONEDA_DEBE_TENER_EXACTAMENTE_3_CARACTERES' })
  currencyCode?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_MONEDA_TRANSACCION_DEBE_NUMERO' })
  @IsOptional()
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_NO_PUEDE_NEGATIVO' })
  foreignCurrencyDebit?: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CREDITO_MONEDA_TRANSACCION_DEBE_NUMERO' })
  @IsOptional()
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CREDITO_NO_PUEDE_NEGATIVO' })
  foreignCurrencyCredit?: number;

  @IsNumber({}, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.TASA_CAMBIO_DEBE_NUMERO' })
  @IsOptional()
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.TASA_CAMBIO_NO_PUEDE_NEGATIVA' })
  exchangeRate?: number;

  @IsArray({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.VALORACIONES_DEBEN_ARREGLO' })
  @ValidateNested({ each: true })
  @Type(() => LineValuationDto)
  @IsOptional()
  valuations?: LineValuationDto[];
}

export class CreateJournalEntryDto {
  @IsDateString({}, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.FECHA_DEBE_TENER_FORMATO_FECHA_ISO_8601_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.FECHA_ASIENTO_OBLIGATORIA' })
  date: string;

  @IsString({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DESCRIPCION_DEBE_TEXTO' })
  @IsNotEmpty({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.DESCRIPCION_ASIENTO_OBLIGATORIA' })
  description: string;
  
  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.CODIGO_MONEDA_DEBE_TENER_EXACTAMENTE_3_CARACTERES' })
  currencyCode?: string;

  @IsNumber({}, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.TASA_CAMBIO_DEBE_NUMERO'})
  @IsOptional()
  @Min(0, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.TASA_CAMBIO_NO_PUEDE_NEGATIVA'})
  exchangeRate?: number;

  @IsArray({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.LINEAS_ASIENTO_DEBEN_ARREGLO' })
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];

  @IsUUID('4', { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.ID_DIARIO_JOURNALID_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.CREATE_JOURNAL_ENTRY.ID_DIARIO_JOURNALID_OBLIGATORIO' })
  journalId: string;

  @IsEnum(JournalEntryType, { message: 'VALIDATION.CREATE_JOURNAL_ENTRY.TIPO_ASIENTO_ENTRYTYPE_NO_VALIDO'})
  @IsOptional()
  entryType?: JournalEntryType;
}
