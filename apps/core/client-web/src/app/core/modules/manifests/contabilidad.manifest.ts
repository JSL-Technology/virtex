import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Accounting: the ledger and everything that closes it.
 *
 * Twenty-two pages, nineteen of them already wired to working endpoints, and not one of them
 * reached a user: `/accounting/*` was absent from the window catalogue, so every link in this
 * module opened the "under construction" card. Nothing here is new work — it is the same pages,
 * declared where the shell can find them.
 */
export const CONTABILIDAD_MODULE: ModuleManifest = {
  id: 'contabilidad',
  titleKey: 'modules.accounting',
  icon: 'Landmark',
  basePath: 'accounting',
  order: 6,
  routes: [
    {
      path: 'chart-of-accounts',
      kind: WindowKind.LIST,
      permission: 'coa:view',
      titleKey: 'page_titles.chart_of_accounts',
      icon: 'ListTree',
      entityKeyFn: () => 'contabilidad:coa',
      menu: { group: 'masters', labelKey: 'sidebar.finance.gl_sub.coa' },
      load: () => import('../../../features/accounting/chart-of-accounts/chart-of-accounts.page').then((m) => m.ChartOfAccountsPage),
    },
    {
      path: 'chart-of-accounts/segments-configuration',
      kind: WindowKind.DRAFT,
      permission: 'coa:edit',
      titleKey: 'page_titles.segment_configuration',
      icon: 'Blocks',
      entityKeyFn: () => 'contabilidad:coa-segments',
      load: () => import('../../../features/accounting/chart-of-accounts/segment-configuration/segment-configuration.page').then((m) => m.SegmentConfigurationPage),
    },
    {
      //  A wizard over two accounts, the server's analysis and a confirmation — not a list of
      //  records nor a document's draft. Opened from the chart of accounts.
      path: 'chart-of-accounts/merge',
      kind: WindowKind.CANVAS,
      permission: 'coa:merge',
      titleKey: 'accounting.merge_tool.account_merge_tool',
      icon: 'GitMerge',
      entityKeyFn: () => 'contabilidad:coa-merge',
      load: () => import('../../../features/accounting/merge-accounts/merge-accounts.page').then((m) => m.MergeAccountsPage),
    },
    {
      path: 'chart-of-accounts/new',
      kind: WindowKind.DRAFT,
      permission: 'coa:create',
      titleKey: 'page_titles.account_new',
      icon: 'FilePlus',
      entityKeyFn: () => 'contabilidad:account:new',
      load: () => import('../../../features/accounting/account-form/account-form.page').then((m) => m.AccountFormPage),
    },
    {
      path: 'chart-of-accounts/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'coa:edit',
      titleKey: 'page_titles.account_edit',
      icon: 'FilePen',
      entityKeyFn: (p) => `contabilidad:account:${p['id']}`,
      load: () => import('../../../features/accounting/account-form/account-form.page').then((m) => m.AccountFormPage),
    },
    {
      path: 'journal-entries',
      kind: WindowKind.LIST,
      permission: 'journal_entries:view',
      titleKey: 'page_titles.journal_entries',
      icon: 'BookOpen',
      entityKeyFn: () => 'contabilidad:journal-entries',
      menu: { group: 'documents', labelKey: 'sidebar.finance.gl_sub.journal' },
      load: () => import('../../../features/accounting/journal-entries/journal-entries.page').then((m) => m.JournalEntriesPage),
    },
    {
      path: 'journal-entries/new',
      kind: WindowKind.DRAFT,
      permission: 'journal_entries:create',
      titleKey: 'page_titles.journal_entry_new',
      icon: 'FilePlus',
      entityKeyFn: () => 'contabilidad:entry:new',
      load: () => import('../../../features/accounting/journal-entry-form/journal-entry-form.page').then((m) => m.JournalEntryFormPage),
    },
    {
      //  Un asistente: subir el fichero, mapear las columnas, revisar la previsualización y
      //  confirmar. No hay un borrador que guardar —no existe `FormGroup`, la pantalla es
      //  dirigida por plantilla— y el armazón de borrador impondría un «Guardar» que aquí no
      //  significa nada. Es la misma forma que la importación de datos del área de trabajo.
      path: 'journal-entries/import',
      kind: WindowKind.CANVAS,
      permission: 'journal_entries:create',
      titleKey: 'page_titles.journal_entry_import',
      icon: 'Upload',
      entityKeyFn: () => 'contabilidad:entry-import',
      load: () => import('../../../features/accounting/journal-entries/import/import.page').then((m) => m.JournalEntryImportPage),
    },
    {
      path: 'journal-entries/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'journal_entries:edit',
      titleKey: 'page_titles.journal_entry_edit',
      icon: 'FilePen',
      entityKeyFn: (p) => `contabilidad:entry:${p['id']}`,
      load: () => import('../../../features/accounting/journal-entry-form/journal-entry-form.page').then((m) => m.JournalEntryFormPage),
    },
    {
      path: 'daily-journal',
      kind: WindowKind.LIST,
      permission: 'journal_entries:view',
      titleKey: 'page_titles.daily_journal',
      icon: 'BookText',
      entityKeyFn: () => 'contabilidad:daily-journal',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.gl_sub.book_journal' },
      load: () => import('../../../features/accounting/daily-journal/daily-journal.page').then((m) => m.DailyJournalPage),
    },
    {
      path: 'general-ledger',
      kind: WindowKind.LIST,
      permission: 'accounting:view',
      titleKey: 'page_titles.general_ledger',
      icon: 'Library',
      entityKeyFn: () => 'contabilidad:general-ledger',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.gl_sub.book_gl' },
      load: () => import('../../../features/accounting/general-ledger/general-ledger.page').then((m) => m.GeneralLedgerPage),
    },
    {
      path: 'ledgers/new',
      kind: WindowKind.DRAFT,
      permission: 'accounting:manage_ledgers',
      titleKey: 'page_titles.ledger_new',
      icon: 'FilePlus',
      entityKeyFn: () => 'contabilidad:ledger:new',
      load: () => import('../../../features/accounting/ledger-form/app-ledger-form-page').then((m) => m.LedgerFormPage),
    },
    {
      //  Editar un libro reutiliza el mismo formulario (LedgerFormPage acepta `@Input() id`). Vivía en
      //  `general-ledger/:id/edit`, bajo la URL del reporte del mayor: dos conceptos —el reporte de
      //  una cuenta y la configuración de un libro paralelo— compartiendo dirección.
      path: 'ledgers/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'accounting:manage_ledgers',
      titleKey: 'page_titles.ledger_edit',
      icon: 'Layers3',
      entityKeyFn: (p) => `contabilidad:ledger:${p['id']}`,
      load: () => import('../../../features/accounting/ledger-form/app-ledger-form-page').then((m) => m.LedgerFormPage),
    },
    {
      //  El mayor de una cuenta es el conjunto de sus movimientos: se busca dentro de él, se
      //  acota por fechas y se lee de arriba abajo. Es una lista con una cuenta por encima, no un
      //  documento con estado — la cuenta no se emite ni se anula.
      path: 'general-ledger/:accountId',
      kind: WindowKind.LIST,
      permission: 'accounting:view',
      icon: 'Library',
      //  El código y el nombre de la cuenta los pone la propia página al cargarla; aquí solo
      //  había un UUID y la palabra «Mayor» en castellano fijo.
      titleKey: 'page_titles.general_ledger',
      entityKeyFn: (p) => `contabilidad:gl:${p['accountId']}`,
      load: () => import('../../../features/accounting/general-ledger/general-ledger.page').then((m) => m.GeneralLedgerPage),
    },
    {
      path: 'subsidiary-ledgers',
      kind: WindowKind.LIST,
      permission: 'accounting:view',
      titleKey: 'page_titles.subsidiary_ledgers',
      icon: 'Layers',
      entityKeyFn: () => 'contabilidad:subsidiary-ledgers',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.gl_sub.book_subledgers' },
      load: () => import('../../../features/accounting/subsidiary-ledgers/subsidiary-ledgers.page').then((m) => m.SubsidiaryLedgersPage),
    },
    {
      path: 'ledgers',
      kind: WindowKind.LIST,
      permission: 'accounting:manage_ledgers',
      titleKey: 'page_titles.ledgers',
      icon: 'Layers3',
      entityKeyFn: () => 'contabilidad:ledgers',
      menu: { group: 'configuration', labelKey: 'sidebar.finance.gl_sub.multi_ledger' },
      load: () => import('../../../features/accounting/ledger-list/ledger-list.page').then((m) => m.LedgerListPage),
    },
    {
      path: 'journals',
      kind: WindowKind.LIST,
      permission: 'journal_entries:view',
      titleKey: 'page_titles.journals',
      icon: 'NotebookTabs',
      entityKeyFn: () => 'contabilidad:journals',
      menu: { group: 'configuration', labelKey: 'sidebar.finance.gl_sub.journals' },
      load: () => import('../../../features/accounting/journal-list/journal-list.page').then((m) => m.JournalListPage),
    },
    {
      path: 'journals/new',
      kind: WindowKind.DRAFT,
      permission: 'journal_entries:create',
      titleKey: 'page_titles.journal_new',
      icon: 'FilePlus',
      entityKeyFn: () => 'contabilidad:journal:new',
      load: () => import('../../../features/accounting/journal-form/journal-form.page').then((m) => m.JournalFormPage),
    },
    {
      //  Editar un diario usa el mismo formulario (JournalFormPage lee `:id`). Sin esta ruta, «Editar»
      //  en la lista de diarios abría la página genérica «en construcción», no el formulario, y nunca
      //  como vista previa.
      path: 'journals/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'journal_entries:view',
      titleKey: 'page_titles.journal_edit',
      icon: 'NotebookTabs',
      entityKeyFn: (p) => `contabilidad:journal:${p['id']}`,
      load: () => import('../../../features/accounting/journal-form/journal-form.page').then((m) => m.JournalFormPage),
    },
    {
      path: 'periods',
      kind: WindowKind.LIST,
      permission: 'accounting:view',
      titleKey: 'page_titles.accounting_periods',
      icon: 'CalendarRange',
      entityKeyFn: () => 'contabilidad:periods',
      menu: { group: 'configuration', labelKey: 'sidebar.finance.gl_sub.periods' },
      load: () => import('../../../features/accounting/periods/periods.page').then((m) => m.PeriodsPage),
    },
    // Budgets (audit H-16): the monthly targets the budget control and the variance report use.
    {
      path: 'budgets',
      kind: WindowKind.LIST,
      permission: 'budgets:view',
      titleKey: 'page_titles.budgets',
      icon: 'Scale',
      entityKeyFn: () => 'contabilidad:budgets',
      menu: { group: 'documents', labelKey: 'page_titles.budgets' },
      load: () => import('../../../features/accounting/budgets/budgets.page').then((m) => m.BudgetsPage),
    },
    {
      path: 'budgets/new',
      kind: WindowKind.DRAFT,
      permission: 'budgets:manage',
      titleKey: 'page_titles.budget_new',
      icon: 'Scale',
      entityKeyFn: () => 'contabilidad:budget:new',
      load: () => import('../../../features/accounting/budgets/budget-form.page').then((m) => m.BudgetFormPage),
    },
    {
      path: 'budgets/:id',
      kind: WindowKind.DRAFT,
      permission: 'budgets:view',
      titleKey: 'page_titles.budget',
      icon: 'Scale',
      entityKeyFn: (p) => `contabilidad:budget:${p['id']}`,
      load: () => import('../../../features/accounting/budgets/budget-form.page').then((m) => m.BudgetFormPage),
    },
    {
      path: 'variance-analysis',
      kind: WindowKind.OVERVIEW,
      permission: 'budgets:view',
      titleKey: 'page_titles.variance_analysis',
      icon: 'GitCompareArrows',
      entityKeyFn: () => 'contabilidad:variance',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.gl_sub.variance_analysis' },
      load: () => import('../../../features/accounting/variance-analysis/variance-analysis.page').then((m) => m.VarianceAnalysisPage),
    },
    {
      path: 'closing/annual-close',
      kind: WindowKind.OVERVIEW,
      permission: 'accounting:close_year',
      titleKey: 'page_titles.close_year',
      icon: 'CalendarCheck',
      entityKeyFn: () => 'contabilidad:annual-close',
      menu: { group: 'documents', labelKey: 'sidebar.finance.gl_sub.closing_annual' },
      load: () => import('../../../features/accounting/closing/annual-close/annual-close.page').then((m) => m.AnnualClosePage),
    },
    /*
     * The corrections an external audit proposes to a year that is already closed.
     *
     * The whole feature was unreachable: the server's `AuditAdjustmentsService`, its entities and
     * its approval workflow were registered in no module and exposed by no route, so there was
     * nothing for a menu entry to point at. See `AuditAdjustmentsController`.
     */
    {
      path: 'audit-adjustments',
      kind: WindowKind.LIST,
      permission: 'audit:view_trail',
      titleKey: 'page_titles.audit_adjustments',
      icon: 'ScrollText',
      entityKeyFn: () => 'contabilidad:audit-adjustments',
      menu: { group: 'documents', labelKey: 'page_titles.audit_adjustments' },
      load: () => import('../../../features/accounting/audit-adjustments/audit-adjustments.page').then((m) => m.AuditAdjustmentsPage),
    },
    {
      path: 'audit-adjustments/new',
      kind: WindowKind.DRAFT,
      permission: 'audit:propose_adjustment',
      titleKey: 'page_titles.audit_adjustment_new',
      icon: 'FilePlus',
      entityKeyFn: () => 'contabilidad:audit-adjustment:new',
      load: () => import('../../../features/accounting/audit-adjustments/audit-adjustment-form/audit-adjustment-form.page').then((m) => m.AuditAdjustmentFormPage),
    },
    {
      path: 'closing/checklist',
      kind: WindowKind.OVERVIEW,
      permission: 'accounting:view',
      titleKey: 'page_titles.closing_checklists',
      icon: 'ListChecks',
      entityKeyFn: () => 'contabilidad:closing-checklist',
      menu: { group: 'documents', labelKey: 'sidebar.finance.gl_sub.period_close' },
      load: () => import('../../../features/accounting/closing/checklist/checklist.page').then((m) => m.ChecklistPage),
    },
  ],
};

/**
 * The financial statements, in Accounting's panel.
 *
 * They are served under `/reports/*` — the addresses predate this panel and are kept — so they are
 * a satellite: their own URL prefix, Accounting's menu. Balance sheet, income statement, trial
 * balance and cash flow are where an accountant looks for them in Odoo, NetSuite and SAP alike:
 * beside the ledger they are computed from, not in a separate analytics module.
 */
export const CONTABILIDAD_REPORTS_MODULE: ModuleManifest = {
  id: 'contabilidad-reportes',
  titleKey: 'modules.accounting',
  icon: 'Landmark',
  basePath: 'reports',
  order: 6,
  panelOf: 'contabilidad',
  routes: [
    {
      path: 'financial-statements/balance-sheet',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'page_titles.balance_sheet',
      icon: 'Scale',
      entityKeyFn: () => 'analisis:balance-sheet',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.balance_sheet' },
      load: () => import('../../../features/reports/financial-statements/balance-sheet/balance-sheet.page').then((m) => m.BalanceSheetPage),
    },
    {
      path: 'financial-statements/income-statement',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'page_titles.income_statement',
      icon: 'TrendingUp',
      entityKeyFn: () => 'analisis:income-statement',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.income_statement' },
      load: () => import('../../../features/reports/financial-statements/income-statement/income-statement.page').then((m) => m.IncomeStatementPage),
    },
    {
      path: 'financial-statements/trial-balance',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'page_titles.trial_balance',
      icon: 'Scale',
      entityKeyFn: () => 'analisis:trial-balance',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.trial_balance' },
      load: () => import('../../../features/reports/financial-statements/trial-balance/trial-balance.page').then((m) => m.TrialBalancePage),
    },
    {
      path: 'financial-statements/cash-flow',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_financial',
      titleKey: 'page_titles.cash_flow',
      icon: 'Waves',
      entityKeyFn: () => 'analisis:cash-flow',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.statements_sub.cash_flow' },
      load: () => import('../../../features/reports/financial-statements/cash-flow/cash-flow.page').then((m) => m.CashFlowPage),
    },
  ],
};

/**
 * Accounting's configuration lists that live under `/masters/*`: tax codes, currencies and payment
 * terms.
 *
 * They sat in an «Administración» module of their own, next to branches and the extensions
 * marketplace — a module no reference ERP has. Tax codes and currencies are accounting
 * configuration everywhere (Odoo «Contabilidad › Configuración», NetSuite «Setup › Accounting»);
 * payment terms are an accounting list that sales and purchasing both read, which is why Odoo and
 * NetSuite keep them there rather than in Treasury.
 */
export const CONTABILIDAD_MASTERS_MODULE: ModuleManifest = {
  id: 'contabilidad-masters',
  titleKey: 'modules.accounting',
  icon: 'Landmark',
  basePath: 'masters',
  order: 6,
  panelOf: 'contabilidad',
  routes: [
    {
      path: 'taxes',
      kind: WindowKind.LIST,
      permission: 'taxes:view',
      titleKey: 'page_titles.taxes',
      icon: 'Percent',
      entityKeyFn: () => 'contabilidad:taxes',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.taxes' },
      load: () => import('../../../features/masters/taxes/taxes.page').then((m) => m.TaxesPage),
    },
    {
      path: 'taxes/new',
      kind: WindowKind.DRAFT,
      permission: 'taxes:create',
      titleKey: 'page_titles.tax_new',
      icon: 'Percent',
      entityKeyFn: () => 'contabilidad:tax:new',
      load: () => import('../../../features/masters/taxes/tax-form/tax-form.page').then((m) => m.TaxFormPage),
    },
    {
      path: 'currencies',
      kind: WindowKind.LIST,
      permission: 'currencies:view',
      titleKey: 'page_titles.currencies',
      icon: 'Banknote',
      entityKeyFn: () => 'contabilidad:currencies',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.currencies' },
      load: () => import('../../../features/masters/currencies/currencies.page').then((m) => m.CurrenciesPage),
    },
    // The rates documents convert at (audit H-09): the history, the company's own, a lookup.
    {
      path: 'currencies/exchange-rates',
      kind: WindowKind.LIST,
      permission: 'currencies:view',
      titleKey: 'page_titles.exchange_rates',
      icon: 'Coins',
      entityKeyFn: () => 'contabilidad:exchange-rates',
      menu: { group: 'configuration', labelKey: 'page_titles.exchange_rates' },
      load: () => import('../../../features/masters/exchange-rates/exchange-rates.page').then((m) => m.ExchangeRatesPage),
    },
    {
      path: 'payment-terms',
      kind: WindowKind.LIST,
      permission: 'treasury:view',
      titleKey: 'page_titles.payment_terms',
      icon: 'Clock',
      entityKeyFn: () => 'contabilidad:payment-terms',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.payment_terms' },
      load: () => import('../../../features/masters/payment-terms/payment-terms.page').then((m) => m.PaymentTermsPage),
    },
  ],
};
