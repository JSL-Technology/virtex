import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Purchasing: what the company buys, and what it owes for it.
 *
 * Suppliers live here for the same reason customers live in Sales. The two requisition and order
 * screens are still showing hardcoded rows — there is no purchasing controller behind them — and
 * they stay declared so the gap is visible in one place instead of being hidden by a menu that
 * silently omits them.
 */
export const COMPRAS_MODULE: ModuleManifest = {
  id: 'compras',
  titleKey: 'MODULES.PURCHASING',
  icon: 'ShoppingCart',
  basePath: '',
  order: 2,
  routes: [
    {
      path: 'accounts-payable',
      kind: WindowKind.LIST,
      permission: 'accounts_payable:view',
      titleKey: 'PAGE_TITLES.VENDOR_BILLS',
      icon: 'FileText',
      entityKeyFn: () => 'compras:bills',
      menu: { group: 'documents', labelKey: 'sidebar.finance.ap_sub.invoices' },
      load: () => import('../../../features/accounts-payable/list/list.page').then((m) => m.VendorBillsListPage),
    },
    {
      path: 'accounts-payable/new',
      kind: WindowKind.DRAFT,
      permission: 'accounts_payable:create',
      titleKey: 'PAGE_TITLES.VENDOR_BILL_NEW',
      icon: 'FilePlus',
      entityKeyFn: () => `compras:bill:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/accounts-payable/form/form.page').then((m) => m.VendorBillFormPage),
    },
    {
      // Declared before ':id' so the literal never loses the match to the parameter.
      path: 'accounts-payable/payments',
      kind: WindowKind.DRAFT,
      permission: 'accounts_payable:pay',
      titleKey: 'PAGE_TITLES.VENDOR_PAYMENT',
      icon: 'Banknote',
      entityKeyFn: () => 'compras:payments',
      menu: { group: 'documents', labelKey: 'PAGE_TITLES.VENDOR_PAYMENT' },
      load: () => import('../../../features/accounts-payable/payment/payment.page').then((m) => m.VendorPaymentPage),
    },
    {
      path: 'accounts-payable/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'accounts_payable:edit',
      titleKey: 'PAGE_TITLES.VENDOR_BILL_EDIT',
      icon: 'FilePen',
      entityKeyFn: (p) => `compras:bill:${p['id']}:edit`,
      load: () => import('../../../features/accounts-payable/form/form.page').then((m) => m.VendorBillFormPage),
    },
    {
      path: 'accounts-payable/:id',
      kind: WindowKind.DOCUMENT,
      permission: 'accounts_payable:view',
      icon: 'FileText',
      titleFn: (p, d) => `Factura de proveedor ${(d as { number?: string })?.number ?? p['id']}`,
      entityKeyFn: (p) => `compras:bill:${p['id']}`,
      load: () => import('../../../features/accounts-payable/detail/detail.page').then((m) => m.VendorBillDetailPage),
    },
    {
      path: 'masters/suppliers',
      kind: WindowKind.LIST,
      permission: 'suppliers:view',
      titleKey: 'PAGE_TITLES.SUPPLIERS',
      icon: 'Truck',
      entityKeyFn: () => 'compras:suppliers',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.suppliers' },
      load: () => import('../../../features/masters/suppliers/supplier-list/supplier-list.page').then((m) => m.SupplierListPage),
    },
    {
      path: 'masters/suppliers/new',
      kind: WindowKind.DRAFT,
      permission: 'suppliers:create',
      titleKey: 'PAGE_TITLES.SUPPLIERS',
      icon: 'Truck',
      entityKeyFn: () => `compras:supplier:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/masters/suppliers/supplier-form/supplier-form').then((m) => m.SupplierForm),
    },
    {
      path: 'masters/suppliers/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'suppliers:edit',
      titleKey: 'PAGE_TITLES.SUPPLIER_EDIT',
      icon: 'Truck',
      entityKeyFn: (p) => `compras:supplier:${p['id']}`,
      load: () => import('../../../features/masters/suppliers/supplier-form/supplier-form').then((m) => m.SupplierForm),
    },
    {
      path: 'purchasing/orders',
      kind: WindowKind.LIST,
      permission: 'bills:view',
      titleKey: 'PAGE_TITLES.PURCHASE_ORDERS',
      icon: 'ClipboardList',
      entityKeyFn: () => 'compras:orders',
      menu: { group: 'documents', labelKey: 'sidebar.operations.purchasing_sub.orders' },
      load: () => import('../../../features/purchasing/orders/orders.page').then((m) => m.OrdersPage),
    },
    {
      path: 'purchasing/requisitions',
      kind: WindowKind.LIST,
      permission: 'bills:view',
      titleKey: 'PAGE_TITLES.PURCHASE_REQUISITIONS',
      icon: 'ClipboardCheck',
      entityKeyFn: () => 'compras:requisitions',
      menu: { group: 'documents', labelKey: 'sidebar.operations.purchasing_sub.requisitions' },
      load: () => import('../../../features/purchasing/requisitions/requisitions.page').then((m) => m.RequisitionsPage),
    },
    {
      path: 'reports/aging/payables',
      kind: WindowKind.OVERVIEW,
      permission: 'accounts_payable:view',
      titleKey: 'PAGE_TITLES.ACCOUNTS_PAYABLE_AGING',
      icon: 'CalendarClock',
      data: { side: 'payables' },
      entityKeyFn: () => 'compras:aging',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.ap_sub.aging' },
      load: () => import('../../../features/reports/aging/aging.page').then((m) => m.AgingPage),
    },
  ],
};
