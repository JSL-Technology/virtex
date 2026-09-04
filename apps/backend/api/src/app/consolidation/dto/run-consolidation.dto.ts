
import { IsDateString, IsNotEmpty, IsOptional } from 'class-validator';

export class RunConsolidationDto {
  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.RUN_CONSOLIDATION.FECHA_CORTE_PARA_CONSOLIDACION_OBLIGATORIA' })
  asOfDate: string;

  /**
   * Start of the period the consolidated income statement covers.
   *
   * Optional, defaulting to 1 January of the reporting year. NIC 21.39(b) translates income and
   * expenses at the rates ruling on the transaction dates, so a consolidated result only means
   * something over a stated period — and there was no consolidated result at all before, only a
   * statement of position.
   */
  @IsDateString()
  @IsOptional()
  startDate?: string;
}
