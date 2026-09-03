import { Routes } from '@angular/router';
import { ReportsLayout } from './layout/reports.layout';

export const REPORTS_ROUTES: Routes = [
  {
    path: '',
    component: ReportsLayout,
    children: [
      {
        path: 'profitability-by-product',
        title: 'PAGE_TITLES.PROFITABILITY_PRODUCT',
        loadComponent: () => import('./profitability-by-product/profitability-by-product.page').then(m => m.ProfitabilityByProductPage)
      },
      {
        path: 'profitability-by-customer',
        title: 'PAGE_TITLES.PROFITABILITY_CUSTOMER',
        loadComponent: () => import('./profitability-by-customer/profitability-by-customer.page').then(m => m.ProfitabilityByCustomerPage)
      },
      {
        path: 'financial-statements/balance-sheet',
        title: 'PAGE_TITLES.BALANCE_SHEET',
        loadComponent: () =>
          import('./financial-statements/balance-sheet/balance-sheet.page').then(
            (m) => m.BalanceSheetPage,
          ),
      },
      // The other three statements. Every one of them was already computed on the server and
      // rendered nowhere: the product could show a balance sheet and nothing to support it.
      {
        path: 'financial-statements/income-statement',
        title: 'PAGE_TITLES.INCOME_STATEMENT',
        loadComponent: () =>
          import('./financial-statements/income-statement/income-statement.page').then(
            (m) => m.IncomeStatementPage,
          ),
      },
      {
        path: 'financial-statements/trial-balance',
        title: 'PAGE_TITLES.TRIAL_BALANCE',
        loadComponent: () =>
          import('./financial-statements/trial-balance/trial-balance.page').then(
            (m) => m.TrialBalancePage,
          ),
      },
      {
        path: 'financial-statements/cash-flow',
        title: 'PAGE_TITLES.CASH_FLOW',
        loadComponent: () =>
          import('./financial-statements/cash-flow/cash-flow.page').then((m) => m.CashFlowPage),
      },
      {
        path: 'financial-statements',
        redirectTo: 'financial-statements/balance-sheet',
        pathMatch: 'full',
      },
      // Ageing, on both sides. Neither existed: the report a treasurer opens to decide what to pay
      // next, and the one an auditor asks for to substantiate the payable and receivable balances.
      {
        path: 'aging/payables',
        title: 'PAGE_TITLES.ACCOUNTS_PAYABLE_AGING',
        loadComponent: () => import('./aging/aging.page').then((m) => m.AgingPage),
        data: { side: 'payables' },
      },
      {
        path: 'aging/receivables',
        title: 'PAGE_TITLES.ACCOUNTS_RECEIVABLE_AGING',
        loadComponent: () => import('./aging/aging.page').then((m) => m.AgingPage),
        data: { side: 'receivables' },
      },
      {
        path: '',
        redirectTo: 'profitability-by-product',
        pathMatch: 'full'
      }
    ]
  }
];