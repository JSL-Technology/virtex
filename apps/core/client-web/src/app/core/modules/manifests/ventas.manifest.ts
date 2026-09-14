import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Sales: what the company sells, and what it is owed for it.
 *
 * Customers and price lists live here rather than in a "master data" group. That group is being
 * dissolved deliberately: it was defined by shape ("this is a catalogue") instead of by domain, so
 * nobody owned it, and the inventory found 8 of its 13 pages still showing hardcoded rows. A
 * customer belongs to whoever sells to them.
 */
export const VENTAS_MODULE: ModuleManifest = {
  id: 'ventas',
  titleKey: 'modules.sales',
  icon: 'ShoppingBag',
  basePath: '',
  order: 1,
  routes: [
    {
      path: 'invoices',
      kind: WindowKind.LIST,
      permission: 'invoices:view',
      titleKey: 'page_titles.invoices',
      icon: 'Receipt',
      entityKeyFn: () => 'ventas:invoices',
      menu: { group: 'documents', labelKey: 'sidebar.finance.ar_sub.invoices' },
      load: () => import('../../../features/invoices/list/list.page').then((m) => m.InvoicesListPage),
    },
    {
      path: 'invoices/new',
      kind: WindowKind.DRAFT,
      permission: 'invoices:create',
      titleKey: 'page_titles.invoice_new',
      icon: 'FilePlus',
      // A new invoice is a fresh draft every time: two of them must not collapse into one window.
      entityKeyFn: () => `ventas:invoice:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/invoices/new/new.page').then((m) => m.NewInvoicePage),
    },
    {
      path: 'invoices/:id',
      kind: WindowKind.DOCUMENT,
      permission: 'invoices:view',
      icon: 'FileText',
      //  El título estático hasta que la página conozca el número. `titleFn` solo recibe los
      //  parámetros de la ruta —nunca el documento—, así que su rama «con datos» no se ejecutaba
      //  jamás y la pestaña se llamaba «Factura 7c1f8a…», con el UUID, en castellano fijo.
      //  `InvoiceDetailPage` la renombra con `TAB_CONTEXT.setTitle` al cargar.
      titleKey: 'page_titles.invoice',
      entityKeyFn: (p) => `ventas:invoice:${p['id']}`,
      load: () => import('../../../features/invoices/detail/detail.page').then((m) => m.InvoiceDetailPage),
    },
    {
      path: 'customer-receipts',
      kind: WindowKind.LIST,
      permission: 'accounts_receivable:view',
      titleKey: 'page_titles.customer_receipts',
      icon: 'HandCoins',
      entityKeyFn: () => 'ventas:receipts',
      menu: { group: 'documents', labelKey: 'sidebar.finance.ar_sub.receipts' },
      load: () => import('../../../features/customer-receipts/list/list.page').then((m) => m.CustomerReceiptsListPage),
    },
    {
      path: 'customer-receipts/new',
      kind: WindowKind.DRAFT,
      permission: 'accounts_receivable:collect',
      titleKey: 'page_titles.customer_receipt_new',
      icon: 'HandCoins',
      entityKeyFn: () => `ventas:receipt:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/customer-receipts/form/form.page').then((m) => m.CustomerReceiptFormPage),
    },
    {
      path: 'contacts/customers',
      kind: WindowKind.LIST,
      permission: 'customers:view',
      titleKey: 'page_titles.customers',
      icon: 'Users',
      entityKeyFn: () => 'ventas:customers',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.customers' },
      load: () => import('../../../features/contacts/customers/customers.page').then((m) => m.CustomersPage),
    },
    {
      path: 'contacts/customers/new',
      kind: WindowKind.DRAFT,
      permission: 'customers:create',
      titleKey: 'page_titles.customer_new',
      icon: 'UserPlus',
      entityKeyFn: () => `ventas:customer:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/contacts/customer-form/customer-form.page').then((m) => m.CustomerFormPage),
    },
    {
      path: 'contacts/customers/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'customers:edit',
      titleKey: 'page_titles.customer_edit',
      icon: 'UserCog',
      entityKeyFn: (p) => `ventas:customer:${p['id']}`,
      load: () => import('../../../features/contacts/customer-form/customer-form.page').then((m) => m.CustomerFormPage),
    },
    {
      path: 'masters/price-lists',
      kind: WindowKind.LIST,
      permission: 'price_lists:view',
      titleKey: 'page_titles.price_lists',
      icon: 'Tag',
      entityKeyFn: () => 'ventas:price-lists',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.price_lists' },
      load: () => import('../../../features/masters/price-lists/price-lists.page').then((m) => m.PriceListsPage),
    },
    {
      path: 'masters/price-lists/new',
      kind: WindowKind.DRAFT,
      permission: 'price_lists:create',
      titleKey: 'page_titles.price_list_new',
      icon: 'Tag',
      entityKeyFn: () => `ventas:price-list:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/masters/price-lists/price-lists-form/price-list-form.page').then((m) => m.PriceListFormPage),
    },
    {
      path: 'masters/price-lists/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'price_lists:edit',
      titleKey: 'page_titles.price_list_edit',
      icon: 'Tag',
      entityKeyFn: (p) => `ventas:price-list:${p['id']}`,
      load: () => import('../../../features/masters/price-lists/price-lists-form/price-list-form.page').then((m) => m.PriceListFormPage),
    },
    {
      path: 'sales/history',
      kind: WindowKind.LIST,
      permission: 'invoices:view',
      titleKey: 'page_titles.sales_history',
      icon: 'History',
      entityKeyFn: () => 'ventas:history',
      load: () => import('../../../features/sales/history/history.page').then((m) => m.HistoryPage),
    },
    {
      //  Un terminal de punto de venta: catálogo, ticket y cobro, los tres a la vez y a pantalla
      //  completa. El armazón de borrador —cabecera fija con «Guardar» y «Cancelar»— describe un
      //  formulario, y esto no lo es: aquí no se guarda un borrador, se cobra.
      path: 'sales/pos',
      kind: WindowKind.CANVAS,
      permission: 'invoices:create',
      titleKey: 'page_titles.point_of_sale',
      icon: 'Store',
      entityKeyFn: () => 'ventas:pos',
      load: () => import('../../../features/sales/pos/pos.page').then((m) => m.PosPage),
    },
    {
      path: 'reports/aging/receivables',
      kind: WindowKind.OVERVIEW,
      permission: 'accounts_receivable:view',
      titleKey: 'page_titles.accounts_receivable_aging',
      icon: 'CalendarClock',
      data: { side: 'receivables' },
      entityKeyFn: () => 'ventas:aging',
      menu: { group: 'analysis', labelKey: 'sidebar.finance.ar_sub.aging' },
      load: () => import('../../../features/reports/aging/aging.page').then((m) => m.AgingPage),
    },
  ],
};
