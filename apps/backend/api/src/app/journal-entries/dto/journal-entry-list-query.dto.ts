import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';
import { JournalEntryStatus } from '../entities/journal-entry.entity';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** The columns the journal-entry list can be ordered by (QA B-01). */
export const JOURNAL_ENTRY_LIST_SORT = ['date', 'entryNumber', 'description', 'status'] as const;
export type JournalEntryListSort = (typeof JOURNAL_ENTRY_LIST_SORT)[number];

export class JournalEntryListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(JOURNAL_ENTRY_LIST_SORT)
  sort?: JournalEntryListSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

  /**
   * The daybook is read by date range (QA M-21). Without these the journal could only be paged
   * from the newest entry back, so finding last March meant clicking through every entry since.
   */
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @IsOptional()
  @IsIsoDate()
  to?: string;

  @IsOptional()
  @IsEnum(JournalEntryStatus)
  status?: JournalEntryStatus;

  /** Matches the entry number or the description. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
