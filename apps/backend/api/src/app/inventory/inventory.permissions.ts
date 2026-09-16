export const INVENTORY_PERMISSIONS = {
  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_EDIT: 'products:edit',
  PRODUCTS_DELETE: 'products:delete',
  INVENTORY_VIEW_STOCK: 'inventory:view_stock',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_TRANSFER: 'inventory:transfer',

  PRICE_LISTS_VIEW: 'price_lists:view',
  PRICE_LISTS_CREATE: 'price_lists:create',
  PRICE_LISTS_EDIT: 'price_lists:edit',
  PRICE_LISTS_DELETE: 'price_lists:delete',

  /** Units of measure. Shared by products, invoice lines and stock movements. */
  UNITS_OF_MEASURE_VIEW: 'units_of_measure:view',
  UNITS_OF_MEASURE_MANAGE: 'units_of_measure:manage',

  /** Warehouse management: warehouses, bin locations and landed-cost schemes. */
  WMS_VIEW: 'wms:view',
  WMS_MANAGE: 'wms:manage',

  /** Production orders. */
  MANUFACTURING_VIEW: 'manufacturing:view',
  MANUFACTURING_MANAGE: 'manufacturing:manage',
} as const;
