import { Routes } from '@angular/router';

export const CUSTOMER_RECEIPTS_ROUTES: Routes = [
    {
        path: '',
        title: 'Recibos de Cliente',
        loadComponent: () => import('./list/list.page').then(m => m.CustomerReceiptsListPage)
    },
    {
        path: 'new',
        title: 'Nuevo Recibo de Cliente',
        loadComponent: () => import('./form/form.page').then(m => m.CustomerReceiptFormPage)
    }
];
