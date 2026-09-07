import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Inventory: what the company holds.
 *
 * Products, warehouses and units of measure are inventory entities, not generic catalogue rows,
 * so they are declared by the module that governs them. `/masters/products` used to load the very
 * same component as `/inventory/products`; only the second is declared here, and the first
 * redirects, so one screen has one address.
 */
export const INVENTARIO_MODULE: ModuleManifest = {
  id: 'inventario',
  titleKey: 'MODULES.INVENTORY',
  icon: 'Package',
  basePath: 'inventory',
  order: 3,
  routes: [
    {
      path: 'products',
      kind: WindowKind.LIST,
      permission: 'products:view',
      titleKey: 'PAGE_TITLES.PRODUCTS',
      icon: 'Package',
      entityKeyFn: () => 'inventario:products',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.products' },
      load: () => import('../../../features/inventory/products/products.page').then((m) => m.ProductsPage),
    },
    {
      path: 'products/new',
      kind: WindowKind.DRAFT,
      permission: 'products:create',
      titleKey: 'PAGE_TITLES.PRODUCT_NEW',
      icon: 'PackagePlus',
      entityKeyFn: () => `inventario:product:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/inventory/product-form/product-form.page').then((m) => m.ProductFormPage),
    },
    {
      path: 'products/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'products:edit',
      titleKey: 'PAGE_TITLES.PRODUCT_EDIT',
      icon: 'PackageSearch',
      entityKeyFn: (p) => `inventario:product:${p['id']}`,
      load: () => import('../../../features/inventory/product-form/product-form.page').then((m) => m.ProductFormPage),
    },
    {
      path: 'categories',
      kind: WindowKind.LIST,
      permission: 'products:view',
      titleKey: 'PAGE_TITLES.CATEGORIES',
      icon: 'FolderTree',
      entityKeyFn: () => 'inventario:categories',
      load: () => import('../../../features/inventory/categories/categories.page').then((m) => m.CategoriesPage),
    },
  ],
};

/** Warehouses and units of measure keep their `/masters/*` addresses; only their owner changes. */
export const INVENTARIO_MASTERS_MODULE: ModuleManifest = {
  id: 'inventario-masters',
  titleKey: 'MODULES.INVENTORY',
  icon: 'Warehouse',
  basePath: 'masters',
  order: 3.1,
  hidden: true,
  routes: [
    {
      path: 'warehouses',
      kind: WindowKind.LIST,
      permission: 'inventory:view_stock',
      titleKey: 'PAGE_TITLES.WAREHOUSES',
      icon: 'Warehouse',
      entityKeyFn: () => 'inventario:warehouses',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.warehouses' },
      load: () => import('../../../features/masters/warehouses/warehouses.page').then((m) => m.WarehousesPage),
    },
    {
      path: 'units-of-measure',
      kind: WindowKind.LIST,
      permission: 'units_of_measure:view',
      titleKey: 'PAGE_TITLES.UNITS_OF_MEASURE',
      icon: 'Ruler',
      entityKeyFn: () => 'inventario:uom',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.uom' },
      load: () => import('../../../features/masters/units-of-measure/units-of-measure.page').then((m) => m.UnitsOfMeasurePage),
    },
  ],
};
