import { Routes } from '@angular/router';

export const CONTACTS_ROUTES: Routes = [
    {
        path: 'customers',
        title: 'Clientes',
        loadComponent: () => import('./customers/customers.page').then(m => m.CustomersPage)
    },
    {
        path: 'customers/new',
        title: 'Nuevo Cliente',
        loadComponent: () => import('./customer-form/customer-form.page').then(m => m.CustomerFormPage)
    },
    {
        path: 'customers/:id/edit',
        title: 'Editar Cliente',
        loadComponent: () => import('./customer-form/customer-form.page').then(m => m.CustomerFormPage)
    },
    {
        path: 'suppliers',
        title: 'Proveedores',
        loadComponent: () => import('./suppliers/suppliers.page').then(m => m.SuppliersPage)
    },
    { path: '', redirectTo: 'customers', pathMatch: 'full' }
];