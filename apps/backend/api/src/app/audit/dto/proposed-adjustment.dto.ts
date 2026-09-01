
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
  @IsUUID('4', { message: 'VALIDATION.PROPOSED_ADJUSTMENT.ID_CUENTA_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.ID_CUENTA_OBLIGATORIO_CADA_LINEA' })
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.PROPOSED_ADJUSTMENT.DEBITO_DEBE_NUMERO_VALIDO' })
  @IsDefined({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.CAMPO_DEBITO_OBLIGATORIO' })
  @Min(0, { message: 'VALIDATION.PROPOSED_ADJUSTMENT.DEBITO_NO_PUEDE_NEGATIVO' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.PROPOSED_ADJUSTMENT.CREDITO_DEBE_NUMERO_VALIDO' })
  @IsDefined({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.CAMPO_CREDITO_OBLIGATORIO' })
  @Min(0, { message: 'VALIDATION.PROPOSED_ADJUSTMENT.CREDITO_NO_PUEDE_NEGATIVO' })
  credit: number;

  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.DESCRIPCION_LINEA_NO_PUEDE_ESTAR_VACIA' })
  description: string;

  @IsObject()
  @IsOptional()
  dimensions?: Record<string, string>;
}

export class CreateProposedAdjustmentDto {
  @IsUUID('4', { message: 'VALIDATION.PROPOSED_ADJUSTMENT.ID_ANO_FISCAL_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.ID_ANO_FISCAL_OBLIGATORIO' })
  fiscalYearId: string;

  @IsDateString({}, { message: 'VALIDATION.PROPOSED_ADJUSTMENT.FECHA_DEBE_TENER_FORMATO_ISO_8601_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.FECHA_AJUSTE_OBLIGATORIA' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.DESCRIPCION_PRINCIPAL_AJUSTE_NO_PUEDE_ESTAR_VACIA' })
  description: string;

  @IsUUID('4', { message: 'VALIDATION.PROPOSED_ADJUSTMENT.ID_DIARIO_DEBE_UUID_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.PROPOSED_ADJUSTMENT.ID_DIARIO_OBLIGATORIO' })
  journalId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposedAdjustmentLineDto)
  lines: ProposedAdjustmentLineDto[];
}