
import { IsNotEmpty, IsUUID } from 'class-validator';

export class ClosePeriodDto {
  @IsUUID()
  @IsNotEmpty({ message: 'El ID del período contable es obligatorio.' })
  periodId: string;
}