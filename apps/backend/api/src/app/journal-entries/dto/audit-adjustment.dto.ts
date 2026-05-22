
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNotEmpty, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CreateJournalEntryLineDto } from './create-journal-entry.dto';

export class CreateAuditAdjustmentDto {
  @IsUUID()
  @IsNotEmpty()
  fiscalYearId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsUUID()
  @IsNotEmpty()
  journalId: string;
  
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];
}