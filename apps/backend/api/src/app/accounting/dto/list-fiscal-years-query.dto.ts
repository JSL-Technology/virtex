import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FiscalYearStatus } from '../entities/fiscal-year.entity';

/** Filter for `GET /accounting/fiscal-years`. */
export class ListFiscalYearsQueryDto {
  @ApiPropertyOptional({
    enum: FiscalYearStatus,
    description: 'Restringe a los años en ese estado (abiertos, cerrados o archivados).',
  })
  @IsEnum(FiscalYearStatus)
  @IsOptional()
  status?: FiscalYearStatus;
}
