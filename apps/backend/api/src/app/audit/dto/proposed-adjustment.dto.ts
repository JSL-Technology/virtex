
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProposedAdjustmentLineDto {
  @IsUUID('4', { message: 'El ID de la cuenta debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID de la cuenta es obligatorio en cada línea.' })
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El débito debe ser un número válido.' })
  @IsDefined({ message: 'El campo de débito es obligatorio.' })
  @Min(0, { message: 'El débito no puede ser negativo.' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El crédito debe ser un número válido.' })
  @IsDefined({ message: 'El campo de crédito es obligatorio.' })
  @Min(0, { message: 'El crédito no puede ser negativo.' })
  credit: number;

  @IsString()
  @IsNotEmpty({ message: 'La descripción de la línea no puede estar vacía.' })
  description: string;

  @IsObject()
  @IsOptional()
  dimensions?: Record<string, string>;
}

export class CreateProposedAdjustmentDto {
  @IsUUID('4', { message: 'El ID del año fiscal debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID del año fiscal es obligatorio.' })
  fiscalYearId: string;

  @IsDateString({}, { message: 'La fecha debe tener un formato ISO 8601 válido.' })
  @IsNotEmpty({ message: 'La fecha del ajuste es obligatoria.' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'La descripción principal del ajuste no puede estar vacía.' })
  description: string;

  @IsUUID('4', { message: 'El ID del diario debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El ID del diario es obligatorio.' })
  journalId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposedAdjustmentLineDto)
  lines: ProposedAdjustmentLineDto[];
}