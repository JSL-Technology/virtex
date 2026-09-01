
import { IsDateString, IsNotEmpty } from 'class-validator';

export class RunConsolidationDto {
  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.RUN_CONSOLIDATION.FECHA_CORTE_PARA_CONSOLIDACION_OBLIGATORIA' })
  asOfDate: string;
}