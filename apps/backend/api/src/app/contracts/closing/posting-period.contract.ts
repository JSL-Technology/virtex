import { EntityManager } from 'typeorm';

/** The accounting period a date falls in, as a subledger needs to know it before posting. */
export interface PostingPeriodState {
  name: string;
  /** The period, or its general-ledger side, is closed: nothing posts into it. */
  closed: boolean;
  /** The subledger's own side of the period is closed. */
  moduleClosed: boolean;
}

/** The subledgers whose side of a period can be closed on its own. */
export type SubledgerModule = 'inventory' | 'accounts_payable' | 'accounts_receivable';

const MODULE_COLUMN: Record<SubledgerModule, string> = {
  inventory: 'inv_status',
  accounts_payable: 'ap_status',
  accounts_receivable: 'ar_status',
};

/**
 * The period covering `isoDate`, or null when the company has none for it.
 *
 * Read by SQL rather than through Accounting's entity: Inventory, Purchasing and Sales must ask
 * whether a date is postable while a document is still a draft, and depending on Accounting to do it
 * is the edge the module map forbids (an operational module publishes facts; it does not reach into
 * the ledger).
 */
export async function postingPeriodCovering(
  manager: EntityManager,
  organizationId: string,
  isoDate: string,
  module: SubledgerModule,
): Promise<PostingPeriodState | null> {
  const column = MODULE_COLUMN[module];
  const rows: Array<{ name: string; status: string; gl_status: string; module_status: string }> = await manager.query(
    `SELECT "name", "status"::text AS status, "gl_status"::text AS gl_status, "${column}"::text AS module_status
       FROM "accounting_periods"
      WHERE "organization_id" = $1 AND "start_date" <= $2::date AND "end_date" >= $2::date
      LIMIT 1`,
    [organizationId, isoDate],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name,
    closed: row.status === 'CLOSED' || row.gl_status === 'CLOSED',
    moduleClosed: row.module_status === 'CLOSED',
  };
}
