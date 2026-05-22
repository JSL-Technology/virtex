import { Routes } from '@angular/router';
import { MastersLayout } from './layout/masters.layout';

export const MASTERS_ROUTES: Routes = [
    {
        path: '',
        component: MastersLayout,
        children: [
            { path: 'customers', title: 'Customers', loadComponent: () => import('./customers/customer-list/customer-list.page').then(m => m.CustomerListPage) },
            { path: 'customers/new', title: 'New Customer', loadComponent: () => import('./customers/customer-form/customer-form.page').then(m => m.CustomerFormPage) },
            { path: 'customers/:id/edit', title: 'Edit Customer', loadComponent: () => import('./customers/customer-form/customer-form.page').then(m => m.CustomerFormPage) },
            { path: 'suppliers', title: 'Suppliers', loadComponent: () => import('./suppliers/supplier-list/supplier-list.page').then(m => m.SupplierListPage) },
            { path: 'suppliers/new', title: 'Suppliers', loadComponent: () => import('./suppliers/supplier-form/supplier-form').then(m => m.SupplierForm) },
            { path: 'suppliers/:id/edit', title: 'Edit Supplier', loadComponent: () => import('./suppliers/supplier-form/supplier-form').then(m => m.SupplierForm) },
            { path: 'products', title: 'Products', loadComponent: () => import('../../features/inventory/products/products.page').then(m => m.ProductsPage) },
            { path: 'price-lists', title: 'Price Lists', loadComponent: () => import('./price-lists/price-lists.page').then(m => m.PriceListsPage) },
            // { path: 'price-lists/new', title: 'New Price List', loadComponent: () => import('./price-lists/price-list-form/price-list-form.page').then(m => m.PriceListFormPage) },
            { path: 'price-lists/new', title: 'New Price List', loadComponent: () => import('./price-lists/price-lists-form/price-list-form.page').then(m => m.PriceListFormPage) },
            { path: 'price-lists/:id/edit', title: 'Edit Price List', loadComponent: () => import('./price-lists/price-lists-form/price-list-form.page').then(m => m.PriceListFormPage) },
            { path: 'taxes', title: 'Taxes', loadComponent: () => import('./taxes/taxes.page').then(m => m.TaxesPage) },
            { path: 'taxes/new', title: 'New Tax', loadComponent: () => import('./taxes/tax-form/tax-form.page').then(m => m.TaxFormPage) },
            { path: 'warehouses', title: 'Warehouses', loadComponent: () => import('./warehouses/warehouses.page').then(m => m.WarehousesPage) },
            { path: 'units-of-measure', title: 'Units of Measure', loadComponent: () => import('./units-of-measure/units-of-measure.page').then(m => m.UnitsOfMeasurePage) },
            { path: 'currencies', title: 'Currencies', loadComponent: () => import('./currencies/currencies.page').then(m => m.CurrenciesPage) },
            { path: 'banks', title: 'Banks', loadComponent: () => import('./banks/banks.page').then(m => m.BanksPage) },
            { path: 'branches', title: 'Branches', loadComponent: () => import('./branches/branches.page').then(m => m.BranchesPage) },
            { path: 'payment-methods', title: 'Payment Methods', loadComponent: () => import('./payment-methods/payment-methods.page').then(m => m.PaymentMethodsPage) },
            { path: 'payment-terms', title: 'Payment Terms', loadComponent: () => import('./payment-terms/payment-terms.page').then(m => m.PaymentTermsPage) },
            { path: '', redirectTo: 'customers', pathMatch: 'full' }
        ]
    }
];
