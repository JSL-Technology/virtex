import { Routes } from '@angular/router';

export const INVOICES_ROUTES: Routes = [
    {
        path: '',
        title: 'PAGE_TITLES.INVOICES',
        loadComponent: () => import('./list/list.page').then(m => m.InvoicesListPage)
    },
    {
        path: 'new',
        title: 'PAGE_TITLES.INVOICE_NEW',
        loadComponent: () => import('./new/new.page').then(m => m.NewInvoicePage)
    },
    // Descomentamos la ruta
    {
        path: ':id',
        title: 'PAGE_TITLES.INVOICE_DETAIL',
        loadComponent: () => import('./detail/detail.page').then(m => m.InvoiceDetailPage)
    }
];