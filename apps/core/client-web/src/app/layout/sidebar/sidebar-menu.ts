// Generated full sidebar menu with all required routes.
// Structure preserved from the original file.

export interface SidebarSubItem {
  path: string;
  translationKey: string;
}

export interface SidebarItem {
  path?: string; // Optional if it's just a group title
  translationKey: string;
  icon: string;
  isExpanded?: boolean; // To handle the state
  subItems?: SidebarSubItem[];
}

export interface SidebarGroup {
  groupTranslationKey: string;
  items: SidebarItem[];
}

export const SIDEBAR_MENU: SidebarGroup[] = [
  // 0) Global / Transversales
  {
    groupTranslationKey: 'sidebar.groups.general',
    items: [
      { path: '/dashboard', translationKey: 'sidebar.general.dashboard', icon: 'home' },
      { path: '/my-work', translationKey: 'sidebar.general.my_work', icon: 'assignment_ind' },
      { path: '/approvals', translationKey: 'sidebar.general.approvals', icon: 'rule' },
      { path: '/notifications', translationKey: 'sidebar.general.notifications', icon: 'notifications' },
      { path: '/global-search', translationKey: 'sidebar.general.search', icon: 'search' },
      {
        translationKey: 'sidebar.general.documents',
        icon: 'description',
        isExpanded: false,
        subItems: [
          { path: '/documents', translationKey: 'sidebar.general.documents_sub.all' },
          { path: '/documents/templates', translationKey: 'sidebar.general.documents_sub.templates' },
        ]
      },
      {
        translationKey: 'sidebar.general.etl',
        icon: 'data_object',
        isExpanded: false,
        subItems: [
          { path: '/etl/import', translationKey: 'sidebar.general.etl_sub.import' },
          { path: '/etl/export', translationKey: 'sidebar.general.etl_sub.export' },
        ]
      },
    ],
  },

  // 1) Master Data
  {
    groupTranslationKey: 'sidebar.groups.master_data',
    items: [
      { path: '/masters/customers', translationKey: 'sidebar.master_data.customers', icon: 'people' },
      { path: '/masters/suppliers', translationKey: 'sidebar.master_data.suppliers', icon: 'local_shipping' },
      { path: '/masters/products', translationKey: 'sidebar.master_data.products', icon: 'inventory' },
      { path: '/masters/price-lists', translationKey: 'sidebar.master_data.price_lists', icon: 'price_change' },
      { path: '/masters/taxes', translationKey: 'sidebar.master_data.taxes', icon: 'request_quote' },
      { path: '/masters/units-of-measure', translationKey: 'sidebar.master_data.uom', icon: 'straighten' },
      { path: '/masters/currencies', translationKey: 'sidebar.master_data.currencies', icon: 'payments' },
      { path: '/masters/banks', translationKey: 'sidebar.master_data.banks', icon: 'account_balance' },
      { path: '/masters/branches', translationKey: 'sidebar.master_data.branches', icon: 'store' },
      { path: '/masters/warehouses', translationKey: 'sidebar.master_data.warehouses', icon: 'warehouse' },
      { path: '/masters/payment-methods', translationKey: 'sidebar.master_data.payment_methods', icon: 'credit_card' },
      { path: '/masters/payment-terms', translationKey: 'sidebar.master_data.payment_terms', icon: 'history_toggle_off' },
      { path: '/masters/dimensions', translationKey: 'sidebar.master_data.dimensions', icon: 'view_quilt' },
      { path: '/masters/data-governance', translationKey: 'sidebar.master_data.data_governance', icon: 'rule_folder' },
      { path: '/masters/data-quality', translationKey: 'sidebar.master_data.data_quality', icon: 'task_alt' },
      { path: '/masters/duplicates', translationKey: 'sidebar.master_data.duplicates', icon: 'filter_none' },
    ],
  },

  // 2) Finance (GL, Treasury, AR, AP, Fixed Assets)
  {
    groupTranslationKey: 'sidebar.groups.finance',
    items: [
      // GL
      {
        translationKey: 'sidebar.finance.gl',
        icon: 'account_balance',
        isExpanded: false,
        subItems: [
          { path: '/accounting/journal-entries', translationKey: 'sidebar.finance.gl_sub.journal' },
          { path: '/accounting/books/journal', translationKey: 'sidebar.finance.gl_sub.book_journal' },
          { path: '/accounting/books/general-ledger', translationKey: 'sidebar.finance.gl_sub.book_gl' },
          { path: '/accounting/books/subledgers', translationKey: 'sidebar.finance.gl_sub.book_subledgers' },
          { path: '/accounting/chart-of-accounts', translationKey: 'sidebar.finance.gl_sub.coa' },
          { path: '/accounting/periods', translationKey: 'sidebar.finance.gl_sub.periods' },
          { path: '/accounting/closing/monthly', translationKey: 'sidebar.finance.gl_sub.closing_monthly' },
          { path: '/accounting/closing/annual', translationKey: 'sidebar.finance.gl_sub.closing_annual' },
          { path: '/accounting/closing/checklist', translationKey: 'sidebar.finance.gl_sub.closing_checklist' },
          { path: '/accounting/closing/tasks', translationKey: 'sidebar.finance.gl_sub.closing_tasks' },
          { path: '/accounting/reconciliations/accounts', translationKey: 'sidebar.finance.gl_sub.reconciliation_accounts' },
          { path: '/accounting/variance-analysis', translationKey: 'sidebar.finance.gl_sub.variance_analysis' },
          { path: '/accounting/multi-ledger', translationKey: 'sidebar.finance.gl_sub.multi_ledger' },
          { path: '/accounting/allocations', translationKey: 'sidebar.finance.gl_sub.allocations' },
          { path: '/accounting/intercompany/transactions', translationKey: 'sidebar.finance.gl_sub.ic_transactions' },
          { path: '/accounting/intercompany/reconciliation', translationKey: 'sidebar.finance.gl_sub.ic_reconciliation' },
          { path: '/accounting/intercompany/netting', translationKey: 'sidebar.finance.gl_sub.ic_netting' },
          { path: '/accounting/intercompany/billing', translationKey: 'sidebar.finance.gl_sub.ic_billing' },
          { path: '/accounting/consolidation/structure', translationKey: 'sidebar.finance.gl_sub.cons_structure' },
          { path: '/accounting/consolidation/eliminations', translationKey: 'sidebar.finance.gl_sub.cons_eliminations' },
          { path: '/accounting/consolidation/ownership', translationKey: 'sidebar.finance.gl_sub.cons_ownership' },
          { path: '/accounting/consolidation/cta', translationKey: 'sidebar.finance.gl_sub.cons_cta' },
          { path: '/accounting/consolidation/hyperinflation', translationKey: 'sidebar.finance.gl_sub.cons_hyperinflation' },
          { path: '/accounting/consolidation/ownership-changes', translationKey: 'sidebar.finance.gl_sub.cons_ownership_changes' },
          { path: '/accounting/multi-gaap', translationKey: 'sidebar.finance.gl_sub.multi_gaap' },
          { path: '/accounting/monetary-revaluation', translationKey: 'sidebar.finance.gl_sub.monetary_revaluation' },
          { path: '/accounting/rules-engine', translationKey: 'sidebar.finance.gl_sub.rules_engine' },
          { path: '/accounting/simulator', translationKey: 'sidebar.finance.gl_sub.simulator' },
          { path: '/accounting/audit', translationKey: 'sidebar.finance.gl_sub.audit' },
          // New (subledger & control)
          { path: '/accounting/reconciliation/subledger-gl', translationKey: 'sidebar.finance.gl_sub.reconciliation_subledger_gl' },
          { path: '/accounting/periods/subledger', translationKey: 'sidebar.finance.gl_sub.periods_subledger' },
          { path: '/accounting/revaluation/subledger', translationKey: 'sidebar.finance.gl_sub.revaluation_subledger' },
        ],
      },
      // Treasury
      {
        translationKey: 'sidebar.finance.treasury',
        icon: 'monetization_on',
        isExpanded: false,
        subItems: [
          { path: '/treasury/dashboard', translationKey: 'sidebar.finance.treasury_sub.dashboard' },
          { path: '/treasury/bank-accounts', translationKey: 'sidebar.finance.treasury_sub.accounts' },
          { path: '/treasury/reconciliation/manual', translationKey: 'sidebar.finance.treasury_sub.reconciliation_manual' },
          { path: '/treasury/reconciliation/auto', translationKey: 'sidebar.finance.treasury_sub.reconciliation_auto' },
          { path: '/treasury/bank-files', translationKey: 'sidebar.finance.treasury_sub.bank_files' },
          { path: '/treasury/file-adapters', translationKey: 'sidebar.finance.treasury_sub.file_adapters' },
          { path: '/treasury/bank-validations', translationKey: 'sidebar.finance.treasury_sub.bank_validations' },
          { path: '/treasury/scheduled-payments', translationKey: 'sidebar.finance.treasury_sub.scheduled_payments' },
          { path: '/treasury/mass-payments', translationKey: 'sidebar.finance.treasury_sub.mass_payments' },
          { path: '/treasury/mandates', translationKey: 'sidebar.finance.treasury_sub.mandates' },
          { path: '/treasury/positive-pay', translationKey: 'sidebar.finance.treasury_sub.positive_pay' },
          { path: '/treasury/cash-flow/actual', translationKey: 'sidebar.finance.treasury_sub.cash_flow_actual' },
          { path: '/treasury/cash-flow/forecast', translationKey: 'sidebar.finance.treasury_sub.cash_flow_forecast' },
          { path: '/treasury/forecasting', translationKey: 'sidebar.finance.treasury_sub.forecasting' },
          { path: '/treasury/exchange-rates', translationKey: 'sidebar.finance.treasury_sub.exchange_rates' },
          { path: '/treasury/cash-pooling', translationKey: 'sidebar.finance.treasury_sub.cash_pooling' },
          { path: '/treasury/fx-hedging', translationKey: 'sidebar.finance.treasury_sub.fx_hedging' },
          { path: '/treasury/derivatives', translationKey: 'sidebar.finance.treasury_sub.derivatives' },
          { path: '/treasury/hedge-accounting', translationKey: 'sidebar.finance.treasury_sub.hedge_accounting' },
          { path: '/treasury/checkbooks', translationKey: 'sidebar.finance.treasury_sub.checkbooks' },
          // Corporate
          { path: '/treasury/debt', translationKey: 'sidebar.finance.treasury_sub.debt' },
          { path: '/treasury/in-house-bank', translationKey: 'sidebar.finance.treasury_sub.in_house_bank' },
          { path: '/treasury/guarantees', translationKey: 'sidebar.finance.treasury_sub.guarantees' },
          { path: '/treasury/investments', translationKey: 'sidebar.finance.treasury_sub.investments' },
          { path: '/treasury/exposures', translationKey: 'sidebar.finance.treasury_sub.exposures' },
        ],
      },
      // AR
      {
        translationKey: 'sidebar.finance.ar',
        icon: 'request_quote',
        isExpanded: false,
        subItems: [
          { path: '/ar/dashboard', translationKey: 'sidebar.finance.ar_sub.dashboard' },
          { path: '/ar/invoices', translationKey: 'sidebar.finance.ar_sub.invoices' },
          { path: '/ar/receipts', translationKey: 'sidebar.finance.ar_sub.receipts' },
          { path: '/ar/credit-notes', translationKey: 'sidebar.finance.ar_sub.credit_notes' },
          { path: '/ar/debit-notes', translationKey: 'sidebar.finance.ar_sub.debit_notes' },
          { path: '/ar/cash-application', translationKey: 'sidebar.finance.ar_sub.cash_application' },
          { path: '/ar/dunning', translationKey: 'sidebar.finance.ar_sub.dunning' },
          { path: '/ar/disputes', translationKey: 'sidebar.finance.ar_sub.disputes' },
          { path: '/ar/customer-statements', translationKey: 'sidebar.finance.ar_sub.statements' },
          { path: '/ar/online-payments', translationKey: 'sidebar.finance.ar_sub.online_payments' },
          { path: '/ar/psp', translationKey: 'sidebar.finance.ar_sub.psp' },
          { path: '/ar/psp/reconciliation', translationKey: 'sidebar.finance.ar_sub.psp_reconciliation' },
          { path: '/ar/settings', translationKey: 'sidebar.finance.ar_sub.settings' },
          // New
          { path: '/ar/factoring', translationKey: 'sidebar.finance.ar_sub.factoring' },
          { path: '/ar/payment-plans', translationKey: 'sidebar.finance.ar_sub.payment_plans' },
          { path: '/ar/chargebacks', translationKey: 'sidebar.finance.ar_sub.chargebacks' },
        ],
      },
      // AP
      {
        translationKey: 'sidebar.finance.ap',
        icon: 'receipt_long',
        isExpanded: false,
        subItems: [
          { path: '/ap/dashboard', translationKey: 'sidebar.finance.ap_sub.dashboard' },
          { path: '/ap/invoices', translationKey: 'sidebar.finance.ap_sub.invoices' },
          { path: '/ap/credit-notes', translationKey: 'sidebar.finance.ap_sub.credit_notes' },
          { path: '/ap/withholdings', translationKey: 'sidebar.finance.ap_sub.withholdings' },
          { path: '/ap/approvals', translationKey: 'sidebar.finance.ap_sub.approvals' },
          { path: '/ap/ocr', translationKey: 'sidebar.finance.ap_sub.ocr' },
          { path: '/ap/payments', translationKey: 'sidebar.finance.ap_sub.payments' },
          { path: '/ap/suppliers', translationKey: 'sidebar.finance.ap_sub.suppliers' },
          { path: '/ap/advances', translationKey: 'sidebar.finance.ap_sub.advances' },
          { path: '/ap/dynamic-discounting', translationKey: 'sidebar.finance.ap_sub.dynamic_discounting' },
          { path: '/ap/scf-confirming', translationKey: 'sidebar.finance.ap_sub.scf_confirming' },
        ],
      },
      // Fixed Assets
      {
        translationKey: 'sidebar.finance.fixed_assets',
        icon: 'domain',
        isExpanded: false,
        subItems: [
          { path: '/fixed-assets/list', translationKey: 'sidebar.finance.fa_sub.list' },
          { path: '/fixed-assets/new', translationKey: 'sidebar.finance.fa_sub.new' },
          { path: '/fixed-assets/:id', translationKey: 'sidebar.finance.fa_sub.detail' },
          { path: '/fixed-assets/disposals', translationKey: 'sidebar.finance.fa_sub.disposals' },
          { path: '/fixed-assets/revaluations', translationKey: 'sidebar.finance.fa_sub.revaluations' },
          { path: '/fixed-assets/components', translationKey: 'sidebar.finance.fa_sub.components' },
          { path: '/fixed-assets/leases', translationKey: 'sidebar.finance.fa_sub.leases' },
          { path: '/fixed-assets/ap-integration', translationKey: 'sidebar.finance.fa_sub.ap_integration' },
          { path: '/fixed-assets/maintenance/plans', translationKey: 'sidebar.finance.fa_sub.maintenance_plans' },
          { path: '/fixed-assets/maintenance/work-orders', translationKey: 'sidebar.finance.fa_sub.maintenance_orders' },
          { path: '/fixed-assets/cip', translationKey: 'sidebar.finance.fa_sub.cip' },
          { path: '/fixed-assets/afe', translationKey: 'sidebar.finance.fa_sub.afe' },
        ],
      },
    ],
  },

  // 6–9) Operations (Sales, Purchasing, Inventory, Manufacturing, Deliveries)
  {
    groupTranslationKey: 'sidebar.groups.operations',
    items: [
      // Sales & Invoicing
      {
        translationKey: 'sidebar.operations.sales',
        icon: 'storefront',
        isExpanded: false,
        subItems: [
          { path: '/sales/quotes', translationKey: 'sidebar.operations.sales_sub.quotes' },
          { path: '/sales/orders', translationKey: 'sidebar.operations.sales_sub.orders' },
          { path: '/sales/returns', translationKey: 'sidebar.operations.sales_sub.returns' },
          { path: '/sales/credit-notes', translationKey: 'sidebar.operations.sales_sub.credit_notes' },
          { path: '/sales/contracts', translationKey: 'sidebar.operations.sales_sub.contracts' },
          { path: '/sales/cpq', translationKey: 'sidebar.operations.sales_sub.cpq' },
          { path: '/subscriptions', translationKey: 'sidebar.operations.sales_sub.subscriptions' },
          { path: '/subscriptions/usage', translationKey: 'sidebar.operations.sales_sub.subscriptions_usage' },
          { path: '/subscriptions/rating', translationKey: 'sidebar.operations.sales_sub.subscriptions_rating' },
          { path: '/pricing/lists', translationKey: 'sidebar.operations.sales_sub.pricing_lists' },
          { path: '/commissions', translationKey: 'sidebar.operations.sales_sub.commissions' },
          { path: '/invoices/list', translationKey: 'sidebar.operations.sales_sub.invoices_list' },
          { path: '/invoices/new', translationKey: 'sidebar.operations.sales_sub.invoices_new' },
        ],
      },
      // Purchasing
      {
        translationKey: 'sidebar.operations.purchasing',
        icon: 'shopping_cart',
        isExpanded: false,
        subItems: [
          { path: '/purchasing/requisitions', translationKey: 'sidebar.operations.purchasing_sub.requisitions' },
          { path: '/purchasing/orders', translationKey: 'sidebar.operations.purchasing_sub.orders' },
          { path: '/purchasing/receipts', translationKey: 'sidebar.operations.purchasing_sub.receipts' },
          { path: '/purchasing/contracts', translationKey: 'sidebar.operations.purchasing_sub.contracts' },
          { path: '/purchasing/approvals', translationKey: 'sidebar.operations.purchasing_sub.approvals' },
          { path: '/purchasing/3-way-match', translationKey: 'sidebar.operations.purchasing_sub.match_3way' },
          { path: '/purchasing/4-way-match', translationKey: 'sidebar.operations.purchasing_sub.match_4way' },
          { path: '/purchasing/analytics', translationKey: 'sidebar.operations.purchasing_sub.analytics' },
          { path: '/purchasing/returns', translationKey: 'sidebar.operations.purchasing_sub.returns' },
          // eSourcing & catalogs
          { path: '/purchasing/rfq', translationKey: 'sidebar.operations.purchasing_sub.rfq' },
          { path: '/purchasing/catalogs', translationKey: 'sidebar.operations.purchasing_sub.catalogs' },
          { path: '/suppliers/performance', translationKey: 'sidebar.operations.purchasing_sub.supplier_performance' },
          { path: '/suppliers/onboarding', translationKey: 'sidebar.operations.purchasing_sub.supplier_onboarding' },
          // Legacy generic matching kept for compatibility (optional)
          { path: '/purchasing/invoice-matching', translationKey: 'sidebar.operations.purchasing_sub.invoice_matching' },
        ],
      },
      // Inventory & WMS Light
      {
        translationKey: 'sidebar.operations.inventory',
        icon: 'inventory_2',
        isExpanded: false,
        subItems: [
          { path: '/inventory/stock', translationKey: 'sidebar.operations.inventory_sub.stock' },
          { path: '/inventory/movements', translationKey: 'sidebar.operations.inventory_sub.movements' },
          { path: '/inventory/adjustments', translationKey: 'sidebar.operations.inventory_sub.adjustments' },
          { path: '/inventory/transfers', translationKey: 'sidebar.operations.inventory_sub.transfers' },
          { path: '/inventory/locations', translationKey: 'sidebar.operations.inventory_sub.locations' },
          { path: '/inventory/lots-serials', translationKey: 'sidebar.operations.inventory_sub.lots_serials' },
          { path: '/inventory/cycle-counts', translationKey: 'sidebar.operations.inventory_sub.cycle_counts' },
          { path: '/inventory/picking-packing', translationKey: 'sidebar.operations.inventory_sub.picking_packing' },
          { path: '/inventory/shipments', translationKey: 'sidebar.operations.inventory_sub.shipments' },
          { path: '/inventory/costs/landed', translationKey: 'sidebar.operations.inventory_sub.costs_landed' },
          { path: '/inventory/kits-bom', translationKey: 'sidebar.operations.inventory_sub.kits_bom' },
          { path: '/inventory/reservations', translationKey: 'sidebar.operations.inventory_sub.reservations' },
          { path: '/inventory/planning', translationKey: 'sidebar.operations.inventory_sub.planning' },
          { path: '/inventory/quality', translationKey: 'sidebar.operations.inventory_sub.quality' },
          { path: '/inventory/quarantines', translationKey: 'sidebar.operations.inventory_sub.quarantines' },
          { path: '/inventory/mobile/warehouse', translationKey: 'sidebar.operations.inventory_sub.mobile_warehouse' },
          // Costing extras
          { path: '/inventory/costs/methods', translationKey: 'sidebar.operations.inventory_sub.costs_methods' },
          { path: '/inventory/costs/close', translationKey: 'sidebar.operations.inventory_sub.costs_close' },
          { path: '/inventory/costs/revaluations', translationKey: 'sidebar.operations.inventory_sub.costs_revaluations' },
          // (Optional legacy dashboard for compatibility)
          { path: '/inventory/dashboard', translationKey: 'sidebar.operations.inventory_sub.dashboard' },
        ],
      },
      // Manufacturing
      {
        translationKey: 'sidebar.operations.manufacturing',
        icon: 'precision_manufacturing',
        isExpanded: false,
        subItems: [
          { path: '/manufacturing/master-data', translationKey: 'sidebar.operations.manufacturing_sub.master_data' },
          { path: '/manufacturing/orders', translationKey: 'sidebar.operations.manufacturing_sub.orders' },
          { path: '/manufacturing/mrp', translationKey: 'sidebar.operations.manufacturing_sub.mrp' },
          { path: '/manufacturing/shop-floor', translationKey: 'sidebar.operations.manufacturing_sub.shop_floor' },
          { path: '/manufacturing/costing', translationKey: 'sidebar.operations.manufacturing_sub.costing' },
          { path: '/manufacturing/wip', translationKey: 'sidebar.operations.manufacturing_sub.wip' },
        ],
      },
      // Deliveries
      {
        translationKey: 'sidebar.operations.deliveries',
        icon: 'local_shipping',
        isExpanded: false,
        subItems: [
          { path: '/delivery-notes', translationKey: 'sidebar.operations.deliveries_sub.list' },
          { path: '/delivery-notes/new', translationKey: 'sidebar.operations.deliveries_sub.new' },
          { path: '/delivery-notes/:id', translationKey: 'sidebar.operations.deliveries_sub.detail' },
        ],
      },
    ],
  },

  // 11) Projects & Cost Centers (PSA)
  {
    groupTranslationKey: 'sidebar.groups.psa',
    items: [
      {
        translationKey: 'sidebar.psa.projects',
        icon: 'work',
        isExpanded: false,
        subItems: [
          { path: '/projects', translationKey: 'sidebar.psa.projects_sub.list' },
          { path: '/projects/timesheets', translationKey: 'sidebar.psa.projects_sub.timesheets' },
          { path: '/projects/milestones-wip', translationKey: 'sidebar.psa.projects_sub.milestones_wip' },
          { path: '/projects/billing', translationKey: 'sidebar.psa.projects_sub.billing' },
          { path: '/projects/wbs', translationKey: 'sidebar.psa.projects_sub.wbs' },
          { path: '/projects/budgeting', translationKey: 'sidebar.psa.projects_sub.budgeting' },
          { path: '/projects/resources', translationKey: 'sidebar.psa.projects_sub.resources' },
          { path: '/projects/capitalization', translationKey: 'sidebar.psa.projects_sub.capitalization' },
        ],
      },
      { path: '/cost-centers', translationKey: 'sidebar.psa.cost_centers', icon: 'balance' },
      { path: '/cost-allocation', translationKey: 'sidebar.psa.cost_allocation', icon: 'pie_chart' },
    ],
  },

  // 12) HR / Payroll
  {
    groupTranslationKey: 'sidebar.groups.hr',
    items: [
      { path: '/payroll/dashboard', translationKey: 'sidebar.hr.dashboard', icon: 'dashboard' },
      { path: '/payroll/process', translationKey: 'sidebar.hr.process', icon: 'play_circle' },
      { path: '/employees', translationKey: 'sidebar.hr.employees', icon: 'group' },
      { path: '/payroll/incidents', translationKey: 'sidebar.hr.incidents', icon: 'report' },
      { path: '/payroll/absences', translationKey: 'sidebar.hr.absences', icon: 'event_busy' },
      { path: '/payroll/loans', translationKey: 'sidebar.hr.loans', icon: 'account_balance_wallet' },
      { path: '/payroll/severance', translationKey: 'sidebar.hr.severance', icon: 'assignment_return' },
      { path: '/payroll/reports', translationKey: 'sidebar.hr.reports', icon: 'assessment' },
      { path: '/payroll/self-service', translationKey: 'sidebar.hr.self_service', icon: 'smartphone' },
    ],
  },

  // 13) Reports (Financial & BI)
  {
    groupTranslationKey: 'sidebar.groups.reports',
    items: [
      {
        translationKey: 'sidebar.reports.reporting',
        icon: 'assessment',
        isExpanded: false,
        subItems: [
          { path: '/reports/financial-statements', translationKey: 'sidebar.reports.reporting_sub.financial_statements' },
          { path: '/reports/profitability', translationKey: 'sidebar.reports.reporting_sub.profitability' },
          { path: '/reports/comparatives', translationKey: 'sidebar.reports.reporting_sub.comparatives' },
          { path: '/reports/tax', translationKey: 'sidebar.reports.reporting_sub.tax' },
          { path: '/reports/ar-aging', translationKey: 'sidebar.reports.reporting_sub.ar_aging' },
          { path: '/reports/ap-aging', translationKey: 'sidebar.reports.reporting_sub.ap_aging' },
          { path: '/reports/consolidated', translationKey: 'sidebar.reports.reporting_sub.consolidated' },
          { path: '/reports/treasury', translationKey: 'sidebar.reports.reporting_sub.treasury' },
          { path: '/reports/inventory', translationKey: 'sidebar.reports.reporting_sub.inventory' },
          { path: '/reports/assets', translationKey: 'sidebar.reports.reporting_sub.assets' },
          { path: '/reports/audit', translationKey: 'sidebar.reports.reporting_sub.audit' },
          { path: '/reports/closing', translationKey: 'sidebar.reports.reporting_sub.closing' },
          { path: '/reports/xbrl', translationKey: 'sidebar.reports.reporting_sub.xbrl' },
          { path: '/costs/analytics', translationKey: 'sidebar.reports.reporting_sub.costs_analytics' },
        ],
      },
      {
        translationKey: 'sidebar.reports.bi',
        icon: 'monitoring',
        isExpanded: false,
        subItems: [
          { path: '/bi/dashboards', translationKey: 'sidebar.reports.bi_sub.dashboards' },
          { path: '/bi/kpis', translationKey: 'sidebar.reports.bi_sub.kpis' },
        ],
      },
    ]
  },

  // 14) Tax & Compliance
  {
    groupTranslationKey: 'sidebar.groups.tax',
    items: [
      {
        translationKey: 'sidebar.tax.tax',
        icon: 'gavel',
        isExpanded: false,
        subItems: [
          { path: '/tax/summary', translationKey: 'sidebar.tax.sub.summary' },
          { path: '/tax/calendar', translationKey: 'sidebar.tax.sub.calendar' },
          { path: '/tax/filings', translationKey: 'sidebar.tax.sub.filings' },
          { path: '/tax/localizations', translationKey: 'sidebar.tax.sub.localizations' },
          { path: '/tax/certificates', translationKey: 'sidebar.tax.sub.certificates' },
          { path: '/tax/withholdings', translationKey: 'sidebar.tax.sub.withholdings' },
          { path: '/tax/e-invoicing', translationKey: 'sidebar.tax.sub.e_invoicing' },
          { path: '/tax/e-invoicing/:country', translationKey: 'sidebar.tax.sub.e_invoicing_country' },
          { path: '/tax/deferred', translationKey: 'sidebar.tax.sub.deferred' },
          { path: '/tax/reconciliation', translationKey: 'sidebar.tax.sub.reconciliation' },
          // Advanced
          { path: '/tax/determination-engine', translationKey: 'sidebar.tax.sub.determination_engine' },
          { path: '/tax/transfer-pricing', translationKey: 'sidebar.tax.sub.transfer_pricing' },
          { path: '/tax/cbcr', translationKey: 'sidebar.tax.sub.cbcr' },
          { path: '/tax/saft', translationKey: 'sidebar.tax.sub.saft' },
          { path: '/tax/localizations/:country', translationKey: 'sidebar.tax.sub.localizations_country' },
        ],
      },
    ],
  },

  // 15) Intelligence & Planning
  {
    groupTranslationKey: 'sidebar.groups.intelligence',
    items: [
      {
        translationKey: 'sidebar.intelligence.analytics',
        icon: 'insights',
        isExpanded: false,
        subItems: [
          { path: '/intelligence/dashboard', translationKey: 'sidebar.intelligence.sub.dashboard' },
          { path: '/intelligence/what-if', translationKey: 'sidebar.intelligence.sub.what_if' },
          { path: '/intelligence/kpis', translationKey: 'sidebar.intelligence.sub.kpis' },
          { path: '/intelligence/process-mining', translationKey: 'sidebar.intelligence.sub.process_mining' },
          { path: '/intelligence/semantic', translationKey: 'sidebar.intelligence.sub.semantic' },
          { path: '/budgets/models', translationKey: 'sidebar.intelligence.sub.budget_models' },
          { path: '/budgets/execution', translationKey: 'sidebar.intelligence.sub.budget_execution' },
          { path: '/forecasting/rolling', translationKey: 'sidebar.intelligence.sub.rolling_forecast' },
        ],
      },
    ],
  },

  // 16) Platform & Integrations
  {
    groupTranslationKey: 'sidebar.groups.platform',
    items: [
      { path: '/settings/integrations', translationKey: 'sidebar.platform.integrations', icon: 'hub' },
      {
        translationKey: 'sidebar.platform.api',
        icon: 'api',
        isExpanded: false,
        subItems: [
          { path: '/api/credentials', translationKey: 'sidebar.platform.api_sub.credentials' },
          { path: '/api/webhooks', translationKey: 'sidebar.platform.api_sub.webhooks' },
          { path: '/api/rate-limits', translationKey: 'sidebar.platform.api_sub.rate_limits' },
          { path: '/api/audit', translationKey: 'sidebar.platform.api_sub.audit' },
        ]
      },
      {
        translationKey: 'sidebar.platform.integrations_area',
        icon: 'sync_alt',
        isExpanded: false,
        subItems: [
          { path: '/integrations/edi', translationKey: 'sidebar.platform.integrations_sub.edi' },
          { path: '/integrations/monitoring', translationKey: 'sidebar.platform.integrations_sub.monitoring' },
          { path: '/integrations/reprocessing', translationKey: 'sidebar.platform.integrations_sub.reprocessing' },
        ]
      },
      {
        translationKey: 'sidebar.platform.automation',
        icon: 'automation',
        isExpanded: false,
        subItems: [
          { path: '/automation/ocr', translationKey: 'sidebar.platform.automation_sub.ocr' },
          { path: '/automation/workflows', translationKey: 'sidebar.platform.automation_sub.workflows' },
        ]
      },
      {
        translationKey: 'sidebar.platform.operations',
        icon: 'terminal',
        isExpanded: false,
        subItems: [
          { path: '/operations/jobs', translationKey: 'sidebar.platform.operations_sub.jobs' },
          { path: '/operations/logs', translationKey: 'sidebar.platform.operations_sub.logs' },
          { path: '/operations/archive', translationKey: 'sidebar.platform.operations_sub.archive' },
          { path: '/operations/transports', translationKey: 'sidebar.platform.operations_sub.transports' },
          { path: '/operations/environments', translationKey: 'sidebar.platform.operations_sub.environments' },
          { path: '/operations/apm', translationKey: 'sidebar.platform.operations_sub.apm' },
          { path: '/operations/feature-flags', translationKey: 'sidebar.platform.operations_sub.feature_flags' },
          { path: '/operations/capacity', translationKey: 'sidebar.platform.operations_sub.capacity' },
        ]
      },
      { path: '/data/warehouse', translationKey: 'sidebar.platform.data_warehouse', icon: 'warehouse' },
      { path: '/marketplace/connectors', translationKey: 'sidebar.platform.marketplace_connectors', icon: 'apps' },
    ],
  },

  // 17) Settings (General)
  {
    groupTranslationKey: 'sidebar.groups.configuration',
    items: [
      { path: '/settings/system', translationKey: 'sidebar.configuration.system', icon: 'tune' },
      { path: '/settings/accounting-accounts', translationKey: 'sidebar.configuration.accounting_accounts', icon: 'assignment' },
      { path: '/settings/permissions', translationKey: 'sidebar.configuration.permissions', icon: 'admin_panel_settings' },
      { path: '/settings/alerts', translationKey: 'sidebar.configuration.alerts', icon: 'add_alert' },
      { path: '/settings/email-templates', translationKey: 'sidebar.configuration.email_templates', icon: 'mail' },
      { path: '/settings/digital-signatures', translationKey: 'sidebar.configuration.digital_signatures', icon: 'draw' },
    ],
  },

  // 18) Users, Security & Governance
  {
    groupTranslationKey: 'sidebar.groups.security',
    items: [
      { path: '/users', translationKey: 'sidebar.security.users', icon: 'group' },
      { path: '/users/permissions', translationKey: 'sidebar.security.user_permissions', icon: 'vpn_key' },
      { path: '/security/sso-mfa', translationKey: 'sidebar.security.sso_mfa', icon: 'enhanced_encryption' },
      { path: '/security/sod', translationKey: 'sidebar.security.sod', icon: 'grid_view' },
      { path: '/security/policies', translationKey: 'sidebar.security.policies', icon: 'policy' },
      { path: '/security/dsar', translationKey: 'sidebar.security.dsar', icon: 'privacy_tip' },
      { path: '/security/third-party-screening', translationKey: 'sidebar.security.third_party_screening', icon: 'fact_check' },
      { path: '/audit', translationKey: 'sidebar.security.audit', icon: 'search' },
    ],
  },

  // 19) Portals
  {
    groupTranslationKey: 'sidebar.groups.portals',
    items: [
      { path: '/portals/customers', translationKey: 'sidebar.portals.customers', icon: 'person_outline' },
      { path: '/portals/suppliers', translationKey: 'sidebar.portals.suppliers', icon: 'local_shipping' },
      { path: '/portals/employees', translationKey: 'sidebar.portals.employees', icon: 'badge' },
    ],
  },

  // 20) Support & Help
  {
    groupTranslationKey: 'sidebar.groups.support',
    items: [
      { path: '/help', translationKey: 'sidebar.support.help', icon: 'help' },
      { path: '/support', translationKey: 'sidebar.support.support', icon: 'support_agent' },
      { path: '/support/status', translationKey: 'sidebar.support.status', icon: 'insights' },
    ],
  },

  // 21) Revenue Recognition
  {
    groupTranslationKey: 'sidebar.groups.revenue',
    items: [
      { path: '/revenue/performance-obligations', translationKey: 'sidebar.revenue.performance_obligations', icon: 'library_books' },
      { path: '/revenue/contracts', translationKey: 'sidebar.revenue.contracts', icon: 'receipt' },
      { path: '/revenue/schedules', translationKey: 'sidebar.revenue.schedules', icon: 'schedule' },
      { path: '/revenue/deferrals', translationKey: 'sidebar.revenue.deferrals', icon: 'pause_circle' },
      { path: '/revenue/reports', translationKey: 'sidebar.revenue.reports', icon: 'assessment' },
    ],
  },

  // 22) Expenses (T&E) & Cards
  {
    groupTranslationKey: 'sidebar.groups.expenses',
    items: [
      { path: '/expenses/reports', translationKey: 'sidebar.expenses.reports', icon: 'summarize' },
      { path: '/expenses/cards', translationKey: 'sidebar.expenses.cards', icon: 'credit_card' },
      { path: '/expenses/approvals', translationKey: 'sidebar.expenses.approvals', icon: 'rule' },
    ],
  },

  // 23) Organization / Multi-entity
  {
    groupTranslationKey: 'sidebar.groups.organization',
    items: [
      { path: '/organization/companies', translationKey: 'sidebar.organization.companies', icon: 'domain' },
    ],
  },

  // 25) Logistics / TMS & 3PL
  {
    groupTranslationKey: 'sidebar.groups.logistics',
    items: [
      { path: '/logistics/tms', translationKey: 'sidebar.logistics.tms', icon: 'local_shipping' },
      { path: '/logistics/3pl', translationKey: 'sidebar.logistics.3pl', icon: 'inventory' },
    ],
  },

  // 26) GRC
  {
    groupTranslationKey: 'sidebar.groups.grc',
    items: [
      { path: '/grc/risks', translationKey: 'sidebar.grc.risks', icon: 'warning' },
      { path: '/grc/controls', translationKey: 'sidebar.grc.controls', icon: 'tune' },
      { path: '/grc/certifications', translationKey: 'sidebar.grc.certifications', icon: 'verified' },
    ],
  },

  // 27) ESG
  {
    groupTranslationKey: 'sidebar.groups.esg',
    items: [
      { path: '/esg/data', translationKey: 'sidebar.esg.data', icon: 'bar_chart' },
      { path: '/esg/reports', translationKey: 'sidebar.esg.reports', icon: 'analytics' },
      { path: '/esg/audit', translationKey: 'sidebar.esg.audit', icon: 'search' },
    ],
  },

  // 28) Data & Data Governance
  {
    groupTranslationKey: 'sidebar.groups.data',
    items: [
      { path: '/data/catalog', translationKey: 'sidebar.data.catalog', icon: 'menu_book' },
      { path: '/data/lineage', translationKey: 'sidebar.data.lineage', icon: 'timeline' },
      { path: '/data/masking-sandbox', translationKey: 'sidebar.data.masking_sandbox', icon: 'mask' },
    ],
  },

  // 29) Mobile / PWA
  {
    groupTranslationKey: 'sidebar.groups.mobile',
    items: [
      { path: '/mobile/approvals', translationKey: 'sidebar.mobile.approvals', icon: 'rule' },
      { path: '/mobile/expenses', translationKey: 'sidebar.mobile.expenses', icon: 'paid' },
    ],
  },
];
