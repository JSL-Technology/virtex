import { AUTHENTICATED_ONLY, ModuleManifest, WindowKind } from '../module-manifest';

/**
 * Analysis: management reporting — profitability, the datasheet workbooks, and the hub that lists
 * every report the user may open.
 *
 * The financial statements used to live here. They are the accountant's reports, and every ERP
 * this product is measured against files them under Accounting (Odoo «Contabilidad › Informes»,
 * NetSuite «Reports › Financial»), so they moved to Accounting's panel. Their addresses did not
 * change, and the hub still lists them: it reads every module's `analysis` group.
 */
export const ANALISIS_MODULE: ModuleManifest = {
  id: 'analisis',
  titleKey: 'modules.analysis',
  icon: 'BarChart2',
  basePath: 'reports',
  order: 8,
  routes: [
    {
      // The module's landing: every report the user may open, from every module (QA M-09).
      path: '',
      kind: WindowKind.OVERVIEW,
      permission: AUTHENTICATED_ONLY,
      titleKey: 'page_titles.reports_hub',
      icon: 'BarChart2',
      entityKeyFn: () => 'analisis:reports',
      load: () => import('../../../features/reports/hub/reports-hub.page').then((m) => m.ReportsHubPage),
    },
    {
      //  El mes en pocos párrafos para quien dirige la empresa, escrito el día 1 (o a pedido) a partir
      //  de las cifras que el sistema calculó; se imprime o se guarda como PDF desde el navegador.
      path: 'manager-report',
      kind: WindowKind.OVERVIEW,
      permission: 'ai_reports:view',
      titleKey: 'page_titles.ai_manager_report',
      icon: 'ScrollText',
      entityKeyFn: () => 'analisis:manager-report',
      menu: { group: 'analysis', labelKey: 'page_titles.ai_manager_report' },
      load: () => import('../../../features/ai/manager-report/manager-report.page').then((m) => m.ManagerReportPage),
    },
    {
      // Lo que la auditoría automática encontró inusual en ventas, compras, existencias y caja.
      path: 'anomalies',
      kind: WindowKind.LIST,
      permission: 'ai_anomalies:view',
      titleKey: 'page_titles.ai_anomalies',
      icon: 'ShieldAlert',
      entityKeyFn: () => 'analisis:ai-anomalies',
      menu: { group: 'analysis', labelKey: 'page_titles.ai_anomalies' },
      load: () => import('../../../features/ai/anomalies/anomalies.page').then((m) => m.AnomaliesPage),
    },
    {
      path: 'profitability-by-product',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_sales',
      titleKey: 'page_titles.profitability_product',
      icon: 'PackageSearch',
      entityKeyFn: () => 'analisis:profit-product',
      menu: { group: 'analysis', labelKey: 'page_titles.profitability_product' },
      load: () => import('../../../features/reports/profitability-by-product/profitability-by-product.page').then((m) => m.ProfitabilityByProductPage),
    },
    {
      path: 'profitability-by-customer',
      kind: WindowKind.OVERVIEW,
      permission: 'reports:view_sales',
      titleKey: 'page_titles.profitability_customer',
      icon: 'Users',
      entityKeyFn: () => 'analisis:profit-customer',
      menu: { group: 'analysis', labelKey: 'page_titles.profitability_customer' },
      load: () => import('../../../features/reports/profitability-by-customer/profitability-by-customer.page').then((m) => m.ProfitabilityByCustomerPage),
    },
    {
      // SAP's «Mapa de relaciones». Reached from a document (type + id in the address); the menu
      // entry opens it empty, with guidance on where to open it from.
      path: 'relationship-map',
      kind: WindowKind.CANVAS,
      permission: 'relationship_map:view',
      titleKey: 'relationship_map.title',
      icon: 'Share2',
      entityKeyFn: () => 'analisis:relationship-map',
      previewable: false,
      menu: { group: 'analysis', labelKey: 'relationship_map.menu' },
      load: () => import('../../../features/relationship-map/relationship-map.page').then((m) => m.RelationshipMapPage),
    },
    {
      //  A free surface: a pannable, zoomable graph, not a document to read — hence CANVAS. The
      //  title becomes the root document's once the map loads (see the page).
      path: 'relationship-map/:type/:id',
      kind: WindowKind.CANVAS,
      permission: 'relationship_map:view',
      titleKey: 'relationship_map.title',
      icon: 'Share2',
      entityKeyFn: (p) => `analisis:relationship-map:${p['type']}:${p['id']}`,
      // A place to work FROM: documents opened on it get their own tabs, the map stays.
      previewable: false,
      load: () => import('../../../features/relationship-map/relationship-map.page').then((m) => m.RelationshipMapPage),
    },
  ],
};

/** Datasheets keep their own base path. */
export const DATASHEETS_MODULE: ModuleManifest = {
  id: 'datasheets',
  titleKey: 'modules.datasheets',
  icon: 'Table2',
  basePath: 'datasheets',
  order: 8.1,
  panelOf: 'analisis',
  routes: [
    {
      path: '',
      kind: WindowKind.LIST,
      permission: 'datasheets:view',
      titleKey: 'page_titles.datasheets',
      icon: 'Table2',
      entityKeyFn: () => 'analisis:datasheets',
      menu: { group: 'analysis', labelKey: 'sidebar.reports.reporting_sub.datasheets' },
      load: () => import('../../../features/datasheets/pages/datasheet-list/datasheet-list.page').then((m) => m.DatasheetListPage),
    },
    {
      //  Una hoja de cálculo: barra de fórmulas, rejilla y panel de variables. No es un documento
      //  que se lee, es una superficie sobre la que se compone, y el armazón de documento —cabecera
      //  fija, cuerpo, panel lateral— estorbaría en las tres.
      path: ':id',
      kind: WindowKind.CANVAS,
      permission: 'datasheets:view',
      icon: 'Table2',
      //  El nombre de la hoja lo pone el editor al abrirla; ver la nota en `ventas.manifest.ts`.
      titleKey: 'page_titles.datasheet',
      entityKeyFn: (p) => `analisis:datasheet:${p['id']}`,
      load: () => import('../../../features/datasheets/pages/datasheet-editor/datasheet-editor.page').then((m) => m.DatasheetEditorPage),
    },
  ],
};
