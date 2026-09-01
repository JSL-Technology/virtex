

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
