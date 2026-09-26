
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
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

export class CreateDimensionValueDto {
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class CreateDimensionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(DIMENSION_NAME_MAX_LENGTH)
  @Matches(DIMENSION_NAME_PATTERN, {
    message: 'validation.constraints.dimension_name',
  })
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDimensionValueDto)
  values: CreateDimensionValueDto[];
}

export class UpdateDimensionValueDto {
    @IsUUID()
    @IsOptional()
    id?: string;

    @IsString()
    @IsNotEmpty()
    value: string;
}

export class UpdateDimensionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(DIMENSION_NAME_MAX_LENGTH)
  @Matches(DIMENSION_NAME_PATTERN, {
    message: 'validation.constraints.dimension_name',
  })
  @IsOptional()
  name?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateDimensionValueDto)
  @IsOptional()
  values?: UpdateDimensionValueDto[];
}
