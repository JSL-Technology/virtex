import { SaasResource } from './enums/saas-resource.enum';

/**
 * Where each metered resource is counted from: the rows themselves.
 *
 * Lifetime quotas are a count of what exists. The counters in `saas_usage_metrics` are corrected
 * to these by the nightly reconciliation, and nothing increments them when a customer, supplier
 * or member is created — so a screen reading the counter showed 0 customers to a tenant with
 * hundreds until the next night (QA M-10). The billing screen reads these instead.
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
];
