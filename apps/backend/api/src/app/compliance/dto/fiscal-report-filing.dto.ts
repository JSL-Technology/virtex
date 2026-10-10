import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

/** The year whose filing calendar is read. */
export class FiscalReportFilingsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000, { message: 'validation.constraints.min|{"min":2000}' })
  @Max(2100, { message: 'validation.constraints.max|{"max":2100}' })
  year: number;
}

/** A filing declared to the authority: the acknowledgement it returned. */
export class MarkFiscalReportSubmittedDto {
  /** Número de acuse de recibo / trámite, as the authority's portal shows it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  reference: string;
}
