
import { IsString, IsNotEmpty, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GeneralLedgerReportDto } from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';

export class GenerateReportDto {
  @IsString()
  @IsNotEmpty()
  reportType: 'general-ledger' | 'journal' | 'aging-report';

  @IsObject()
  @IsNotEmpty()
  @ValidateNested()
  @Type((options) => {


      if (options && options.object) {
        const dto = options.object as GenerateReportDto;
        if (dto.reportType === 'general-ledger') {
          return GeneralLedgerReportDto;
        }
        if (dto.reportType === 'journal') {
          return JournalReportDto;
        }
      }

      return Object;

  })
  options: GeneralLedgerReportDto | JournalReportDto | any;

  @IsString()
  @IsOptional()
  outputFormat?: 'json' | 'pdf' | 'csv' = 'json';
}