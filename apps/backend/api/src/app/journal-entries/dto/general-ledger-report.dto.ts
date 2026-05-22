
import { IsDateString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsArray, IsString } from 'class-validator';

export class GeneralLedgerReportDto {
  @IsUUID()
  @IsNotEmpty({ message: 'El ID del libro contable es obligatorio.' })
  ledgerId: string;

  @IsDateString()
  @IsNotEmpty({ message: 'La fecha de inicio es obligatoria.' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'La fecha de fin es obligatoria.' })
  endDate: string;

  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada ID de cuenta debe ser un UUID válido.' })
  @IsOptional()
  accountIds?: string[];

  @IsBoolean()
  @IsOptional()
  includeDrafts?: boolean = false;

  @IsString()
  @IsOptional()
  sortBy: 'date' | 'account' = 'date';
}