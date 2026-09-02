import { Routes } from '@angular/router';

export const CUSTOMER_RECEIPTS_ROUTES: Routes = [
    {
        path: '',
        title: 'PAGE_TITLES.CUSTOMER_RECEIPTS',
        loadComponent: () => import('./list/list.page').then(m => m.CustomerReceiptsListPage)
    },
    {
        path: 'new',
        title: 'PAGE_TITLES.CUSTOMER_RECEIPT_NEW',
        loadComponent: () => import('./form/form.page').then(m => m.CustomerReceiptFormPage)
    }
];
