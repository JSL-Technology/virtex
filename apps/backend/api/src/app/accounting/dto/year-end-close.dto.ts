import { IsNotEmpty, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class YearEndCloseDto {
  @IsUUID()
  @IsNotEmpty({ message: 'validation.year_end_close.fiscal_year_id_required' })
  fiscalYearId: string;

  /**
   * `retainedEarningsAccountId` used to be required here and was never read.
   *
   * The close resolves the account from `OrganizationSettings`, which is derived from the
   * `RETAINED_EARNINGS` role at provisioning — so the field forced every caller to supply a uuid
   * that the service ignored, and a caller that supplied the *wrong* account was told nothing.
   * Where the result is transferred is a property of the chart of accounts, not of one close.
   */
}

export class ReopenFiscalYearDto {
  @IsUUID()
  @IsNotEmpty()
  fiscalYearId: string;

  /**
   * Why the year is being reopened.
   *
   * Recorded on the audit row and on the reversal entry's description. Reopening a settled year is
   * the single most consequential thing an accountant can do to a closed book; a reason is the
   * minimum an auditor will ask for, so it is required rather than optional.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'validation.constraints.min_length|{"min":10}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
