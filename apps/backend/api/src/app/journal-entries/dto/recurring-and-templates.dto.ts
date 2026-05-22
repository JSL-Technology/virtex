
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsEnum,
  IsDateString,
  IsOptional,
  IsUUID,
  IsIn,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Frequency } from '../entities/recurring-journal-entry.entity';
import { CreateJournalEntryLineDto } from './create-journal-entry.dto';



class JournalEntryTemplateLineDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsIn(['DEBIT', 'CREDIT'])
  @IsNotEmpty()
  type: 'DEBIT' | 'CREDIT';
}

export class CreateJournalEntryTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalEntryTemplateLineDto)
  lines: JournalEntryTemplateLineDto[];
}

export class UpdateJournalEntryTemplateDto {
  @IsString() @IsNotEmpty() @IsOptional() name?: string;
  @IsString() @IsNotEmpty() @IsOptional() description?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalEntryTemplateLineDto)
  @IsOptional()
  lines?: JournalEntryTemplateLineDto[];
}


export class CreateJournalEntryFromTemplateDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0.01)
  amount: number;


  @IsUUID()
  @IsNotEmpty()
  journalId: string;
}



export class CreateRecurringJournalEntryDto {
  @IsString() @IsNotEmpty() description: string;


  @IsUUID() @IsNotEmpty() journalId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];
  @IsEnum(Frequency) @IsNotEmpty() frequency: Frequency;
  @IsDateString() @IsNotEmpty() startDate: string;
  @IsDateString() @IsOptional() endDate?: string;
}

export class UpdateRecurringJournalEntryDto {
  @IsString() @IsNotEmpty() @IsOptional() description?: string;
  @IsUUID() @IsOptional() journalId?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  @IsOptional()
  lines?: CreateJournalEntryLineDto[];
  @IsEnum(Frequency) @IsOptional() frequency?: Frequency;
  @IsDateString() @IsOptional() startDate?: string;
  @IsDateString() @IsOptional() endDate?: string;
}
