import { IsIn, IsOptional } from 'class-validator';
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
}
