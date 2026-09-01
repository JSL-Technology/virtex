
import { IsNotEmpty, IsUUID } from 'class-validator';

export class YearEndCloseDto {
  @IsUUID()
  @IsNotEmpty({ message: 'VALIDATION.YEAR_END_CLOSE.ID_ANO_FISCAL_OBLIGATORIO' })
  fiscalYearId: string;

  @IsUUID()
  @IsNotEmpty({ message: 'VALIDATION.YEAR_END_CLOSE.CUENTA_GANANCIAS_RETENIDAS_OBLIGATORIA' })
  retainedEarningsAccountId: string;
}