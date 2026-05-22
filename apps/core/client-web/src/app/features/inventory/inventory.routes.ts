import { Routes } from '@angular/router';

export const INVENTORY_ROUTES: Routes = [
    {
        path: 'products',
        title: 'Productos',
        loadComponent: () => import('./products/products.page').then(m => m.ProductsPage)
    },
    {
        path: 'products/new',
        title: 'Nuevo Producto',
        loadComponent: () => import('./product-form/product-form.page').then(m => m.ProductFormPage)
    },
    {
        path: 'products/:id/edit',
        title: 'Editar Producto',
        loadComponent: () => import('./product-form/product-form.page').then(m => m.ProductFormPage)
    },
    {
        path: 'categories',
        title: 'Categorías',
        loadComponent: () => import('./categories/categories.page').then(m => m.CategoriesPage)
    },
    { path: '', redirectTo: 'products', pathMatch: 'full' }
];