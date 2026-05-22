import { Routes } from '@angular/router';

export const INVOICES_ROUTES: Routes = [
    {
        path: '',
        title: 'Facturas',
        loadComponent: () => import('./list/list.page').then(m => m.InvoicesListPage)
    },
    {
        path: 'new',
        title: 'Nueva Factura',
        loadComponent: () => import('./new/new.page').then(m => m.NewInvoicePage)
    },
    // Descomentamos la ruta
    {
        path: ':id',
        title: 'Detalle de Factura',
        loadComponent: () => import('./detail/detail.page').then(m => m.InvoiceDetailPage)
    }
];