export const REPORTS_PERMISSIONS = {
  REPORTS_VIEW_SALES: 'reports:view_sales',
  REPORTS_VIEW_FINANCIAL: 'reports:view_financial',
  REPORTS_BUILDER_MANAGE: 'reports:builder_manage',

  /** Ad-hoc reporting books built over live ERP data, and the variables they resolve. */
  DATASHEETS_VIEW: 'datasheets:view',
  DATASHEETS_MANAGE: 'datasheets:manage',

  /**
   * The analytical store: arbitrary queries and materialised-view maintenance. A query here can
   * read across modules, which is precisely why it cannot inherit the caller's module permissions
   * by accident.
   */
  ANALYTICS_QUERY: 'analytics:query',
  ANALYTICS_MANAGE_VIEWS: 'analytics:manage_views',

  /** Aggregated sales intelligence. */
  BI_VIEW: 'bi:view',
} as const;
