
import { IsDateString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsArray, IsString } from 'class-validator';

export class GeneralLedgerReportDto {
  @IsUUID()
  @IsNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.ID_LIBRO_CONTABLE_OBLIGATORIO' })
  ledgerId: string;

  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.FECHA_INICIO_OBLIGATORIA' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'VALIDATION.GENERAL_LEDGER_REPORT.FECHA_FIN_OBLIGATORIA' })
  endDate: string;

  @IsArray()
  @IsUUID('4', { each: true, message: 'VALIDATION.GENERAL_LEDGER_REPORT.CADA_ID_CUENTA_DEBE_UUID_VALIDO' })
  @IsOptional()
  accountIds?: string[];

  @IsBoolean()
  @IsOptional()
  includeDrafts?: boolean = false;

  @IsString()
  @IsOptional()
  sortBy: 'date' | 'account' = 'date';
}