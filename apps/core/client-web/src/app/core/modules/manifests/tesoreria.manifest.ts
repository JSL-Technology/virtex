import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Treasury: cash, banks and reconciliation.
 *
 * Its four working pages sit under `/accounting/*` while the menu already grouped them as
 * "Tesorería" — menu and URL disagreed. Treasury has a different owner from the general ledger, so
 * it is its own module here. The addresses are kept as they are: moving them is a separate,
 * reversible change with redirects, and doing both at once would make neither reviewable.
 */
export const TESORERIA_MODULE: ModuleManifest = {
  id: 'tesoreria',
  titleKey: 'MODULES.TREASURY',
  icon: 'Coins',
  basePath: 'accounting',
  order: 5,
  routes: [
    {
      path: 'treasury',
      kind: WindowKind.OVERVIEW,
      permission: 'treasury:view',
      titleKey: 'PAGE_TITLES.TREASURY',
      icon: 'Coins',
      entityKeyFn: () => 'tesoreria:dashboard',
      menu: { group: 'inbox', labelKey: 'sidebar.finance.treasury_sub.dashboard' },
      load: () => import('../../../features/accounting/treasury/treasury.page').then((m) => m.TreasuryPage),
    },
    {
      path: 'treasury/bank-accounts/new',
      kind: WindowKind.DRAFT,
      permission: 'treasury:manage_accounts',
      titleKey: 'PAGE_TITLES.BANK_ACCOUNT',
      icon: 'Landmark',
      entityKeyFn: () => `tesoreria:bank-account:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/accounting/treasury/bank-account-form/bank-account-form.page').then((m) => m.BankAccountFormPage),
    },
    {
      path: 'treasury/bank-accounts/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'treasury:manage_accounts',
      titleKey: 'PAGE_TITLES.BANK_ACCOUNT',
      icon: 'Landmark',
      entityKeyFn: (p) => `tesoreria:bank-account:${p['id']}`,
      load: () => import('../../../features/accounting/treasury/bank-account-form/bank-account-form.page').then((m) => m.BankAccountFormPage),
    },
    {
      // Literal before ':id'-shaped siblings, and before the plain 'reconciliation' list so the
      // import screen is never swallowed by it.
      path: 'reconciliation/import',
      kind: WindowKind.DRAFT,
      permission: 'reconciliation:import',
      titleKey: 'PAGE_TITLES.STATEMENT_IMPORT',
      icon: 'Upload',
      entityKeyFn: () => 'tesoreria:statement-import',
      load: () => import('../../../features/accounting/reconciliation/statement-import/statement-import.page').then((m) => m.StatementImportPage),
    },
    {
      path: 'reconciliation',
      kind: WindowKind.OVERVIEW,
      permission: 'reconciliation:view',
      titleKey: 'PAGE_TITLES.ACCOUNT_RECONCILIATION',
      icon: 'ArrowLeftRight',
      entityKeyFn: () => 'tesoreria:reconciliation',
      menu: { group: 'documents', labelKey: 'sidebar.finance.treasury_sub.reconciliation_manual' },
      load: () => import('../../../features/accounting/reconciliation/account-reconciliation/account-reconciliation.page').then((m) => m.AccountReconciliationPage),
    },
  ],
};

/** Banks, payment methods and payment terms: treasury parameters that kept their old addresses. */
export const TESORERIA_MASTERS_MODULE: ModuleManifest = {
  id: 'tesoreria-masters',
  titleKey: 'MODULES.TREASURY',
  icon: 'Landmark',
  basePath: 'masters',
  order: 5.1,
  hidden: true,
  routes: [
    {
      path: 'banks',
      kind: WindowKind.LIST,
      permission: 'treasury:view',
      titleKey: 'PAGE_TITLES.BANKS',
      icon: 'Landmark',
      entityKeyFn: () => 'tesoreria:banks',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.banks' },
      load: () => import('../../../features/masters/banks/banks.page').then((m) => m.BanksPage),
    },
    {
      path: 'payment-methods',
      kind: WindowKind.LIST,
      permission: 'treasury:view',
      titleKey: 'PAGE_TITLES.PAYMENT_METHODS',
      icon: 'CreditCard',
      entityKeyFn: () => 'tesoreria:payment-methods',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.payment_methods' },
      load: () => import('../../../features/masters/payment-methods/payment-methods.page').then((m) => m.PaymentMethodsPage),
    },
    {
      path: 'payment-terms',
      kind: WindowKind.LIST,
      permission: 'treasury:view',
      titleKey: 'PAGE_TITLES.PAYMENT_TERMS',
      icon: 'Clock',
      entityKeyFn: () => 'tesoreria:payment-terms',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.payment_terms' },
      load: () => import('../../../features/masters/payment-terms/payment-terms.page').then((m) => m.PaymentTermsPage),
    },
  ],
};
