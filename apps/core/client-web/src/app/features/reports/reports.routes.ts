import { Routes } from '@angular/router';
import { ReportsLayout } from './layout/reports.layout';

export const REPORTS_ROUTES: Routes = [
  {
    path: '',
    component: ReportsLayout,
    children: [
      {
        path: 'profitability-by-product',
        title: 'Profitability by Product',
        loadComponent: () => import('./profitability-by-product/profitability-by-product.page').then(m => m.ProfitabilityByProductPage)
      },
      {
        path: 'profitability-by-customer',
        title: 'Profitability by Customer',
        loadComponent: () => import('./profitability-by-customer/profitability-by-customer.page').then(m => m.ProfitabilityByCustomerPage)
      },
      {
        path: 'financial-statements/balance-sheet', // Ruta específica para el Balance General
        title: 'Balance Sheet',
        loadComponent: () => import('./financial-statements/balance-sheet/balance-sheet.page').then(m => m.BalanceSheetPage)
      },
      // Redirección para la sección de estados financieros
      {
        path: 'financial-statements',
        redirectTo: 'financial-statements/balance-sheet',
        pathMatch: 'full',
      },
      // Aquí irían las rutas para /comparative, etc.
      {
        path: '',
        redirectTo: 'profitability-by-product',
        pathMatch: 'full'
      }
    ]
  }
];