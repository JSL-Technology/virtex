import { Routes } from '@angular/router';
import { PurchasingLayout } from './layout/purchasing.layout';

export const PURCHASING_ROUTES: Routes = [
    {
        path: '',
        component: PurchasingLayout,
        children: [
            {
                path: 'orders',
                title: 'Purchase Orders',
                loadComponent: () => import('./orders/orders.page').then(m => m.OrdersPage)
            },
            {
                path: 'requisitions',
                title: 'Purchase Requisitions',
                loadComponent: () => import('./requisitions/requisitions.page').then(m => m.RequisitionsPage)
            },
            // Aquí irían las rutas para /requisitions, /receipts, etc.
            {
                path: '',
                redirectTo: 'orders',
                pathMatch: 'full'
            }
        ]
    }
];