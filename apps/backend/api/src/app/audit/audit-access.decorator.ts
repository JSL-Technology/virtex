import { SetMetadata } from '@nestjs/common';
import { ActionType } from './entities/audit-log.entity';

export const AUDIT_ACCESS_KEY = 'virtex:audit-access';

export interface AuditAccessOptions {
  /** What was looked at, as the audit trail names it: `general_ledger`, `report_606`, `payroll`. */
  entity: string;
  /** `READ` for looking at it in the product; `EXPORT` for taking a copy away. */
  action: ActionType.READ | ActionType.EXPORT;
  /**
   * Which route or query parameters identify the thing accessed — a period, a ledger, an account.
   *
   * Recorded on the row, because "somebody read a report" is not an audit trail; "somebody read
   * the general ledger of the consolidated ledger for December" is.
   */
  identifiers?: string[];
}

/**
 * Record that somebody read or exported financial data.
 *
 * Applied by hand, per endpoint, and deliberately so. An interceptor that logged every GET would
 * produce a table nobody can read and a table nobody reads is not a control — the point is that a
 * compliance officer can ask "who pulled the general ledger last quarter" and get an answer, which
 * requires the answer not to be buried under a million list refreshes.
 */
export const AuditAccess = (options: AuditAccessOptions) =>
  SetMetadata(AUDIT_ACCESS_KEY, options);
