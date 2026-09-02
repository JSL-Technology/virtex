import { Routes } from '@angular/router';

export const SALES_ROUTES: Routes = [
  {
    path: 'history',
    title: 'PAGE_TITLES.SALES_HISTORY',
    loadComponent: () => import('./history/history.page').then(m => m.HistoryPage)
  },
  {
    path: 'pos',
    title: 'PAGE_TITLES.POINT_OF_SALE',
    loadComponent: () => import('./pos/pos.page').then(m => m.PosPage)
  },
  {
    path: '',
    redirectTo: 'history',
    pathMatch: 'full'
  }
];