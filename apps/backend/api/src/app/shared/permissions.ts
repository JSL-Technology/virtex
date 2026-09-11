

export const PERMISSIONS = {



  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_EDIT: 'users:edit',
  USERS_DELETE: 'users:delete',
  USERS_MANAGE_STATUS: 'users:manage_status',
  USERS_IMPERSONATE: 'users:impersonate',
  USERS_PASSWORD_RESET: 'users:password_reset',
  USERS_FORCE_LOGOUT: 'users:force_logout',
  USERS_SESSIONS_REVOKE: 'users:sessions_revoke',

  ROLES_VIEW: 'roles:view',
  ROLES_CREATE: 'roles:create',
  ROLES_EDIT: 'roles:edit',
  ROLES_DELETE: 'roles:delete',




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

  /**
   * Accounts payable and receivable, treasury and bank reconciliation.
   *
   * These four modules carried no permission at all: 59 of 85 finance routes were reachable by any
   * authenticated member of the tenant. That included moving funds between accounts, uploading and
   * reconciling a bank statement, approving and voiding supplier invoices, running the year-end
   * close, and editing the chart of accounts. The irony was that manual journal entries were fully
   * protected while recurring entries — which the scheduler posts unattended — were not, so the
   * control on posting was bypassed by scheduling one.
   */
  ACCOUNTS_PAYABLE_VIEW: 'accounts_payable:view',
  ACCOUNTS_PAYABLE_CREATE: 'accounts_payable:create',
  ACCOUNTS_PAYABLE_EDIT: 'accounts_payable:edit',
  ACCOUNTS_PAYABLE_APPROVE: 'accounts_payable:approve',
  ACCOUNTS_PAYABLE_VOID: 'accounts_payable:void',
  ACCOUNTS_PAYABLE_PAY: 'accounts_payable:pay',

  ACCOUNTS_RECEIVABLE_VIEW: 'accounts_receivable:view',
  ACCOUNTS_RECEIVABLE_COLLECT: 'accounts_receivable:collect',
  ACCOUNTS_RECEIVABLE_VOID: 'accounts_receivable:void',

  TREASURY_VIEW: 'treasury:view',
  TREASURY_MANAGE_ACCOUNTS: 'treasury:manage_accounts',
  TREASURY_TRANSFER: 'treasury:transfer',

  RECONCILIATION_VIEW: 'reconciliation:view',
  RECONCILIATION_IMPORT: 'reconciliation:import',
  RECONCILIATION_MATCH: 'reconciliation:match',
  RECONCILIATION_MANAGE_RULES: 'reconciliation:manage_rules',

  BUDGETS_VIEW: 'budgets:view',
  BUDGETS_MANAGE: 'budgets:manage',
  FINANCIALS_CONSOLIDATE: 'financials:consolidate',





  INVOICES_VIEW: 'invoices:view',
  INVOICES_CREATE: 'invoices:create',
  INVOICES_EDIT: 'invoices:edit',
  INVOICES_VOID: 'invoices:void',

  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_EDIT: 'customers:edit',
  CUSTOMERS_DELETE: 'customers:delete',


  BILLS_VIEW: 'bills:view',
  BILLS_CREATE: 'bills:create',
  BILLS_EDIT: 'bills:edit',
  BILLS_APPROVE: 'bills:approve',


  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_EDIT: 'products:edit',
  PRODUCTS_DELETE: 'products:delete',
  INVENTORY_VIEW_STOCK: 'inventory:view_stock',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_TRANSFER: 'inventory:transfer',





  PRICE_LISTS_VIEW: 'price_lists:view',
  PRICE_LISTS_CREATE: 'price_lists:create',
  PRICE_LISTS_EDIT: 'price_lists:edit',
  PRICE_LISTS_DELETE: 'price_lists:delete',


  TAXES_VIEW: 'taxes:view',
  TAXES_CREATE: 'taxes:create',
  TAXES_EDIT: 'taxes:edit',
  TAXES_DELETE: 'taxes:delete',


  REPORTS_VIEW_SALES: 'reports:view_sales',
  REPORTS_VIEW_FINANCIAL: 'reports:view_financial',
  REPORTS_BUILDER_MANAGE: 'reports:builder_manage',


  /** Read the employee register. The HCM module existed with no permission gating it at all. */
  HCM_VIEW: 'hcm:view',

  WORKFLOWS_MANAGE: 'workflows:manage',
  /**
   * Deciding an approval request.
   *
   * Separate from `WORKFLOWS_MANAGE`, which configures the policies: whoever writes the rules is
   * not automatically whoever applies them. `POST /workflows/approve/:id` and `.../reject/:id`
   * carried NO permission at all — only `JwtAuthGuard` — so any authenticated user of any tenant
   * could decide any request in the system. Holding this is necessary but not sufficient: the
   * step's own role is still checked, and a submitter still cannot approve their own request.
   */
  WORKFLOWS_DECIDE: 'workflows:decide',


  AUDIT_VIEW_TRAIL: 'audit:view_trail',
  AUDIT_PROPOSE_ADJUSTMENT: 'audit:propose_adjustment',
  AUDIT_APPROVE_ADJUSTMENT: 'audit:approve_adjustment',


  COST_ACCOUNTING_MANAGE: 'cost_accounting:manage',

  INTERCOMPANY_VIEW: 'intercompany:view',
  INTERCOMPANY_TRANSACT: 'intercompany:transact',

  // The fixed-asset register: what the company owns, what it cost, and what has been written off
  // it. `FixedAssetsController` declared no permission at all, so acquiring, revaluing and
  // disposing of assets — each of which posts to the ledger — were open to any authenticated user.
  FIXED_ASSETS_VIEW: 'fixed_assets:view',
  FIXED_ASSETS_MANAGE: 'fixed_assets:manage',
  FIXED_ASSETS_DISPOSE: 'fixed_assets:dispose',

  // Currencies and their rates. Rates are deliberately shared across tenants — what a currency was
  // worth on a day is a fact about the market — which is exactly why writing one cannot be open:
  // `POST /exchange-rates/update` had no permission and rewrote the table every tenant reads.
  CURRENCIES_VIEW: 'currencies:view',
  CURRENCIES_MANAGE: 'currencies:manage',
  EXCHANGE_RATES_MANAGE: 'exchange_rates:manage',


  SETTINGS_EDIT_COMPANY: 'settings:edit_company',
  SETTINGS_EDIT_BRANDING: 'settings:edit_branding',

  /**
   * Read the tenant's subscription, payment method and invoice history.
   *
   * The billing routes carried no permission at all — only `JwtAuthGuard` — so the plan, the
   * subscription status, the card's last four digits and every invoice were readable by any
   * authenticated member, including a Seller or a Member whose role grants two view permissions.
   * Commercial terms are not team-wide information.
   */
  BILLING_VIEW: 'billing:view',
  /** Start a checkout, reconcile one, or open the Stripe portal. */
  BILLING_MANAGE: 'billing:manage',
  

  SYSTEM_MANAGE_VIEWS: 'system:manage_views',

  /**
   * Everything below closes the second half of the same hole.
   *
   * Making `PermissionsGuard` an APP_GUARD turned "declares nothing" from allow into deny, which
   * surfaced 102 route handlers that had never stated a requirement. Most were self-service and
   * now say so with @AuthenticatedOnly. These are the rest: routes that read or write tenant
   * business data and simply had no permission to declare, because the permission did not exist.
   */

  /** The finance dashboard: ten KPI endpoints over the ledger, plus the consolidated cash flow. */
  DASHBOARD_VIEW: 'dashboard:view',

  /**
   * Supplier master data. `SuppliersController` carried no permission, so any authenticated member
   * could create, edit or delete a supplier — the counterparty every payable is owed to, and the
   * bank details a payment run reads.
   */
  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_EDIT: 'suppliers:edit',
  SUPPLIERS_DELETE: 'suppliers:delete',

  /** Units of measure. Shared by products, invoice lines and stock movements. */
  UNITS_OF_MEASURE_VIEW: 'units_of_measure:view',
  UNITS_OF_MEASURE_MANAGE: 'units_of_measure:manage',

  /**
   * Analytical dimensions and the rules that map them onto accounts. Editing a rule changes how
   * every future posting is classified, so it is a reporting-integrity control, not a preference.
   */
  DIMENSIONS_VIEW: 'dimensions:view',
  DIMENSIONS_MANAGE: 'dimensions:manage',

  /** Ad-hoc reporting books built over live ERP data, and the variables they resolve. */
  DATASHEETS_VIEW: 'datasheets:view',
  DATASHEETS_MANAGE: 'datasheets:manage',

  /** Production orders. */
  MANUFACTURING_VIEW: 'manufacturing:view',
  MANUFACTURING_MANAGE: 'manufacturing:manage',

  /** The pre-sale pipeline: leads, opportunities and their conversion into a quote or invoice. */
  CRM_VIEW: 'crm:view',
  CRM_MANAGE: 'crm:manage',

  /** Support cases raised against the tenant. */
  CASES_VIEW: 'cases:view',

  /**
   * The analytical store: arbitrary queries and materialised-view maintenance. A query here can
   * read across modules, which is precisely why it cannot inherit the caller's module permissions
   * by accident.
   */
  ANALYTICS_QUERY: 'analytics:query',
  ANALYTICS_MANAGE_VIEWS: 'analytics:manage_views',

  /** Aggregated sales intelligence. */
  BI_VIEW: 'bi:view',

  /**
   * The customer portal.
   *
   * Held separately from the internal permissions because the portal is meant for a person who is
   * NOT staff of the tenant, and the routes do not yet honour that: `my-invoices` returns every
   * invoice of the organization rather than the caller's own, and `my-cases` does the same. Until
   * an external identity exists that is scoped to one customer, this permission is what keeps the
   * routes from being open, and it is granted to nobody by default.
   */
  CUSTOMER_PORTAL_ACCESS: 'customer_portal:access',

  /**
   * The extensions marketplace and sandbox ("virtual machine for extensions").
   *
   * `MANAGE` is the privileged one: it admits/revokes catalogue entries and reads usage billing,
   * so it runs the admission pipeline and signs artefacts. `INSTALL` is a tenant-level act — it
   * grants an extension the capabilities it may use against that tenant's data. `EXECUTE` runs an
   * admitted, consented extension in the isolate. They are separate because a person who may run an
   * extension is not necessarily one who may admit new code into the platform.
   */
  EXTENSIONS_VIEW: 'extensions:view',
  EXTENSIONS_INSTALL: 'extensions:install',
  EXTENSIONS_EXECUTE: 'extensions:execute',
  EXTENSIONS_MANAGE: 'extensions:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);