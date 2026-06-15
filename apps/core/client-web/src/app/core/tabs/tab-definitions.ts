import { InjectionToken, Provider, Type } from '@angular/core';
import { TabDefinition, TabType } from './tab.model';

/**
 * Token multi-proveedor que agrega definiciones de pestañas. Cada feature puede
 * aportar sus definiciones con `provideTabs(...)`, de modo que `core/` no
 * dependa de `features/` mediante imports estáticos (TAB_ARCHITECTURE §5.2).
 *
 * Aquí, además, se declara un conjunto central usando imports **dinámicos**
 * (`load: () => import(...)`), que siguen siendo perezosos y no entran al bundle
 * inicial.
 */
export const TAB_DEFINITIONS = new InjectionToken<TabDefinition[][]>('TAB_DEFINITIONS');

/** Helper para registrar grupos de definiciones de pestañas. */
export function provideTabs(...definitions: TabDefinition[][]): Provider[] {
  return definitions.map((defs) => ({
    provide: TAB_DEFINITIONS,
    useValue: defs,
    multi: true,
  }));
}

const lazy = <T>(loader: () => Promise<{ [k: string]: unknown }>, exportName: string) =>
  () => loader().then((m) => m[exportName] as Type<unknown>);

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL
// ─────────────────────────────────────────────────────────────────────────────
const GENERAL_TABS: TabDefinition[] = [
  {
    // Página de inicio del workspace (estilo «Welcome» de VS Code). Es la única
    // pestaña fija no-cerrable y la que abre por defecto al iniciar sesión.
    pattern: '/overview',
    tabType: TabType.PINNED,
    title: 'Inicio',
    icon: 'LayoutGrid',
    isCloseable: false,
    entityKeyFn: () => 'pinned:overview',
    load: lazy(() => import('../../features/overview/overview.page'), 'OverviewPage'),
  },
  {
    // El Dashboard financiero pasa a ser una pestaña normal (cerrable), accesible
    // desde Overview y el sidebar.
    pattern: '/dashboard',
    tabType: TabType.UTILITY,
    title: 'Dashboard',
    icon: 'LayoutDashboard',
    entityKeyFn: () => 'util:dashboard',
    load: lazy(() => import('../../features/dashboard/dashboard.page'), 'DashboardPage'),
  },
  {
    pattern: '/my-work',
    tabType: TabType.UTILITY,
    title: 'Mi trabajo',
    icon: 'ClipboardList',
    entityKeyFn: () => 'util:my-work',
    load: lazy(() => import('../../features/my-work/my-work.page'), 'MyWorkPage'),
  },
  {
    pattern: '/approvals',
    tabType: TabType.UTILITY,
    title: 'Aprobaciones',
    icon: 'CheckSquare',
    entityKeyFn: () => 'util:approvals',
    load: lazy(() => import('../../features/approvals/approvals.page'), 'ApprovalsPage'),
  },
  {
    pattern: '/notifications',
    tabType: TabType.UTILITY,
    title: 'Notificaciones',
    icon: 'Bell',
    entityKeyFn: () => 'util:notifications',
    load: lazy(() => import('../../features/notifications/notifications.page'), 'NotificationsPage'),
  },
  {
    pattern: '/global-search',
    tabType: TabType.UTILITY,
    title: 'Búsqueda global',
    icon: 'Search',
    entityKeyFn: () => 'util:global-search',
    load: lazy(() => import('../../features/global-search/global-search.page'), 'GlobalSearchPage'),
  },
  {
    pattern: '/data-imports',
    tabType: TabType.UTILITY,
    title: 'Importaciones',
    icon: 'UploadCloud',
    entityKeyFn: () => 'util:data-imports',
    load: lazy(() => import('../../features/data-imports/data-imports.page'), 'DataImportsPage'),
  },
  {
    pattern: '/data-exports',
    tabType: TabType.UTILITY,
    title: 'Exportaciones',
    icon: 'DownloadCloud',
    entityKeyFn: () => 'util:data-exports',
    load: lazy(() => import('../../features/data-exports/data-exports.page'), 'DataExportsPage'),
  },
  {
    pattern: '/documents',
    tabType: TabType.MODULE_LIST,
    title: 'Documentos',
    icon: 'FolderArchive',
    permissions: ['documents:view'],
    entityKeyFn: () => 'module:documents',
    load: lazy(() => import('../../features/documents/layout/documents.layout'), 'DocumentsLayout'),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SALES
// ─────────────────────────────────────────────────────────────────────────────
const SALES_TABS: TabDefinition[] = [
  {
    pattern: '/sales',
    tabType: TabType.MODULE_LIST,
    title: 'Ventas',
    icon: 'ShoppingCart',
    permissions: ['sales:view'],
    entityKeyFn: () => 'module:sales',
    load: lazy(() => import('../../features/sales/history/history.page'), 'HistoryPage'),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INVOICES (lista + wizard + registro). Orden por especificidad: literal antes
// que paramétrica — lo garantiza el registry, pero declaramos /new antes de /:id.
// ─────────────────────────────────────────────────────────────────────────────
const INVOICE_TABS: TabDefinition[] = [
  {
    pattern: '/invoices',
    tabType: TabType.MODULE_LIST,
    title: 'Facturas',
    icon: 'Receipt',
    permissions: ['invoices:view'],
    entityKeyFn: () => 'module:invoices',
    load: lazy(() => import('../../features/invoices/list/list.page'), 'InvoicesListPage'),
  },
  {
    pattern: '/invoices/new',
    tabType: TabType.WIZARD,
    title: 'Nueva Factura',
    icon: 'FilePlus',
    permissions: ['invoices:view'],
    entityKeyFn: () => `invoice:new:${crypto.randomUUID()}`,
    load: lazy(() => import('../../features/invoices/new/new.page'), 'NewInvoicePage'),
  },
  {
    pattern: '/invoices/:id',
    tabType: TabType.RECORD,
    icon: 'FileText',
    permissions: ['invoices:view'],
    entityKeyFn: (p) => `invoice:${p['id']}`,
    titleFn: (p, d: any) => `Factura #${d?.number ?? p['id']}`,
    load: lazy(() => import('../../features/invoices/detail/detail.page'), 'InvoiceDetailPage'),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────────────────────────────────────
const INVENTORY_TABS: TabDefinition[] = [
  {
    pattern: '/inventory',
    tabType: TabType.MODULE_LIST,
    title: 'Inventario',
    icon: 'Package',
    permissions: ['inventory:view'],
    entityKeyFn: () => 'module:inventory',
    load: lazy(() => import('../../features/inventory/products/products.page'), 'ProductsPage'),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────────────────────────────────────
const CONTACTS_TABS: TabDefinition[] = [
  {
    pattern: '/contacts',
    tabType: TabType.MODULE_LIST,
    title: 'Contactos',
    icon: 'Users',
    permissions: ['contacts:view'],
    entityKeyFn: () => 'module:contacts',
    load: lazy(() => import('../../features/contacts/customers/customers.page'), 'CustomersPage'),
  },
];

/**
 * Definiciones centrales para las páginas reales ya implementadas. El resto de
 * rutas del sidebar se cubren con la definición genérica (fallback) del registry.
 */
export const CORE_TAB_DEFINITIONS: TabDefinition[] = [
  ...GENERAL_TABS,
  ...SALES_TABS,
  ...INVOICE_TABS,
  ...INVENTORY_TABS,
  ...CONTACTS_TABS,
];
