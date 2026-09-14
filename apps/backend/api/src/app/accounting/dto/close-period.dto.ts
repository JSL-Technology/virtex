
import { IsNotEmpty, IsUUID } from 'class-validator';

export class ClosePeriodDto {
  @IsUUID()
  @IsNotEmpty({ message: 'validation.close_period.accounting_period_id_required' })
  periodId: string;
}