
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class JournalReportDto {
  @IsDateString()
  @IsNotEmpty({ message: 'validation.journal_report.start_date_required' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'validation.journal_report.end_date_required' })
  endDate: string;

  @IsArray()
  @IsUUID('4', { each: true, message: 'validation.journal_report.each_journal_id_must_valid_uuid' })
  @IsOptional()
  journalIds?: string[];

  /**
   * Which book. The tenant's default ledger when omitted.
   *
   * It used to be read as `(options as any).ledgerId` — off the DTO, so the ValidationPipe stripped
   * it before the service ever saw it, and the parameter was dead.
   */
  @IsUUID()
  @IsOptional()
  ledgerId?: string;

  /**
   * Show entries that are not posted.
   *
   * The libro diario had **no status filter at all**, so drafts, entries awaiting approval,
   * annulled entries and entries superseded by a modification all appeared in a book that is
   * legally required to contain postings. Off by default; on, it is a working aid, not the book.
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  includeUnposted?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(500, { message: 'validation.constraints.max|{"max":500}' })
  @IsOptional()
  pageSize?: number;
}