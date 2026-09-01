
import { IsNotEmpty, IsUUID } from 'class-validator';

export class ClosePeriodDto {
  @IsUUID()
  @IsNotEmpty({ message: 'VALIDATION.CLOSE_PERIOD.ID_PERIODO_CONTABLE_OBLIGATORIO' })
  periodId: string;
}