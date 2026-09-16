export const SALES_PERMISSIONS = {
  INVOICES_VIEW: 'invoices:view',
  INVOICES_CREATE: 'invoices:create',
  INVOICES_EDIT: 'invoices:edit',
  INVOICES_VOID: 'invoices:void',

  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_EDIT: 'customers:edit',
  CUSTOMERS_DELETE: 'customers:delete',

  BILLS_VIEW: 'bills:view',
  BILLS_CREATE: 'bills:create',
  BILLS_EDIT: 'bills:edit',
  BILLS_APPROVE: 'bills:approve',

  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_EDIT: 'suppliers:edit',
  SUPPLIERS_DELETE: 'suppliers:delete',

  /**
   * Procurement: purchase requisitions and the supplier-portal roster. These modules used to
   * expose no controller at all, then a controller with neither tenant scoping nor validation.
   * A dedicated permission is what lets a role grant "raise a requisition" without granting the
   * ledger.
   */
  PROCUREMENT_VIEW: 'procurement:view',
  PROCUREMENT_MANAGE: 'procurement:manage',
  /**
   * Approving a requisition or an order, and committing the business to a supplier.
   *
   * Separate from `PROCUREMENT_MANAGE` on purpose: raising a request and authorising the spend are
   * the two halves of the control, and a role that can do both is not a control at all.
   */
  PROCUREMENT_APPROVE: 'procurement:approve',
} as const;
