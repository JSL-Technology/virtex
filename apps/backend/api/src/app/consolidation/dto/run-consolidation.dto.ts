
import { IsDateString, IsNotEmpty } from 'class-validator';

export class RunConsolidationDto {
  @IsDateString()
  @IsNotEmpty({ message: 'La fecha de corte para la consolidación es obligatoria.' })
  asOfDate: string;
}