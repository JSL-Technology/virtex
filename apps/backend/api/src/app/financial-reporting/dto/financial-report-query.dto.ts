import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

/**
 * Query parameters for the four financial statements.
 *
 * ## What these replace
 *
 * The four routes took bare `@Query()` strings and turned them into dates in the controller body:
 * `new Date(asOfDate)` with nothing checking `asOfDate` first. Three consequences, all reachable
 * from a URL:
 *
 * 1. `?asOfDate=nonsense` produced an `Invalid Date`, which reached `toIsoDate` and threw a plain
 *    `DateFormatError` — reported to the caller as **500 Internal Server Error**, and logged as if
 *    the reporting engine had crashed.
 * 2. `?startDate=2026-12-31&endDate=2026-01-01` was accepted, and the statement came back full of
 *    zeroes with nothing saying the range was inverted.
 * 3. No DTO meant no `forbidNonWhitelisted`, so a misspelled parameter — `?ledger_id=…` — was
 *    silently ignored and the report ran against the wrong ledger.
 */
export class BalanceSheetQueryDto {
  /** Cut-off. Defaults to today in the tenant's own time zone. */
  @ApiPropertyOptional({ description: 'Fecha de corte (AAAA-MM-DD). Por defecto, hoy en la zona horaria del inquilino.' })
  @IsIsoDate()
  @IsOptional()
  asOfDate?: string;

  @ApiPropertyOptional({ description: 'Libro contable. Por defecto, el principal.' })
  @IsUUID()
  @IsOptional()
  ledgerId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por centro de costo.' })
  @IsUUID()
  @IsOptional()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por proyecto.' })
  @IsUUID()
  @IsOptional()
  projectId?: string;
}

/** A period, both ends optional and both ends inclusive. */
export class PeriodQueryDto {
  @ApiPropertyOptional({ description: 'Inicio del período (AAAA-MM-DD). Por defecto, el primer día del ejercicio fiscal en curso.' })
  @IsIsoDate()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Fin del período (AAAA-MM-DD). Por defecto, hoy en la zona horaria del inquilino.' })
  @IsIsoDate()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Libro contable. Por defecto, el principal.' })
  @IsUUID()
  @IsOptional()
  ledgerId?: string;
}

/** A period that can also be narrowed by analytical dimension. */
export class DimensionalPeriodQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por centro de costo.' })
  @IsUUID()
  @IsOptional()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por proyecto.' })
  @IsUUID()
  @IsOptional()
  projectId?: string;
}
