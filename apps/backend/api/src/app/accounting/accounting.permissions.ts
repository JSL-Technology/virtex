export const ACCOUNTING_PERMISSIONS = {
  CHART_OF_ACCOUNTS_VIEW: 'coa:view',
  CHART_OF_ACCOUNTS_CREATE: 'coa:create',
  CHART_OF_ACCOUNTS_EDIT: 'coa:edit',
  CHART_OF_ACCOUNTS_MERGE: 'coa:merge',
  CHART_OF_ACCOUNTS_IMPORT: 'coa:import',

  JOURNAL_ENTRIES_VIEW: 'journal_entries:view',
  JOURNAL_ENTRIES_CREATE: 'journal_entries:create',
  JOURNAL_ENTRIES_EDIT: 'journal_entries:edit',
  JOURNAL_ENTRIES_REVERSE: 'journal_entries:reverse',

  ACCOUNTING_VIEW: 'accounting:view',
  ACCOUNTING_CLOSE_PERIOD: 'accounting:close_period',
  ACCOUNTING_REOPEN_PERIOD: 'accounting:reopen_period',
  ACCOUNTING_RUN_INFLATION_ADJUSTMENT: 'accounting:run_inflation_adjustment',
  /** Create, edit or re-point a ledger, and the mapping rules that drive multi-GAAP postings. */
  ACCOUNTING_MANAGE_LEDGERS: 'accounting:manage_ledgers',
  /** Close a fiscal year. */
  ACCOUNTING_CLOSE_YEAR: 'accounting:close_year',
  ACCOUNTING_REOPEN_YEAR: 'accounting:reopen_year',

  AUDIT_VIEW_TRAIL: 'audit:view_trail',
  AUDIT_PROPOSE_ADJUSTMENT: 'audit:propose_adjustment',
  AUDIT_APPROVE_ADJUSTMENT: 'audit:approve_adjustment',

  /** Read the cost/profit-centre register that classifies analytical postings. */
  COST_ACCOUNTING_VIEW: 'cost_accounting:view',
  COST_ACCOUNTING_MANAGE: 'cost_accounting:manage',

  /**
   * Analytical dimensions and the rules that map them onto accounts. Editing a rule changes how
   * every future posting is classified, so it is a reporting-integrity control, not a preference.
   */
  DIMENSIONS_VIEW: 'dimensions:view',
  DIMENSIONS_MANAGE: 'dimensions:manage',

  // The fixed-asset register: what the company owns, what it cost, and what has been written off.
  FIXED_ASSETS_VIEW: 'fixed_assets:view',
  FIXED_ASSETS_MANAGE: 'fixed_assets:manage',
  FIXED_ASSETS_DISPOSE: 'fixed_assets:dispose',

  INTERCOMPANY_VIEW: 'intercompany:view',
  INTERCOMPANY_TRANSACT: 'intercompany:transact',

  // Currencies and their rates.
  CURRENCIES_VIEW: 'currencies:view',
  CURRENCIES_MANAGE: 'currencies:manage',
  EXCHANGE_RATES_MANAGE: 'exchange_rates:manage',
} as const;
