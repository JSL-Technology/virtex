

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
  @IsUUID('4', { message: 'El ID del libro contable (ledgerId) debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID del libro contable (ledgerId) es obligatorio en cada valoración.' })
  ledgerId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El débito debe ser un número válido.' })
  @IsDefined({ message: 'El campo de débito es obligatorio.' })
  @Min(0, { message: 'El débito no puede ser negativo.' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El crédito debe ser un número válido.' })
  @IsDefined({ message: 'El campo de crédito es obligatorio.' })
  @Min(0, { message: 'El crédito no puede ser negativo.' })
  credit: number;
}


export class CreateJournalEntryLineDto {
  @IsUUID('4', { message: 'El ID de la cuenta (accountId) debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID de la cuenta (accountId) es obligatorio.' })
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El débito en moneda de transacción debe ser un número.' })
  @IsDefined({ message: 'El campo de débito es obligatorio.' })
  @Min(0, { message: 'El débito no puede ser negativo.' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El crédito en moneda de transacción debe ser un número.' })
  @IsDefined({ message: 'El campo de crédito es obligatorio.' })
  @Min(0, { message: 'El crédito no puede ser negativo.' })
  credit: number;

  @IsString({ message: 'La descripción de la línea debe ser un texto.' })
  @IsOptional()
  description?: string;
  
  @IsObject({ message: 'Las dimensiones deben ser un objeto.' })
  @IsOptional()
  dimensions?: Record<string, string>;

  @IsArray({ message: 'Las valoraciones deben ser un arreglo.' })
  @ValidateNested({ each: true })
  @Type(() => LineValuationDto)
  @IsOptional()
  valuations?: LineValuationDto[];
}

export class CreateJournalEntryDto {
  @IsDateString({}, { message: 'La fecha debe tener un formato de fecha ISO 8601 válido.' })
  @IsNotEmpty({ message: 'La fecha del asiento es obligatoria.' })
  date: string;

  @IsString({ message: 'La descripción debe ser un texto.' })
  @IsNotEmpty({ message: 'La descripción del asiento es obligatoria.' })
  description: string;
  
  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'El código de moneda debe tener exactamente 3 caracteres.' })
  currencyCode?: string;

  @IsNumber({}, { message: 'La tasa de cambio debe ser un número.'})
  @IsOptional()
  @Min(0, { message: 'La tasa de cambio no puede ser negativa.'})
  exchangeRate?: number;

  @IsArray({ message: 'Las líneas del asiento deben ser un arreglo.' })
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];

  @IsUUID('4', { message: 'El ID del diario (journalId) debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID del diario (journalId) es obligatorio.' })
  journalId: string;

  @IsEnum(JournalEntryType, { message: 'El tipo de asiento (entryType) no es válido.'})
  @IsOptional()
  entryType?: JournalEntryType;
}
