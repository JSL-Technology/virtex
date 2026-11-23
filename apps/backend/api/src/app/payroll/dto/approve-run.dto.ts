import { IsBoolean, IsOptional } from 'class-validator';

/** Approving a run. */
export class ApprovePayrollRunDto {
  /**
   * The approver saw the unusual inputs the calculation flagged (audit 2026-11-07, NOM-05). A run
   * with any is not approved without it.
   */
  @IsBoolean()
  @IsOptional()
  acknowledgeWarnings?: boolean;
}
