import { Routes } from '@angular/router';

export const ACCOUNTS_PAYABLE_ROUTES: Routes = [
    {
        path: '',
        title: 'Facturas de Proveedor',
        loadComponent: () => import('./list/list.page').then(m => m.VendorBillsListPage)
    },
    {
        path: 'new',
        title: 'Nueva Factura de Proveedor',
        loadComponent: () => import('./form/form.page').then(m => m.VendorBillFormPage)
    },
    {
        path: ':id/edit',
        title: 'Editar Factura de Proveedor',
        loadComponent: () => import('./form/form.page').then(m => m.VendorBillFormPage)
    },
    {
        path: ':id',
        title: 'Detalle de Factura de Proveedor',
        loadComponent: () => import('./detail/detail.page').then(m => m.VendorBillDetailPage)
    }
];
