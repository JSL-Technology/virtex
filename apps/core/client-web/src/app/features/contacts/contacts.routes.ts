import { Routes } from '@angular/router';

export const CONTACTS_ROUTES: Routes = [
    {
        path: 'customers',
        title: 'PAGE_TITLES.CUSTOMERS',
        loadComponent: () => import('./customers/customers.page').then(m => m.CustomersPage)
    },
    {
        path: 'customers/new',
        title: 'PAGE_TITLES.CUSTOMER_NEW',
        loadComponent: () => import('./customer-form/customer-form.page').then(m => m.CustomerFormPage)
    },
    {
        path: 'customers/:id/edit',
        title: 'PAGE_TITLES.CUSTOMER_EDIT',
        loadComponent: () => import('./customer-form/customer-form.page').then(m => m.CustomerFormPage)
    },
    {
        path: 'suppliers',
        title: 'PAGE_TITLES.SUPPLIERS',
        loadComponent: () => import('./suppliers/suppliers.page').then(m => m.SuppliersPage)
    },
    { path: '', redirectTo: 'customers', pathMatch: 'full' }
];