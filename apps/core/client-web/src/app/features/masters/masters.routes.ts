import { Routes } from '@angular/router';
import { MastersLayout } from './layout/masters.layout';

export const MASTERS_ROUTES: Routes = [
    {
        path: '',
        component: MastersLayout,
        children: [
            { path: 'customers', title: 'PAGE_TITLES.CUSTOMERS', loadComponent: () => import('./customers/customer-list/customer-list.page').then(m => m.CustomerListPage) },
            { path: 'customers/new', title: 'PAGE_TITLES.CUSTOMER_NEW', loadComponent: () => import('./customers/customer-form/customer-form.page').then(m => m.CustomerFormPage) },
            { path: 'customers/:id/edit', title: 'PAGE_TITLES.CUSTOMER_EDIT', loadComponent: () => import('./customers/customer-form/customer-form.page').then(m => m.CustomerFormPage) },
            { path: 'suppliers', title: 'PAGE_TITLES.SUPPLIERS', loadComponent: () => import('./suppliers/supplier-list/supplier-list.page').then(m => m.SupplierListPage) },
            { path: 'suppliers/new', title: 'PAGE_TITLES.SUPPLIERS', loadComponent: () => import('./suppliers/supplier-form/supplier-form').then(m => m.SupplierForm) },
            { path: 'suppliers/:id/edit', title: 'PAGE_TITLES.SUPPLIER_EDIT', loadComponent: () => import('./suppliers/supplier-form/supplier-form').then(m => m.SupplierForm) },
            { path: 'products', title: 'PAGE_TITLES.PRODUCTS', loadComponent: () => import('../../features/inventory/products/products.page').then(m => m.ProductsPage) },
            { path: 'price-lists', title: 'PAGE_TITLES.PRICE_LISTS', loadComponent: () => import('./price-lists/price-lists.page').then(m => m.PriceListsPage) },
            // { path: 'price-lists/new', title: 'PAGE_TITLES.PRICE_LIST_NEW', loadComponent: () => import('./price-lists/price-lists-form/price-list-form.page').then(m => m.PriceListFormPage) },
            { path: 'price-lists/new', title: 'PAGE_TITLES.PRICE_LIST_NEW', loadComponent: () => import('./price-lists/price-lists-form/price-list-form.page').then(m => m.PriceListFormPage) },
            { path: 'price-lists/:id/edit', title: 'PAGE_TITLES.PRICE_LIST_EDIT', loadComponent: () => import('./price-lists/price-lists-form/price-list-form.page').then(m => m.PriceListFormPage) },
            { path: 'taxes', title: 'PAGE_TITLES.TAXES', loadComponent: () => import('./taxes/taxes.page').then(m => m.TaxesPage) },
            { path: 'taxes/new', title: 'PAGE_TITLES.TAX_NEW', loadComponent: () => import('./taxes/tax-form/tax-form.page').then(m => m.TaxFormPage) },
            { path: 'warehouses', title: 'PAGE_TITLES.WAREHOUSES', loadComponent: () => import('./warehouses/warehouses.page').then(m => m.WarehousesPage) },
            { path: 'units-of-measure', title: 'PAGE_TITLES.UNITS_OF_MEASURE', loadComponent: () => import('./units-of-measure/units-of-measure.page').then(m => m.UnitsOfMeasurePage) },
            { path: 'currencies', title: 'PAGE_TITLES.CURRENCIES', loadComponent: () => import('./currencies/currencies.page').then(m => m.CurrenciesPage) },
            { path: 'banks', title: 'PAGE_TITLES.BANKS', loadComponent: () => import('./banks/banks.page').then(m => m.BanksPage) },
            { path: 'branches', title: 'PAGE_TITLES.BRANCHES', loadComponent: () => import('./branches/branches.page').then(m => m.BranchesPage) },
            { path: 'payment-methods', title: 'PAGE_TITLES.PAYMENT_METHODS', loadComponent: () => import('./payment-methods/payment-methods.page').then(m => m.PaymentMethodsPage) },
            { path: 'payment-terms', title: 'PAGE_TITLES.PAYMENT_TERMS', loadComponent: () => import('./payment-terms/payment-terms.page').then(m => m.PaymentTermsPage) },
            { path: '', redirectTo: 'customers', pathMatch: 'full' }
        ]
    }
];
