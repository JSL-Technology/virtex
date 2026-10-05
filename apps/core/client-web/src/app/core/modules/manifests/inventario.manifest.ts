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
  titleKey: 'modules.inventory',
  icon: 'Package',
  basePath: 'inventory',
  order: 3,
  routes: [
    {
      path: 'products',
      kind: WindowKind.LIST,
      permission: 'products:view',
      titleKey: 'page_titles.products',
      icon: 'Package',
      entityKeyFn: () => 'inventario:products',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.products' },
      load: () => import('../../../features/inventory/products/products.page').then((m) => m.ProductsPage),
    },
    {
      path: 'products/new',
      kind: WindowKind.DRAFT,
      permission: 'products:create',
      titleKey: 'page_titles.product_new',
      icon: 'PackagePlus',
      entityKeyFn: () => 'inventario:product:new',
      load: () => import('../../../features/inventory/product-form/product-form.page').then((m) => m.ProductFormPage),
    },
    {
      path: 'products/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'products:edit',
      titleKey: 'page_titles.product_edit',
      icon: 'PackageSearch',
      entityKeyFn: (p) => `inventario:product:${p['id']}`,
      load: () => import('../../../features/inventory/product-form/product-form.page').then((m) => m.ProductFormPage),
    },
    //  Lo que se tiene, dónde y cómo llegó. Sin estas pantallas el módulo eran cuatro catálogos y
    //  la cantidad en existencia era un campo editable del artículo (auditoría H-01, H-02).
    {
      path: 'stock',
      kind: WindowKind.LIST,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.stock_on_hand',
      icon: 'Boxes',
      entityKeyFn: () => 'inventario:stock',
      menu: { group: 'analysis', labelKey: 'page_titles.stock_on_hand' },
      load: () => import('../../../features/inventory/stock/stock.page').then((m) => m.StockPage),
    },
    {
      path: 'movements',
      kind: WindowKind.LIST,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.stock_movements',
      icon: 'History',
      entityKeyFn: () => 'inventario:movements',
      menu: { group: 'analysis', labelKey: 'page_titles.stock_movements' },
      load: () => import('../../../features/inventory/movements/movements.page').then((m) => m.StockMovementsPage),
    },
    {
      path: 'adjustments',
      kind: WindowKind.LIST,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.inventory_adjustments',
      icon: 'ClipboardCheck',
      entityKeyFn: () => 'inventario:adjustments',
      menu: { group: 'documents', labelKey: 'page_titles.inventory_adjustments' },
      load: () => import('../../../features/inventory/adjustments/adjustments.page').then((m) => m.InventoryAdjustmentsPage),
    },
    // Declared before ':id' so the literal never loses the match to the parameter.
    {
      path: 'adjustments/new',
      kind: WindowKind.DRAFT,
      permission: 'inventory:adjust',
      titleKey: 'page_titles.inventory_adjustment_new',
      icon: 'ClipboardPlus',
      entityKeyFn: () => 'inventario:adjustment:new',
      load: () => import('../../../features/inventory/adjustments/adjustment-form.page').then((m) => m.InventoryAdjustmentFormPage),
    },
    {
      path: 'adjustments/:id',
      kind: WindowKind.DRAFT,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.inventory_adjustment',
      icon: 'ClipboardCheck',
      entityKeyFn: (p) => `inventario:adjustment:${p['id']}`,
      load: () => import('../../../features/inventory/adjustments/adjustment-form.page').then((m) => m.InventoryAdjustmentFormPage),
    },
    {
      path: 'transfers',
      kind: WindowKind.LIST,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.stock_transfers',
      icon: 'ArrowLeftRight',
      entityKeyFn: () => 'inventario:transfers',
      menu: { group: 'documents', labelKey: 'page_titles.stock_transfers' },
      load: () => import('../../../features/inventory/transfers/transfers.page').then((m) => m.StockTransfersPage),
    },
    {
      path: 'transfers/new',
      kind: WindowKind.DRAFT,
      permission: 'inventory:transfer',
      titleKey: 'page_titles.stock_transfer_new',
      icon: 'ArrowLeftRight',
      entityKeyFn: () => 'inventario:transfer:new',
      load: () => import('../../../features/inventory/transfers/transfer-form.page').then((m) => m.StockTransferFormPage),
    },
    {
      path: 'transfers/:id',
      kind: WindowKind.DRAFT,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.stock_transfer',
      icon: 'ArrowLeftRight',
      entityKeyFn: (p) => `inventario:transfer:${p['id']}`,
      load: () => import('../../../features/inventory/transfers/transfer-form.page').then((m) => m.StockTransferFormPage),
    },
    {
      path: 'categories',
      kind: WindowKind.LIST,
      permission: 'products:view',
      titleKey: 'page_titles.categories',
      icon: 'FolderTree',
      entityKeyFn: () => 'inventario:categories',
      //  It had no menu entry and nothing linked to it, so the page existed for nobody.
      menu: { group: 'configuration', labelKey: 'page_titles.categories' },
      load: () => import('../../../features/inventory/categories/categories.page').then((m) => m.CategoriesPage),
    },
  ],
};

/**
 * Warehouses and units of measure keep their `/masters/*` addresses; only their owner changes.
 *
 * `panelOf` and not `hidden`: they are part of Inventory, so they belong in Inventory's panel. Kept
 * hidden they were reachable from no menu at all.
 */
export const INVENTARIO_MASTERS_MODULE: ModuleManifest = {
  id: 'inventario-masters',
  titleKey: 'modules.inventory',
  icon: 'Warehouse',
  basePath: 'masters',
  order: 3.1,
  panelOf: 'inventario',
  routes: [
    {
      path: 'warehouses',
      kind: WindowKind.LIST,
      permission: 'inventory:view_stock',
      titleKey: 'page_titles.warehouses',
      icon: 'Warehouse',
      entityKeyFn: () => 'inventario:warehouses',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.warehouses' },
      load: () => import('../../../features/masters/warehouses/warehouses.page').then((m) => m.WarehousesPage),
    },
    {
      path: 'units-of-measure',
      kind: WindowKind.LIST,
      permission: 'units_of_measure:view',
      titleKey: 'page_titles.units_of_measure',
      icon: 'Ruler',
      entityKeyFn: () => 'inventario:uom',
      menu: { group: 'configuration', labelKey: 'sidebar.master_data.uom' },
      load: () => import('../../../features/masters/units-of-measure/units-of-measure.page').then((m) => m.UnitsOfMeasurePage),
    },
  ],
};
