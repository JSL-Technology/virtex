import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { JournalType } from '../entities/journal.entity';

export const JOURNAL_TYPES: readonly JournalType[] = ['SALES', 'PURCHASES', 'CASH', 'BANK', 'GENERAL'];

export class CreateJournalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10, { message: 'validation.constraints.max_length|{"max":10}' })
  // The code prefixes every entry number the journal issues: letters, digits, dash and underscore.
  @Matches(/^\s*[A-Za-z0-9_-]+\s*$/, { message: 'journal_entries.journal_code_format' })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'validation.constraints.max_length|{"max":100}' })
  name: string;

  @IsIn(JOURNAL_TYPES)
  @IsNotEmpty()
  type: JournalType;
}

export class UpdateJournalDto extends PartialType(CreateJournalDto) {}
