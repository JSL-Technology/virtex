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
  titleKey: 'modules.treasury',
  icon: 'Coins',
  basePath: 'accounting',
  order: 5,
  routes: [
    {
      path: 'treasury',
      kind: WindowKind.OVERVIEW,
      permission: 'treasury:view',
      titleKey: 'page_titles.treasury',
      icon: 'Coins',
      entityKeyFn: () => 'tesoreria:dashboard',
      menu: { group: 'inbox', labelKey: 'sidebar.finance.treasury_sub.dashboard' },
      load: () => import('../../../features/accounting/treasury/treasury.page').then((m) => m.TreasuryPage),
    },
    {
      path: 'treasury/bank-accounts/new',
      kind: WindowKind.DRAFT,
      permission: 'treasury:manage_accounts',
      titleKey: 'page_titles.bank_account',
      icon: 'Landmark',
      entityKeyFn: () => 'tesoreria:bank-account:new',
      load: () => import('../../../features/accounting/treasury/bank-account-form/bank-account-form.page').then((m) => m.BankAccountFormPage),
    },
    {
      path: 'treasury/bank-accounts/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'treasury:manage_accounts',
      titleKey: 'page_titles.bank_account',
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
      titleKey: 'page_titles.statement_import',
      icon: 'Upload',
      entityKeyFn: () => 'tesoreria:statement-import',
      load: () => import('../../../features/accounting/reconciliation/statement-import/statement-import.page').then((m) => m.StatementImportPage),
    },
    {
      path: 'reconciliation',
      kind: WindowKind.OVERVIEW,
      permission: 'reconciliation:view',
      titleKey: 'page_titles.account_reconciliation',
      icon: 'ArrowLeftRight',
      entityKeyFn: () => 'tesoreria:reconciliation',
      menu: { group: 'documents', labelKey: 'sidebar.finance.treasury_sub.reconciliation_manual' },
      load: () => import('../../../features/accounting/reconciliation/account-reconciliation/account-reconciliation.page').then((m) => m.AccountReconciliationPage),
    },
  ],
};

/**
 * Treasury's configuration under `/masters/*`: the bank catalogue and the payment methods.
 *
 * «Bancos» used to be a list deduced from the bank accounts, with no entity behind it; it is the
 * bank catalogue now (`/treasury/banks`). Payment terms moved to Accounting's configuration, where
 * sales and purchasing both read them.
 */
export const TESORERIA_MASTERS_MODULE: ModuleManifest = {
  id: 'tesoreria-masters',
  titleKey: 'modules.treasury',
  icon: 'Landmark',
  basePath: 'masters',
  order: 5.1,
  panelOf: 'tesoreria',
  routes: [
    {
      path: 'banks',
      kind: WindowKind.LIST,
      permission: 'treasury:view',
      titleKey: 'masters.banks.banks',
      icon: 'Landmark',
      entityKeyFn: () => 'tesoreria:banks',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.banks' },
      load: () => import('../../../features/masters/banks/banks.page').then((m) => m.BanksPage),
    },
    {
      path: 'banks/new',
      kind: WindowKind.DRAFT,
      permission: 'treasury:manage_accounts',
      titleKey: 'masters.banks.new_bank',
      icon: 'Landmark',
      entityKeyFn: () => 'tesoreria:bank:new',
      load: () => import('../../../features/masters/banks/bank-form/bank-form.page').then((m) => m.BankFormPage),
    },
    {
      path: 'banks/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'treasury:manage_accounts',
      titleKey: 'masters.banks.edit_bank',
      icon: 'Landmark',
      entityKeyFn: (p) => `tesoreria:bank:${p['id']}`,
      load: () => import('../../../features/masters/banks/bank-form/bank-form.page').then((m) => m.BankFormPage),
    },
    {
      path: 'payment-methods',
      kind: WindowKind.LIST,
      permission: 'treasury:view',
      titleKey: 'page_titles.payment_methods',
      icon: 'CreditCard',
      entityKeyFn: () => 'tesoreria:payment-methods',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.payment_methods' },
      load: () => import('../../../features/masters/payment-methods/payment-methods.page').then((m) => m.PaymentMethodsPage),
    },
  ],
};
