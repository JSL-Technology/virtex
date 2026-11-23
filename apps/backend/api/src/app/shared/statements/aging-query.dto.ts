import { IsOptional, IsUUID } from 'class-validator';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

/**
 * The cut-off of an ageing report and, optionally, the one branch it covers — for receivables and
 * payables alike.
 *
 * Both routes read `asOfDate` as a bare query string: a timestamp, `2026-02-30` or a word went
 * straight into the date arithmetic and came back as a 500, or as a report aged against a day that
 * does not exist. Refused here, with the reason, instead.
 */
export class AgingQueryDto {
  /** `YYYY-MM-DD`; today when omitted. */
  @IsOptional()
  @IsIsoDate()
  asOfDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  branchId?: string;
}
