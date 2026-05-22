

export const PERMISSIONS = {



  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_EDIT: 'users:edit',
  USERS_DELETE: 'users:delete',
  USERS_MANAGE_STATUS: 'users:manage_status',
  USERS_IMPERSONATE: 'users:impersonate',

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


  ACCOUNTING_CLOSE_PERIOD: 'accounting:close_period',
  ACCOUNTING_REOPEN_PERIOD: 'accounting:reopen_period',
  ACCOUNTING_RUN_INFLATION_ADJUSTMENT: 'accounting:run_inflation_adjustment',
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


  WORKFLOWS_MANAGE: 'workflows:manage',


  AUDIT_VIEW_TRAIL: 'audit:view_trail',
  AUDIT_PROPOSE_ADJUSTMENT: 'audit:propose_adjustment',
  AUDIT_APPROVE_ADJUSTMENT: 'audit:approve_adjustment',


  COST_ACCOUNTING_MANAGE: 'cost_accounting:manage',


  SETTINGS_EDIT_COMPANY: 'settings:edit_company',
  SETTINGS_EDIT_BRANDING: 'settings:edit_branding',
  

  SYSTEM_MANAGE_VIEWS: 'system:manage_views',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);