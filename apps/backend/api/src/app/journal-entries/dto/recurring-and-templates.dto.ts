
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsEnum,
  IsOptional,
  IsUUID,
  IsIn,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  IsObject,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';
import { Type } from 'class-transformer';
import { Frequency } from '../entities/recurring-journal-entry.entity';
import { CreateJournalEntryLineDto } from './create-journal-entry.dto';



export class JournalEntryTemplateLineDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsIn(['DEBIT', 'CREDIT'])
  @IsNotEmpty()
  type: 'DEBIT' | 'CREDIT';

  /**
   * The share of the amount this line takes on its side, in percent. Omitted on every line of a
   * side, the amount is split equally among them.
   */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'validation.constraints.min|{"min":0.0001}' })
  @Max(100, { message: 'validation.constraints.max|{"max":100}' })
  @IsOptional()
  percentage?: number;

  @IsObject()
  @IsOptional()
  dimensions?: Record<string, string>;
}

export class CreateJournalEntryTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsArray()
  @ArrayMinSize(2)
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
  @IsIsoDate()
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
  @IsString() @IsNotEmpty() @MaxLength(500) description: string;


  @IsUUID() @IsNotEmpty() journalId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];
  @IsEnum(Frequency) @IsNotEmpty() frequency: Frequency;
  @IsIsoDate() @IsNotEmpty() startDate: string;
  @IsIsoDate() @IsOptional() endDate?: string | null;
  @IsBoolean() @IsOptional() isActive?: boolean;
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
  @IsIsoDate() @IsOptional() startDate?: string;
  /** `null` removes the end date: the entry runs until it is paused or deleted. */
  @IsIsoDate() @IsOptional() endDate?: string | null;
  /** Pause or resume. */
  @IsBoolean() @IsOptional() isActive?: boolean;
}
