import { ModuleManifest, WindowKind } from '../module-manifest';

/** Tax rules and the company's own structure. Currencies and branches are company-level facts. */
export const ADMINISTRACION_MODULE: ModuleManifest = {
  id: 'administracion',
  titleKey: 'MODULES.ADMINISTRATION',
  icon: 'Settings2',
  basePath: 'masters',
  order: 9,
  routes: [
    {
      path: 'taxes',
      kind: WindowKind.LIST,
      permission: 'taxes:view',
      titleKey: 'PAGE_TITLES.TAXES',
      icon: 'Percent',
      entityKeyFn: () => 'administracion:taxes',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.taxes' },
      load: () => import('../../../features/masters/taxes/taxes.page').then((m) => m.TaxesPage),
    },
    {
      path: 'taxes/new',
      kind: WindowKind.DRAFT,
      permission: 'taxes:create',
      titleKey: 'PAGE_TITLES.TAX_NEW',
      icon: 'Percent',
      entityKeyFn: () => `administracion:tax:new:${crypto.randomUUID()}`,
      load: () => import('../../../features/masters/taxes/tax-form/tax-form.page').then((m) => m.TaxFormPage),
    },
    {
      path: 'currencies',
      kind: WindowKind.LIST,
      permission: 'currencies:view',
      titleKey: 'PAGE_TITLES.CURRENCIES',
      icon: 'Banknote',
      entityKeyFn: () => 'administracion:currencies',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.currencies' },
      load: () => import('../../../features/masters/currencies/currencies.page').then((m) => m.CurrenciesPage),
    },
    {
      path: 'branches',
      kind: WindowKind.LIST,
      permission: 'settings:edit_company',
      titleKey: 'PAGE_TITLES.BRANCHES',
      icon: 'Store',
      entityKeyFn: () => 'administracion:branches',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.branches' },
      load: () => import('../../../features/masters/branches/branches.page').then((m) => m.BranchesPage),
    },
    {
      // The extensions marketplace and sandbox ("virtual machine for extensions"): install signed
      // extensions, grant them capabilities per tenant, and run them in the isolate.
      path: 'extensions',
      kind: WindowKind.LIST,
      permission: 'extensions:view',
      titleKey: 'PAGE_TITLES.EXTENSIONS',
      icon: 'Puzzle',
      entityKeyFn: () => 'administracion:extensions',
      menu: { group: 'masters', labelKey: 'sidebar.master_data.extensions' },
      load: () => import('../../../features/extensions/extensions.page').then((m) => m.ExtensionsPage),
    },
    {
      // The client-side extension runtime: where enabled UI extensions actually render, each in
      // its own sandboxed iframe host.
      path: 'extensions/run',
      kind: WindowKind.CANVAS,
      permission: 'extensions:view',
      titleKey: 'PAGE_TITLES.EXTENSIONS_RUNTIME',
      icon: 'Puzzle',
      entityKeyFn: () => 'administracion:extensions-runtime',
      load: () =>
        import('../../../features/extensions/extensions-runtime.page').then(
          (m) => m.ExtensionsRuntimePage,
        ),
    },
  ],
};

/**
 * Modules the product announces and has no backend for.
 *
 * They are declared, and hidden from the rail. Declaring them keeps the shell honest — a URL that
 * exists resolves to the page that exists — while `hidden` keeps the navigation from promising a
 * module that has no controller behind it. The inventory found HCM, WMS, Manufacturing,
 * Procurement and Projects in exactly this state: a component with no data source, and in four
 * cases no menu entry either. Whether they ship is a product decision, not a routing one.
 */
export const ROADMAP_MODULE: ModuleManifest = {
  id: 'roadmap',
  titleKey: 'MODULES.ROADMAP',
  icon: 'Construction',
  basePath: '',
  order: 99,
  hidden: true,
  routes: [
    {
      path: 'manufacturing',
      kind: WindowKind.OVERVIEW,
      permission: 'manufacturing:view',
      titleKey: 'PAGE_TITLES.MANUFACTURING',
      icon: 'Factory',
      entityKeyFn: () => 'roadmap:manufacturing',
      load: () => import('../../../features/manufacturing/pages/dashboard.component').then((m) => m.ManufacturingDashboardComponent),
    },
    {
      path: 'wms',
      kind: WindowKind.OVERVIEW,
      permission: 'inventory:view_stock',
      titleKey: 'PAGE_TITLES.WAREHOUSE_MANAGEMENT',
      icon: 'Warehouse',
      entityKeyFn: () => 'roadmap:wms',
      load: () => import('../../../features/wms/pages/dashboard.component').then((m) => m.WmsDashboardComponent),
    },
    {
      path: 'projects',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_sales',
      titleKey: 'PAGE_TITLES.PROJECTS',
      icon: 'Briefcase',
      entityKeyFn: () => 'roadmap:projects',
      load: () => import('../../../features/projects/pages/dashboard.component').then((m) => m.ProjectsDashboardComponent),
    },
    {
      path: 'hcm',
      kind: WindowKind.OVERVIEW,
      permission: 'hcm:view',
      titleKey: 'PAGE_TITLES.HUMAN_RESOURCES',
      icon: 'UsersRound',
      entityKeyFn: () => 'roadmap:hcm',
      load: () => import('../../../features/hcm/pages/dashboard.component').then((m) => m.HcmDashboardComponent),
    },
    {
      path: 'procurement',
      kind: WindowKind.OVERVIEW,
      permission: 'bills:view',
      titleKey: 'PAGE_TITLES.PROCUREMENT',
      icon: 'ShoppingCart',
      entityKeyFn: () => 'roadmap:procurement',
      load: () => import('../../../features/procurement/pages/dashboard.component').then((m) => m.ProcurementDashboardComponent),
    },
    {
      path: 'contacts/suppliers',
      kind: WindowKind.LIST,
      permission: 'suppliers:view',
      titleKey: 'PAGE_TITLES.SUPPLIERS',
      icon: 'Truck',
      entityKeyFn: () => 'compras:suppliers-contacts',
      load: () => import('../../../features/contacts/suppliers/suppliers.page').then((m) => m.SuppliersPage),
    },
  ],
};
