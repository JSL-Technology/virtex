
import { IsDateString, IsNotEmpty, IsOptional, IsUUID, IsArray } from 'class-validator';

export class JournalReportDto {
  @IsDateString()
  @IsNotEmpty({ message: 'La fecha de inicio es obligatoria.' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'La fecha de fin es obligatoria.' })
  endDate: string;

  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada ID de diario debe ser un UUID válido.' })
  @IsOptional()
  journalIds?: string[];
}