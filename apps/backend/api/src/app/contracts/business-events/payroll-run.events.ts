/**
 * A payroll run moved forward. Published after the commit by {@link PayrollRunService}, so a
 * listener reads a run that exists in the state the event names.
 */
export const PAYROLL_RUN_CALCULATED = 'payroll.run.calculated';
export const PAYROLL_RUN_APPROVED = 'payroll.run.approved';
export const PAYROLL_RUN_PAID = 'payroll.run.paid';

export interface PayrollRunEvent {
  organizationId: string;
  runId: string;
  name: string;
  totalNet: number;
  currencyCode: string;
  calculatedBy: string | null;
  approvedBy: string | null;
  /** Who moved it this time. */
  actorUserId: string;
}
