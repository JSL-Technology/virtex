import { Routes } from '@angular/router';

export const INVENTORY_ROUTES: Routes = [
    {
        path: 'products',
        title: 'PAGE_TITLES.PRODUCTS',
        loadComponent: () => import('./products/products.page').then(m => m.ProductsPage)
    },
    {
        path: 'products/new',
        title: 'PAGE_TITLES.PRODUCT_NEW',
        loadComponent: () => import('./product-form/product-form.page').then(m => m.ProductFormPage)
    },
    {
        path: 'products/:id/edit',
        title: 'PAGE_TITLES.PRODUCT_EDIT',
        loadComponent: () => import('./product-form/product-form.page').then(m => m.ProductFormPage)
    },
    {
        path: 'categories',
        title: 'PAGE_TITLES.CATEGORIES',
        loadComponent: () => import('./categories/categories.page').then(m => m.CategoriesPage)
    },
    { path: '', redirectTo: 'products', pathMatch: 'full' }
];