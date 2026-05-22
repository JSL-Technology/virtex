import { Routes } from '@angular/router';
import { AccountingLayout } from './layout/accounting.layout';

export const ACCOUNTING_ROUTES: Routes = [
  {
    path: '',
    component: AccountingLayout,
    children: [
      {
        path: 'chart-of-accounts',
        title: 'Chart of Accounts',
        loadComponent: () =>
          import('./chart-of-accounts/chart-of-accounts.page').then(
            (m) => m.ChartOfAccountsPage
          ),
      },
      {
        path: 'chart-of-accounts/segments-configuration',
        title: 'Configuración de Segmentos',
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
        title: 'Libros Contables',
      },
      {
        path: 'journals', // <- NUEVA RUTA
        title: 'Journals',
        loadComponent: () =>
          import('./journal-list/journal-list.page').then(
            (m) => m.JournalListPage
          ),
      },
      {
        path: 'journals/new', // <- NUEVA RUTA
        title: 'New Journal',
        loadComponent: () =>
          import('./journal-form/journal-form.page').then(
            (m) => m.JournalFormPage
          ),
      },
      {
        path: 'general-ledger/new', // Nueva ruta
        title: 'New General Ledger',
        loadComponent: () =>
          import('./ledger-form/app-ledger-form-page').then(
            (m) => m.LedgerFormPage
          ),
      },
      {
        path: 'journal-entries',
        title: 'Journal Entries',
        loadComponent: () =>
          import('./journal-entries/journal-entries.page').then(
            (m) => m.JournalEntriesPage
          ),
      },
      {
        path: 'daily-journal',
        title: 'Daily Journal',
        loadComponent: () =>
          import('./daily-journal/daily-journal.page').then(
            (m) => m.DailyJournalPage
          ),
      },
      {
        path: 'general-ledger',
        title: 'General Ledger',
        loadComponent: () =>
          import('./general-ledger/general-ledger.page').then(
            (m) => m.GeneralLedgerPage
          ),
      },
      {
        path: 'periods',
        title: 'Accounting Periods',
        loadComponent: () =>
          import('./periods/periods.page').then((m) => m.PeriodsPage),
      },
      {
        path: 'closing',
        loadChildren: () =>
          import('./closing/closing.routes').then((m) => m.CLOSING_ROUTES),
      },
      {
        path: 'reconciliation',
        title: 'Account Reconciliation',
        loadComponent: () =>
          import(
            './reconciliation/account-reconciliation/account-reconciliation.page'
          ).then((m) => m.AccountReconciliationPage),
      },
      {
        path: 'subsidiary-ledgers',
        title: 'Subsidiary Ledgers',
        loadComponent: () =>
          import('./subsidiary-ledgers/subsidiary-ledgers.page').then(
            (m) => m.SubsidiaryLedgersPage
          ),
      },
      {
        path: 'variance-analysis',
        title: 'Variance Analysis',
        loadComponent: () =>
          import('./variance-analysis/variance-analysis.page').then(
            (m) => m.VarianceAnalysisPage
          ),
      },
      {
        path: 'chart-of-accounts/new',
        title: 'New Account',
        loadComponent: () =>
          import('./account-form/account-form.page').then(
            (m) => m.AccountFormPage
          ),
      },
      {
        path: 'chart-of-accounts/:id/edit',
        title: 'Edit Account',
        loadComponent: () =>
          import('./account-form/account-form.page').then(
            (m) => m.AccountFormPage
          ),
      },
      {
        path: 'journal-entries/new', // <- NUEVA RUTA
        title: 'New Journal Entry',
        loadComponent: () =>
          import('./journal-entry-form/journal-entry-form.page').then(
            (m) => m.JournalEntryFormPage
          ),
      },
      {
        path: 'journal-entries/import',
        title: 'Import Journal Entries',
        loadComponent: () =>
          import('./journal-entries/import/import.page').then(
            (m) => m.JournalEntryImportPage
          ),
      },
      {
        path: 'journal-entries/:id/edit', // <- NUEVA RUTA
        title: 'Edit Journal Entry',
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
