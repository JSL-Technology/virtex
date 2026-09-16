export const CONFIG_PERMISSIONS = {
  TAXES_VIEW: 'taxes:view',
  TAXES_CREATE: 'taxes:create',
  TAXES_EDIT: 'taxes:edit',
  TAXES_DELETE: 'taxes:delete',

  SETTINGS_EDIT_COMPANY: 'settings:edit_company',
  SETTINGS_EDIT_BRANDING: 'settings:edit_branding',

  /**
   * Read the tenant's subscription, payment method and invoice history.
   *
   * The billing routes carried no permission at all — only `JwtAuthGuard` — so the plan, the
   * subscription status, the card's last four digits and every invoice were readable by any
   * authenticated member, including a Seller or a Member whose role grants two view permissions.
   */
  BILLING_VIEW: 'billing:view',
  /** Start a checkout, reconcile one, or open the Stripe portal. */
  BILLING_MANAGE: 'billing:manage',

  SYSTEM_MANAGE_VIEWS: 'system:manage_views',

  /** The finance dashboard: ten KPI endpoints over the ledger, plus the consolidated cash flow. */
  DASHBOARD_VIEW: 'dashboard:view',

  WORKFLOWS_MANAGE: 'workflows:manage',
  /**
   * Deciding an approval request.
   *
   * Separate from `WORKFLOWS_MANAGE`, which configures the policies: whoever writes the rules is
   * not automatically whoever applies them.
   */
  WORKFLOWS_DECIDE: 'workflows:decide',

  /**
   * The document repository: the tenant's own files and the templates among them.
   */
  DOCUMENTS_VIEW: 'documents:view',
  DOCUMENTS_MANAGE: 'documents:manage',

  /** Projects, their tasks and timesheets. */
  PROJECTS_VIEW: 'projects:view',
  PROJECTS_MANAGE: 'projects:manage',

  /** The pre-sale pipeline: leads, opportunities and their conversion into a quote or invoice. */
  CRM_VIEW: 'crm:view',
  CRM_MANAGE: 'crm:manage',

  /** Support cases raised against the tenant. */
  CASES_VIEW: 'cases:view',

  /**
   * The customer portal.
   *
   * Held separately from the internal permissions because the portal is meant for a person who is
   * NOT staff of the tenant.
   */
  CUSTOMER_PORTAL_ACCESS: 'customer_portal:access',

  /**
   * The extensions marketplace and sandbox ("virtual machine for extensions").
   */
  EXTENSIONS_VIEW: 'extensions:view',
  EXTENSIONS_INSTALL: 'extensions:install',
  EXTENSIONS_EXECUTE: 'extensions:execute',
  EXTENSIONS_MANAGE: 'extensions:manage',

  /**
   * Point of sale. `OPERATE` is the cashier's grant: open/close a till shift and ring sales.
   * `VIEW` reads shifts and the sales journal without the ability to transact.
   */
  POS_VIEW: 'pos:view',
  POS_OPERATE: 'pos:operate',
} as const;
