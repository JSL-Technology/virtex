import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The reason a bill is being annulled.
 *
 * It used to arrive as `@Body('reason') reason: string`. Extracting a single primitive from the
 * body bypasses the global `ValidationPipe` entirely, so a void could be recorded with no reason at
 * all, or with an object where a string was expected. An annulment is a permanent accounting act
 * and the reason is the only explanation the ledger will ever carry for it.
 */
export class VoidVendorBillDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  /**
   * The date the reversal is booked on. Today when omitted.
   *
   * A bill annulled in April that was booked in March reverses in April, not in March — the March
   * period is closed and rewriting it would change a reported month. But an annulment discovered
   * during the close, before the month is locked, belongs in the month it corrects, so the date is
   * the caller's to state.
   */
  @IsDateString()
  @IsOptional()
  reversalDate?: string;
}
