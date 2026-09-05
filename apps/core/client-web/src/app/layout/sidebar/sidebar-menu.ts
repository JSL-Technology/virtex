import {
  LayoutDashboard, ClipboardList, CheckSquare, Bell, Search, FileText,
  Users, Truck, Package, Tag, Receipt, Ruler,
  Banknote, Landmark, Store, Warehouse, CreditCard, Clock,
  CheckCircle, Coins, ShoppingBag, ShoppingCart, Briefcase, BarChart2,
  Home
} from 'lucide-angular';

// ────────────────────────────────────────────────────────────────
// Interface definitions
// ────────────────────────────────────────────────────────────────
export interface SidebarSubItem {
  path: string;
  translationKey: string;
}

export interface SidebarItem {
  path?: string;
  translationKey: string;
  icon: any; // LucideIconData
  isExpanded?: boolean;
  subItems?: SidebarSubItem[];
}

export interface SidebarGroup {
  groupTranslationKey: string;
  items: SidebarItem[];
}

// ────────────────────────────────────────────────────────────────
// Menu Definition
// ────────────────────────────────────────────────────────────────

/**
 * The navigation menu.
 *
 * ## Every entry here leads somewhere
 *
 * It used to carry 224 links, of which **173 pointed at routes that do not exist**. Clicking one
 * did not produce an error the user could understand: the router's `**` fallback matched, so they
 * landed on a redirector and were quietly sent elsewhere. Purchasing, manufacturing, payroll,
 * logistics, tax filings, XBRL and the whole ESG group were menu entries and nothing else.
 *
 * A navigation menu is a statement about what the product does. Listing pages that were never
 * built makes every entry untrustworthy, including the fifty that worked — a user who finds three
 * dead links stops believing the fourth. The unbuilt sections belong on a roadmap, not in the
 * navigation, and they come back here the day their page does.
 *
 * `sidebar-routes.spec.ts` walks this list against the router config and fails the build if an
 * entry cannot be resolved, so the list cannot drift out of step again.
 */
export const SIDEBAR_MENU: SidebarGroup[] = [

  // ── GENERAL ───────────────────────────────────────────────────
  {
    groupTranslationKey: 'sidebar.groups.general',
    items: [
      { path: '/overview',         translationKey: 'sidebar.general.overview',      icon: Home            },
      { path: '/dashboard',        translationKey: 'sidebar.general.dashboard',     icon: LayoutDashboard },
      { path: '/my-work',          translationKey: 'sidebar.general.my_work',       icon: ClipboardList   },
      { path: '/approvals',        translationKey: 'sidebar.general.approvals',     icon: CheckSquare     },
      { path: '/notifications',    translationKey: 'sidebar.general.notifications', icon: Bell            },
      { path: '/global-search',    translationKey: 'sidebar.general.search',        icon: Search          },
      {
        translationKey: 'sidebar.general.documents', icon: FileText, isExpanded: false,
        subItems: [
          { path: '/documents',           translationKey: 'sidebar.general.documents_sub.all'       },
          { path: '/documents/templates', translationKey: 'sidebar.general.documents_sub.templates' },
        ],
      },
    ],
  },

  // ── MASTER DATA ───────────────────────────────────────────────
  {
    groupTranslationKey: 'sidebar.groups.master_data',
    items: [
      { path: '/masters/customers',        translationKey: 'sidebar.master_data.customers',        icon: Users         },
      { path: '/masters/suppliers',        translationKey: 'sidebar.master_data.suppliers',        icon: Truck         },
      { path: '/masters/products',         translationKey: 'sidebar.master_data.products',         icon: Package       },
      { path: '/masters/price-lists',      translationKey: 'sidebar.master_data.price_lists',      icon: Tag           },
      { path: '/masters/taxes',            translationKey: 'sidebar.master_data.taxes',            icon: Receipt       },
      { path: '/masters/units-of-measure', translationKey: 'sidebar.master_data.uom',              icon: Ruler         },
      { path: '/masters/currencies',       translationKey: 'sidebar.master_data.currencies',       icon: Banknote      },
      { path: '/masters/banks',            translationKey: 'sidebar.master_data.banks',            icon: Landmark      },
      { path: '/masters/branches',         translationKey: 'sidebar.master_data.branches',         icon: Store         },
      { path: '/masters/warehouses',       translationKey: 'sidebar.master_data.warehouses',       icon: Warehouse     },
      { path: '/masters/payment-methods',  translationKey: 'sidebar.master_data.payment_methods',  icon: CreditCard    },
      { path: '/masters/payment-terms',    translationKey: 'sidebar.master_data.payment_terms',    icon: Clock         },
    ],
  },

  // ── FINANCE ───────────────────────────────────────────────────
  //
  // ## Why this group is shorter than it was
  //
  // It listed ninety-odd finance entries — hedge accounting, in-house banking, dynamic
  // discounting, supply-chain finance, dunning, factoring, chargebacks — and almost none of them
  // resolved to a route. Clicking one fell through to the `**` fallback. A menu is a promise about
  // what the product does; one where four links in five lead nowhere teaches the user to distrust
  // the other one, and it hid the entries that do work among the ones that do not.
  //
  // What remains is what the application can actually open. `sidebar-routes.spec.ts` fails the
  // build if that stops being true, so the list can only grow as the routes do.
  {
    groupTranslationKey: 'sidebar.groups.finance',
    items: [
      {
        translationKey: 'sidebar.finance.gl', icon: Landmark, isExpanded: false,
        subItems: [
          { path: '/accounting/chart-of-accounts',   translationKey: 'sidebar.finance.gl_sub.coa'            },
          { path: '/accounting/journal-entries',     translationKey: 'sidebar.finance.gl_sub.journal'        },
          { path: '/accounting/daily-journal',       translationKey: 'sidebar.finance.gl_sub.book_journal'   },
          { path: '/accounting/general-ledger',      translationKey: 'sidebar.finance.gl_sub.book_gl'        },
          { path: '/accounting/subsidiary-ledgers',  translationKey: 'sidebar.finance.gl_sub.book_subledgers'},
          { path: '/accounting/ledgers',             translationKey: 'sidebar.finance.gl_sub.multi_ledger'   },
          { path: '/accounting/journals',            translationKey: 'sidebar.finance.gl_sub.journals'       },
          { path: '/accounting/periods',             translationKey: 'sidebar.finance.gl_sub.periods'        },
          { path: '/accounting/variance-analysis',   translationKey: 'sidebar.finance.gl_sub.variance_analysis' },
        ],
      },
      {
        translationKey: 'sidebar.finance.closing', icon: CheckCircle, isExpanded: false,
        subItems: [
          { path: '/accounting/closing/month-end',   translationKey: 'sidebar.finance.gl_sub.closing_monthly'  },
          { path: '/accounting/closing/annual-close',translationKey: 'sidebar.finance.gl_sub.closing_annual'   },
          { path: '/accounting/closing/checklist',   translationKey: 'sidebar.finance.gl_sub.closing_checklist'},
        ],
      },
      {
        translationKey: 'sidebar.finance.treasury', icon: Coins, isExpanded: false,
        subItems: [
          { path: '/accounting/treasury',        translationKey: 'sidebar.finance.treasury_sub.dashboard'           },
          { path: '/accounting/reconciliation',  translationKey: 'sidebar.finance.treasury_sub.reconciliation_manual' },
        ],
      },
      {
        translationKey: 'sidebar.finance.ar', icon: Receipt, isExpanded: false,
        subItems: [
          { path: '/invoices',                     translationKey: 'sidebar.finance.ar_sub.invoices'  },
          { path: '/customer-receipts',            translationKey: 'sidebar.finance.ar_sub.receipts'  },
          { path: '/reports/aging/receivables',    translationKey: 'sidebar.finance.ar_sub.aging'     },
        ],
      },
      {
        translationKey: 'sidebar.finance.ap', icon: FileText, isExpanded: false,
        subItems: [
          { path: '/accounts-payable',          translationKey: 'sidebar.finance.ap_sub.invoices' },
          { path: '/reports/aging/payables',    translationKey: 'sidebar.finance.ap_sub.aging'    },
        ],
      },
      {
        translationKey: 'sidebar.finance.statements', icon: Landmark, isExpanded: false,
        subItems: [
          { path: '/reports/financial-statements/balance-sheet',    translationKey: 'sidebar.finance.statements_sub.balance_sheet'    },
          { path: '/reports/financial-statements/income-statement', translationKey: 'sidebar.finance.statements_sub.income_statement' },
          { path: '/reports/financial-statements/trial-balance',    translationKey: 'sidebar.finance.statements_sub.trial_balance'    },
          { path: '/reports/financial-statements/cash-flow',        translationKey: 'sidebar.finance.statements_sub.cash_flow'        },
        ],
      },
    ],
  },


  // ── OPERATIONS ────────────────────────────────────────────────
  {
    groupTranslationKey: 'sidebar.groups.operations',
    items: [
      {
        translationKey: 'sidebar.operations.sales', icon: ShoppingBag, isExpanded: false,
        subItems: [
          { path: '/invoices/list',           translationKey: 'sidebar.operations.sales_sub.invoices_list'       },
          { path: '/invoices/new',            translationKey: 'sidebar.operations.sales_sub.invoices_new'        },
        ],
      },
      {
        translationKey: 'sidebar.operations.purchasing', icon: ShoppingCart, isExpanded: false,
        subItems: [
          { path: '/purchasing/requisitions',     translationKey: 'sidebar.operations.purchasing_sub.requisitions'       },
          { path: '/purchasing/orders',           translationKey: 'sidebar.operations.purchasing_sub.orders'             },
        ],
      },
    ],
  },

  // ── PSA ───────────────────────────────────────────────────────
  {
    groupTranslationKey: 'sidebar.groups.psa',
    items: [
      {
        translationKey: 'sidebar.psa.projects', icon: Briefcase, isExpanded: false,
        subItems: [
          { path: '/projects',                  translationKey: 'sidebar.psa.projects_sub.list'         },
        ],
      },
    ],
  },

  // ── REPORTS ───────────────────────────────────────────────────
  {
    groupTranslationKey: 'sidebar.groups.reports',
    items: [
      {
        translationKey: 'sidebar.reports.reporting', icon: BarChart2, isExpanded: false,
        subItems: [
          { path: '/reports/financial-statements', translationKey: 'sidebar.reports.reporting_sub.financial_statements' },
          { path: '/datasheets',                   translationKey: 'sidebar.reports.reporting_sub.datasheets'           },
        ],
      },
    ],
  },
];
