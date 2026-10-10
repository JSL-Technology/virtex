import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * El juego de caracteres que puede llevar el nombre de una dimensión.
 *
 * No es una regla de estilo. El nombre de una dimensión se convierte en el nombre de una COLUMNA
 * de `analytical_report_data` y en un literal SQL dentro de la definición de esa vista
 * materializada (`AnalyticalReportingService.synchronizeView`), y la definición de una vista se
 * guarda expandida —no preparada—, así que el valor acaba en el texto de la sentencia.
 *
 * El servicio escapa ese literal por su cuenta, y esto es la segunda capa: mientras solo existió
 * la primera, y además de forma accidental —lo que impedía la inyección era que el saneador del
 * ALIAS lanzara al evaluar la misma plantilla de cadena, un detalle del orden de evaluación—, el
 * nombre llegaba crudo desde un DTO que solo pedía `@IsString() @IsNotEmpty()`.
 *
 * El patrón es idéntico al que `sanitizeColumnName` exige, de modo que un nombre aceptado aquí no
 * puede ser rechazado allí: eso convertía un nombre válido en un 400 al reconstruir la vista, y
 * —porque el controlador no esperaba la promesa— en la caída del proceso.
 */
export const DIMENSION_NAME_PATTERN = /^[a-zA-Z0-9_ ]+$/;
export const DIMENSION_NAME_MAX_LENGTH = 64;

/** A value's code: what a line carries. Letters, digits and `-_.`, no spaces at the ends. */
export const DIMENSION_VALUE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
export const DIMENSION_VALUE_MAX_LENGTH = 64;

export class DimensionValueDto {
  /** Present for a value that already exists. */
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DIMENSION_VALUE_MAX_LENGTH)
  @Matches(DIMENSION_VALUE_PATTERN)
  value: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** The code of the value it rolls up into, within the same dimension. */
  @IsString()
  @IsOptional()
  @MaxLength(DIMENSION_VALUE_MAX_LENGTH)
  parent?: string | null;
}

export class CreateDimensionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(DIMENSION_NAME_MAX_LENGTH)
  @Matches(DIMENSION_NAME_PATTERN, {
    message: 'validation.constraints.dimension_name',
  })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionValueDto)
  values: DimensionValueDto[];
}

/**
 * The dimension as it should be. `values`, when sent, is the whole list: a value missing from it is
 * removed — refused when lines carry it, which is what `isActive: false` is for.
 */
export class UpdateDimensionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(DIMENSION_NAME_MAX_LENGTH)
  @Matches(DIMENSION_NAME_PATTERN, {
    message: 'validation.constraints.dimension_name',
  })
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionValueDto)
  @IsOptional()
  values?: DimensionValueDto[];
}
