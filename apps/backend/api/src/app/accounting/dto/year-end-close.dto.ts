
import { IsNotEmpty, IsUUID } from 'class-validator';

export class YearEndCloseDto {
  @IsUUID()
  @IsNotEmpty({ message: 'El ID del año fiscal es obligatorio.' })
  fiscalYearId: string;

  @IsUUID()
  @IsNotEmpty({ message: 'La cuenta de Ganancias Retenidas es obligatoria.' })
  retainedEarningsAccountId: string;
}