import { Routes } from '@angular/router';
import { AccountingLayout } from './layout/accounting.layout';

export const ACCOUNTING_ROUTES: Routes = [
  {
    path: '',
    component: AccountingLayout,
    children: [
      {
        path: 'chart-of-accounts',
        title: 'PAGE_TITLES.CHART_OF_ACCOUNTS',
        loadComponent: () =>
          import('./chart-of-accounts/chart-of-accounts.page').then(
            (m) => m.ChartOfAccountsPage
          ),
      },
      {
        path: 'chart-of-accounts/segments-configuration',
        title: 'PAGE_TITLES.SEGMENT_CONFIG',
        loadComponent: () =>
          import('./chart-of-accounts/segment-configuration/segment-configuration.page').then(
            (m) => m.SegmentConfigurationPage
          ),
      },
      {
        path: 'ledgers',
        loadComponent: () =>
          import('./ledger-list/ledger-list.page').then(
            (m) => m.LedgerListPage
          ),
        title: 'PAGE_TITLES.LEDGERS',
      },
      {
        path: 'journals', // <- NUEVA RUTA
        title: 'PAGE_TITLES.JOURNALS',
        loadComponent: () =>
          import('./journal-list/journal-list.page').then(
            (m) => m.JournalListPage
          ),
      },
      {
        path: 'journals/new', // <- NUEVA RUTA
        title: 'PAGE_TITLES.JOURNAL_NEW',
        loadComponent: () =>
          import('./journal-form/journal-form.page').then(
            (m) => m.JournalFormPage
          ),
      },
      {
        path: 'general-ledger/new', // Nueva ruta
        title: 'PAGE_TITLES.LEDGER_NEW',
        loadComponent: () =>
          import('./ledger-form/app-ledger-form-page').then(
            (m) => m.LedgerFormPage
          ),
      },
      {
        path: 'journal-entries',
        title: 'PAGE_TITLES.JOURNAL_ENTRIES',
        loadComponent: () =>
          import('./journal-entries/journal-entries.page').then(
            (m) => m.JournalEntriesPage
          ),
      },
      {
        path: 'daily-journal',
        title: 'PAGE_TITLES.DAILY_JOURNAL',
        loadComponent: () =>
          import('./daily-journal/daily-journal.page').then(
            (m) => m.DailyJournalPage
          ),
      },
      {
        path: 'general-ledger',
        title: 'PAGE_TITLES.GENERAL_LEDGER',
        loadComponent: () =>
          import('./general-ledger/general-ledger.page').then(
            (m) => m.GeneralLedgerPage
          ),
      },
      {
        path: 'periods',
        title: 'PAGE_TITLES.ACCOUNTING_PERIODS',
        loadComponent: () =>
          import('./periods/periods.page').then((m) => m.PeriodsPage),
      },
      {
        path: 'closing',
        loadChildren: () =>
          import('./closing/closing.routes').then((m) => m.CLOSING_ROUTES),
      },
      {
        path: 'treasury',
        title: 'PAGE_TITLES.TREASURY',
        loadComponent: () =>
          import('./treasury/treasury.page').then((m) => m.TreasuryPage),
      },
      {
        path: 'reconciliation',
        title: 'PAGE_TITLES.ACCOUNT_RECONCILIATION',
        loadComponent: () =>
          import(
            './reconciliation/account-reconciliation/account-reconciliation.page'
          ).then((m) => m.AccountReconciliationPage),
      },
      {
        path: 'subsidiary-ledgers',
        title: 'PAGE_TITLES.SUBSIDIARY_LEDGERS',
        loadComponent: () =>
          import('./subsidiary-ledgers/subsidiary-ledgers.page').then(
            (m) => m.SubsidiaryLedgersPage
          ),
      },
      {
        path: 'variance-analysis',
        title: 'PAGE_TITLES.VARIANCE_ANALYSIS',
        loadComponent: () =>
          import('./variance-analysis/variance-analysis.page').then(
            (m) => m.VarianceAnalysisPage
          ),
      },
      {
        path: 'chart-of-accounts/new',
        title: 'PAGE_TITLES.ACCOUNT_NEW',
        loadComponent: () =>
          import('./account-form/account-form.page').then(
            (m) => m.AccountFormPage
          ),
      },
      {
        path: 'chart-of-accounts/:id/edit',
        title: 'PAGE_TITLES.ACCOUNT_EDIT',
        loadComponent: () =>
          import('./account-form/account-form.page').then(
            (m) => m.AccountFormPage
          ),
      },
      {
        path: 'journal-entries/new', // <- NUEVA RUTA
        title: 'PAGE_TITLES.JOURNAL_ENTRY_NEW',
        loadComponent: () =>
          import('./journal-entry-form/journal-entry-form.page').then(
            (m) => m.JournalEntryFormPage
          ),
      },
      {
        path: 'journal-entries/import',
        title: 'PAGE_TITLES.JOURNAL_ENTRY_IMPORT',
        loadComponent: () =>
          import('./journal-entries/import/import.page').then(
            (m) => m.JournalEntryImportPage
          ),
      },
      {
        path: 'journal-entries/:id/edit', // <- NUEVA RUTA
        title: 'PAGE_TITLES.JOURNAL_ENTRY_EDIT',
        loadComponent: () =>
          import('./journal-entry-form/journal-entry-form.page').then(
            (m) => m.JournalEntryFormPage
          ),
      },

      {
        path: 'general-ledger/:accountId',
        loadComponent: () =>
          import('./general-ledger/general-ledger.page').then(
            (m) => m.GeneralLedgerPage
          ),
      },

      {
        path: '',
        redirectTo: 'chart-of-accounts',
        pathMatch: 'full',
      },
    ],
  },
];
