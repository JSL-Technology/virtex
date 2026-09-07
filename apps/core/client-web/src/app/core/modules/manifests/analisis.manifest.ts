import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Analysis: the four financial statements, profitability, and the datasheet workbooks.
 *
 * Every page here computes from a real endpoint and none of them reached a user, for the same
 * reason as Accounting: absent from the window catalogue.
 */
export const ANALISIS_MODULE: ModuleManifest = {
  id: 'analisis',
  titleKey: 'MODULES.ANALYSIS',
  icon: 'BarChart2',
  basePath: 'reports',
  order: 8,
  routes: [
    {
      path: 'financial-statements/balance-sheet',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'PAGE_TITLES.BALANCE_SHEET',
      icon: 'Scale',
      entityKeyFn: () => 'analisis:balance-sheet',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.balance_sheet' },
      load: () => import('../../../features/reports/financial-statements/balance-sheet/balance-sheet.page').then((m) => m.BalanceSheetPage),
    },
    {
      path: 'financial-statements/income-statement',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'PAGE_TITLES.INCOME_STATEMENT',
      icon: 'TrendingUp',
      entityKeyFn: () => 'analisis:income-statement',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.income_statement' },
      load: () => import('../../../features/reports/financial-statements/income-statement/income-statement.page').then((m) => m.IncomeStatementPage),
    },
    {
      path: 'financial-statements/trial-balance',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'PAGE_TITLES.TRIAL_BALANCE',
      icon: 'Scale',
      entityKeyFn: () => 'analisis:trial-balance',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.trial_balance' },
      load: () => import('../../../features/reports/financial-statements/trial-balance/trial-balance.page').then((m) => m.TrialBalancePage),
    },
    {
      path: 'financial-statements/cash-flow',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'PAGE_TITLES.CASH_FLOW',
      icon: 'Waves',
      entityKeyFn: () => 'analisis:cash-flow',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.cash_flow' },
      load: () => import('../../../features/reports/financial-statements/cash-flow/cash-flow.page').then((m) => m.CashFlowPage),
    },
    {
      path: 'profitability-by-product',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_sales',
      titleKey: 'PAGE_TITLES.PROFITABILITY_PRODUCT',
      icon: 'PackageSearch',
      entityKeyFn: () => 'analisis:profit-product',
      menu: { group: 'analysis', labelKey: 'PAGE_TITLES.PROFITABILITY_PRODUCT' },
      load: () => import('../../../features/reports/profitability-by-product/profitability-by-product.page').then((m) => m.ProfitabilityByProductPage),
    },
    {
      path: 'profitability-by-customer',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_sales',
      titleKey: 'PAGE_TITLES.PROFITABILITY_CUSTOMER',
      icon: 'Users',
      entityKeyFn: () => 'analisis:profit-customer',
      menu: { group: 'analysis', labelKey: 'PAGE_TITLES.PROFITABILITY_CUSTOMER' },
      load: () => import('../../../features/reports/profitability-by-customer/profitability-by-customer.page').then((m) => m.ProfitabilityByCustomerPage),
    },
  ],
};

/** Datasheets keep their own base path. */
export const DATASHEETS_MODULE: ModuleManifest = {
  id: 'datasheets',
  titleKey: 'MODULES.DATASHEETS',
  icon: 'Table2',
  basePath: 'datasheets',
  order: 8.1,
  panelOf: 'analisis',
  routes: [
    {
      path: '',
      kind: WindowKind.LIST,
      permission: 'datasheets:view',
      titleKey: 'PAGE_TITLES.DATASHEETS',
      icon: 'Table2',
      entityKeyFn: () => 'analisis:datasheets',
      menu: { group: 'analysis', labelKey: 'sidebar.reports.reporting_sub.datasheets' },
      load: () => import('../../../features/datasheets/pages/datasheet-list/datasheet-list.page').then((m) => m.DatasheetListPage),
    },
    {
      //  Una hoja de cálculo: barra de fórmulas, rejilla y panel de variables. No es un documento
      //  que se lee, es una superficie sobre la que se compone, y el armazón de documento —cabecera
      //  fija, cuerpo, panel lateral— estorbaría en las tres.
      path: ':id',
      kind: WindowKind.CANVAS,
      permission: 'datasheets:view',
      icon: 'Table2',
      titleFn: (p, d) => (d as { name?: string })?.name ?? `Hoja ${p['id']}`,
      entityKeyFn: (p) => `analisis:datasheet:${p['id']}`,
      load: () => import('../../../features/datasheets/pages/datasheet-editor/datasheet-editor.page').then((m) => m.DatasheetEditorPage),
    },
  ],
};
