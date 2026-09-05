import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * The parameters of a general-ledger request, validated.
 *
 * They used to arrive as four bare `@Query()` strings. A bare query parameter never reaches the
 * global `ValidationPipe`, so `startDate` could be anything at all — and `new Date('abc')` produces
 * an Invalid Date whose `toISOString()` throws `RangeError`, answering 500 where 400 was the whole
 * of the problem. `accountId` was not even checked for being a uuid, so a malformed one reached
 * Postgres as a type error.
 */
export class GeneralLedgerQueryDto {
  @IsUUID()
  accountId: string;

  @IsDateString({}, { message: 'VALIDATION.CONSTRAINTS.IS_DATE_STRING' })
  startDate: string;

  @IsDateString({}, { message: 'VALIDATION.CONSTRAINTS.IS_DATE_STRING' })
  endDate: string;

  /** Which book. The tenant's default ledger when omitted. */
  @IsUUID()
  @IsOptional()
  ledgerId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  pageSize?: number;

  /**
   * Show entries that are not posted.
   *
   * A working aid for an accountant reviewing their own drafts before a close, never the legal
   * book. Off unless asked for — the previous implementation had no filter at all, so drafts,
   * annulled entries and superseded ones were always in the ledger and it disagreed with every
   * other report in the product.
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  includeUnposted?: boolean;
}
