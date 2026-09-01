
import { IsDateString, IsNotEmpty, IsOptional, IsUUID, IsArray } from 'class-validator';

export class JournalReportDto {
  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.JOURNAL_REPORT.FECHA_INICIO_OBLIGATORIA' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.JOURNAL_REPORT.FECHA_FIN_OBLIGATORIA' })
  endDate: string;

  @IsArray()
  @IsUUID('4', { each: true, message: 'VALIDATION.JOURNAL_REPORT.CADA_ID_DIARIO_DEBE_UUID_VALIDO' })
  @IsOptional()
  journalIds?: string[];
}