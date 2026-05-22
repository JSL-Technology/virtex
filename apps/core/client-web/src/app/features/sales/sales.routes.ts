import { Routes } from '@angular/router';

export const SALES_ROUTES: Routes = [
  {
    path: 'history',
    title: 'Historial de Ventas',
    loadComponent: () => import('./history/history.page').then(m => m.HistoryPage)
  },
  {
    path: 'pos',
    title: 'Punto de Venta',
    loadComponent: () => import('./pos/pos.page').then(m => m.PosPage)
  },
  {
    path: '',
    redirectTo: 'history',
    pathMatch: 'full'
  }
];