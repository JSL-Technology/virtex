/**
 * The things a plan meters.
 *
 * Two entries — invoices and users — for a product that also ships accounting, inventory, payroll,
 * manufacturing, procurement, projects and CRM. Everything outside those two was unlimited on
 * every plan, including the cheapest, which is not a pricing decision anyone made: it is what a
 * two-value enum produces when the product grows and the enum does not.
 *
 * Each value here is enforced at the point the resource is created. A value with no enforcement is
 * worse than no value at all — it appears in plan configuration, sets a customer expectation, and
 * meters nothing — so this list is deliberately exactly as long as the set of create paths that
 * call `enforceLimit`.
 */
export enum SaasResource {
  /** Sales documents issued. The headline metered resource on every plan. */
  INVOICES = 'invoices',

  /** Seats. Counted for the lifetime of the tenant, not per period. */
  USERS = 'users',

  /** Customer records. The master data that drives billing volume. */
  CUSTOMERS = 'customers',

  /** Supplier records. */
  SUPPLIERS = 'suppliers',

  /** Manual journal entries posted. The accounting-volume signal. */
  JOURNAL_ENTRIES = 'journal_entries',

  /** Legal entities under one account — group consolidation is an enterprise capability. */
  SUBSIDIARIES = 'subsidiaries',
}
