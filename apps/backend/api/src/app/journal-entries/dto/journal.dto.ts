import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { JournalType } from '../entities/journal.entity';
import { IsLocalizedName } from '../../common/validators/is-localized-name.validator';
import type { LocalizedName } from '@virtex/shared/types';

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

  /**
   * The name in other languages — `{ en: 'Sales journal' }` — for whoever reads it in one of them.
   * The books language is not among them: `name` is that one, the record. An empty text removes a
   * language; a language left out keeps what it had.
   */
  @IsOptional()
  @IsLocalizedName()
  nameTranslations?: LocalizedName;

  @IsIn(JOURNAL_TYPES)
  @IsNotEmpty()
  type: JournalType;
}

export class UpdateJournalDto extends PartialType(CreateJournalDto) {}
