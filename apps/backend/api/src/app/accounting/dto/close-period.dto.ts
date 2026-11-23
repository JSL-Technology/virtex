import { IsBoolean, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class ClosePeriodDto {
  @IsUUID()
  @IsNotEmpty({ message: 'validation.close_period.accounting_period_id_required' })
  periodId: string;

  /**
   * Close a period that has NOT ended yet, on purpose.
   *
   * There was no check at all: «Noviembre 2026» closed on the 7th of November, and December
   * closed before it began (FIN-AC-02). A month closed early is a month whose remaining
   * operations cannot be posted at all — every sale, payment and payroll entry of the rest of it
   * is refused — and nothing said so. A real reason exists (a company that stops trading mid
   * month, a migration that opens the books on a cut-off date), so this is a door, said out loud
   * by whoever walks through it, and not a default.
   */
  @IsBoolean()
  @IsOptional()
  closeBeforeItEnds?: boolean;
}
