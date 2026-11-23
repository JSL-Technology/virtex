import { SaasResource } from './enums/saas-resource.enum';

/**
 * Where each metered resource is counted from: the rows themselves.
 *
 * A lifetime quota is a count of what exists, and it is ENFORCED and SHOWN from these counts —
 * there is no counter for it. A counter started at zero whatever the tenant already had and had to
 * be «released» by every deletion; a screen reading it showed 0 customers to a tenant with hundreds
 * (QA M-10), and enforcement let a tenant past its plan. Each query runs on the caller's connection,
 * inside the tenant's context: under the row-level policies, outside it, it counts nothing.
 */
export const LIFETIME_USAGE_SOURCES: ReadonlyArray<{ resource: SaasResource; sql: string }> = [
  {
    resource: SaasResource.USERS,
    sql: 'SELECT COUNT(*)::int AS n FROM user_organizations WHERE organization_id = $1',
  },
  {
    resource: SaasResource.CUSTOMERS,
    sql: 'SELECT COUNT(*)::int AS n FROM customers WHERE organization_id = $1',
  },
  {
    resource: SaasResource.SUPPLIERS,
    sql: 'SELECT COUNT(*)::int AS n FROM suppliers WHERE organization_id = $1',
  },
  {
    resource: SaasResource.SUBSIDIARIES,
    sql: 'SELECT COUNT(*)::int AS n FROM organization_subsidiaries WHERE parent_organization_id = $1',
  },
];

/**
 * Activity within a quota period: `$2` and `$3` bound the window, half-open.
 *
 * Sales documents created (draft or issued: the quota is consumed when one is created), and
 * journal entries written by hand — the accounting-volume signal; the ones the system posts on
 * its own are not the tenant's activity.
 */
export const PERIOD_USAGE_SOURCES: ReadonlyArray<{ resource: SaasResource; sql: string }> = [
  {
    resource: SaasResource.INVOICES,
    sql: 'SELECT COUNT(*)::int AS n FROM invoices WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3',
  },
  {
    resource: SaasResource.JOURNAL_ENTRIES,
    sql: `SELECT COUNT(*)::int AS n FROM journal_entries
           WHERE organization_id = $1 AND "entryType" = 'MANUAL' AND created_at >= $2 AND created_at < $3`,
  },
  {
    // Credits consumed by calls to a language model. A refused or failed call is recorded with the
    // credits it was charged, so this is the same number the gateway enforced against.
    resource: SaasResource.AI_CREDITS,
    sql: 'SELECT COALESCE(SUM(credits), 0)::int AS n FROM ai_requests WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3',
  },
];
