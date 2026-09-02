import { Routes } from '@angular/router';

export const ACCOUNTS_PAYABLE_ROUTES: Routes = [
    {
        path: '',
        title: 'PAGE_TITLES.VENDOR_BILLS',
        loadComponent: () => import('./list/list.page').then(m => m.VendorBillsListPage)
    },
    {
        path: 'new',
        title: 'PAGE_TITLES.VENDOR_BILL_NEW',
        loadComponent: () => import('./form/form.page').then(m => m.VendorBillFormPage)
    },
    {
        path: ':id/edit',
        title: 'PAGE_TITLES.VENDOR_BILL_EDIT',
        loadComponent: () => import('./form/form.page').then(m => m.VendorBillFormPage)
    },
    {
        path: ':id',
        title: 'PAGE_TITLES.VENDOR_BILL_DETAIL',
        loadComponent: () => import('./detail/detail.page').then(m => m.VendorBillDetailPage)
    }
];
