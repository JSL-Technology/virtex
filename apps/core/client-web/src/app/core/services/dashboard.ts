import { Injectable, signal, inject } from '@angular/core';
import { GridsterItem } from 'angular-gridster2';
import { Kpi } from '../models/finance';

// >>> ÚNICO IMPORT NUEVO PARA TRADUCCIÓN <<<
import { TranslateService } from '@ngx-translate/core';

// Define un tipo para los gráficos permitidos
export type ChartType = 'column' | 'bar' | 'pie' | 'area' | 'line' | 'waterfall';

// Interfaz que define la estructura completa de un widget
export interface DashboardWidget extends GridsterItem {
  componentType:
    | 'stat-sales-today'
    | 'stat-pending-invoices'
    | 'stat-low-stock'
    | 'stat-active-customers'
    | 'comparison-chart'
    | 'alerts-panel'
    | 'sales-chart'
    | 'invoice-status'
    | 'low-stock'
    | 'top-products'
    | 'recent-activity'
    | 'cashflow-chart'
    | 'expenses-chart'
    | 'ar-aging-chart'
    | 'financial-ratios'
    | 'kpi-roe'
    | 'kpi-roa'
    | 'kpi-current-ratio'
    | 'kpi-quick-ratio'
    | 'kpi-working-capital'
    | 'kpi-leverage'
    | 'kpi-net-margin'
    | 'kpi-ebitda'
    | 'kpi-fcf';
  id: string;
  name: string;
  data?: any;
  chartType?: ChartType;
}

// Row-height unit = 50px. 1 row = 50px, 3 rows = 150px, 8 rows = 400px.
// 4-column grid. All x values must be 0-3.

const ALL_AVAILABLE_WIDGETS: Omit<DashboardWidget, 'x' | 'y'>[] = [
  // ── Cifras de cabecera ─────────────────────────────────────────
  // Cada una lee su propia cifra del inquilino. Antes eran literales del catálogo — «$1,250.00
  // +15 %», «12 facturas pendientes −5 %» — idénticos para todos los clientes del producto y con
  // porcentajes medidos contra nada.
  { id: 'sales-today',       componentType: 'stat-sales-today',      name: 'Ventas de Hoy',       cols: 1, rows: 3 },
  { id: 'pending-invoices',  componentType: 'stat-pending-invoices', name: 'Facturas Pendientes', cols: 1, rows: 3 },
  { id: 'low-stock-items',   componentType: 'stat-low-stock',        name: 'Productos Bajos',     cols: 1, rows: 3 },
  { id: 'active-clients',    componentType: 'stat-active-customers', name: 'Clientes Activos',    cols: 1, rows: 3 },

  // ── Indicadores financieros ────────────────────────────────────
  // Los mismos cuatro que antes traían cifras inventadas, ahora calculados desde el mayor por
  // `/dashboard/kpi/*` — que ya existía y que la otra mitad de esta misma página ya usaba.
  { id: 'ebitda',        componentType: 'kpi-ebitda',     name: 'KPI: EBITDA',          cols: 1, rows: 3 },
  { id: 'net-margin',    componentType: 'kpi-net-margin', name: 'KPI: Margen Neto',     cols: 1, rows: 3 },
  { id: 'cash-flow-kpi', componentType: 'kpi-fcf',        name: 'KPI: Cash Flow Libre', cols: 1, rows: 3 },
  { id: 'debt-equity',   componentType: 'kpi-leverage',   name: 'KPI: Endeudamiento',   cols: 1, rows: 3 },

  // ── KPI API-driven cards ───────────────────────────────────────
  { id: 'financial-ratios',  componentType: 'financial-ratios',  name: 'Ratios Financieros',      cols: 4, rows: 4 },
  { id: 'kpi-roe',           componentType: 'kpi-roe',           name: 'KPI: ROE',                cols: 1, rows: 3 },
  { id: 'kpi-roa',           componentType: 'kpi-roa',           name: 'KPI: ROA',                cols: 1, rows: 3 },
  { id: 'kpi-current-ratio', componentType: 'kpi-current-ratio', name: 'KPI: Liquidez Corriente', cols: 1, rows: 3 },
  { id: 'kpi-quick-ratio',   componentType: 'kpi-quick-ratio',   name: 'KPI: Prueba Ácida',       cols: 1, rows: 3 },
  { id: 'kpi-working-capital',componentType: 'kpi-working-capital', name: 'KPI: Capital de Trabajo',cols: 1, rows: 3 },
  { id: 'kpi-leverage',      componentType: 'kpi-leverage',      name: 'KPI: Apalancamiento',     cols: 1, rows: 3 },
  { id: 'kpi-net-margin',    componentType: 'kpi-net-margin',    name: 'KPI: Margen Neto (API)',   cols: 1, rows: 3 },
  { id: 'kpi-ebitda',        componentType: 'kpi-ebitda',        name: 'KPI: EBITDA (API)',        cols: 1, rows: 3 },
  { id: 'kpi-fcf',           componentType: 'kpi-fcf',           name: 'KPI: Flujo de Caja Libre', cols: 1, rows: 3 },

  // ── Chart widgets ──────────────────────────────────────────────
  { id: 'real-vs-budget',    componentType: 'comparison-chart', name: 'Real vs. Presupuesto',      cols: 2, rows: 8, chartType: 'column'    },
  { id: 'cashflow-waterfall',componentType: 'cashflow-chart',   name: 'Flujo de Efectivo',         cols: 2, rows: 8, chartType: 'waterfall' },
  { id: 'expenses-pie',      componentType: 'expenses-chart',   name: 'Desglose de Gastos',        cols: 2, rows: 8, chartType: 'pie'       },
  { id: 'ar-aging-bar',      componentType: 'ar-aging-chart',   name: 'Cuentas por Cobrar',        cols: 2, rows: 8, chartType: 'bar'       },
  { id: 'sales-chart',       componentType: 'sales-chart',      name: 'Ingresos por Período',      cols: 3, rows: 8, chartType: 'area'      },
  { id: 'invoice-status',    componentType: 'invoice-status',   name: 'Estado de Facturas',        cols: 1, rows: 8, chartType: 'pie'       },
  { id: 'top-products',      componentType: 'top-products',     name: 'Productos Más Vendidos',    cols: 2, rows: 8, chartType: 'bar'       },

  // ── List & panel widgets ───────────────────────────────────────
  { id: 'alerts',            componentType: 'alerts-panel',     name: 'Panel de Alertas',          cols: 2, rows: 7 },
  { id: 'low-stock-table',   componentType: 'low-stock',        name: 'Bajo Stock',                cols: 2, rows: 7 },
  { id: 'recent-activity',   componentType: 'recent-activity',  name: 'Actividad Reciente',        cols: 2, rows: 7 },
];

// ── Executive dashboard default layout ─────────────────────────
// fixedRowHeight = 50px → 3 rows = 150px, 8 rows = 400px, 7 rows = 350px
// 4-column grid. No position collisions.
const EXECUTIVE_LAYOUT: DashboardWidget[] = [
  // Row 0-2 (150px): Summary KPIs
  { id: 'ebitda',        componentType: 'kpi-ebitda',     x: 0, y: 0, cols: 1, rows: 3, name: 'KPI: EBITDA' },
  { id: 'net-margin',    componentType: 'kpi-net-margin', x: 1, y: 0, cols: 1, rows: 3, name: 'KPI: Margen Neto' },
  { id: 'cash-flow-kpi', componentType: 'kpi-fcf',        x: 2, y: 0, cols: 1, rows: 3, name: 'KPI: Cash Flow' },
  { id: 'debt-equity',   componentType: 'kpi-leverage',   x: 3, y: 0, cols: 1, rows: 3, name: 'KPI: Endeudamiento' },

  // Row 3-10 (400px): Main charts
  { id: 'real-vs-budget',     componentType: 'comparison-chart', x: 0, y: 3, cols: 2, rows: 8, name: 'Real vs. Presupuesto', chartType: 'column'    },
  { id: 'cashflow-waterfall', componentType: 'cashflow-chart',   x: 2, y: 3, cols: 2, rows: 8, name: 'Flujo de Efectivo',    chartType: 'waterfall' },

  // Row 11-14 (200px): Financial ratios strip
  { id: 'financial-ratios', componentType: 'financial-ratios', x: 0, y: 11, cols: 4, rows: 4, name: 'Ratios Financieros' },

  // Row 15-21 (350px): Panels
  { id: 'alerts',          componentType: 'alerts-panel',   x: 0, y: 15, cols: 2, rows: 7, name: 'Panel de Alertas' },
  { id: 'recent-activity', componentType: 'recent-activity', x: 2, y: 15, cols: 2, rows: 7, name: 'Actividad Reciente' },
];

@Injectable({ providedIn: 'root' })
export class DashboardService {
  // >>> INYECCIÓN CAMBIADA A inject() PARA ESTAR DISPONIBLE DURANTE INICIALIZACIÓN DE CAMPOS <<<
  private translate = inject(TranslateService);

  // ---- Mapa de claves i18n por id (no cambia estructura de datos) ----
  private static readonly WIDGET_I18N_KEYS: Record<
    string,
    { name?: string; dataTitle?: string; dataComparisonPeriod?: string }
  > = {
    // KPIs & Stats
    'sales-today': { name: 'dash.widget.sales_today.name', dataTitle: 'dash.widget.sales_today.title' },
    'pending-invoices': { name: 'dash.widget.pending_invoices.name', dataTitle: 'dash.widget.pending_invoices.title' },
    'low-stock-items': { name: 'dash.widget.low_stock_items.name', dataTitle: 'dash.widget.low_stock_items.title' },
    'active-clients': { name: 'dash.widget.active_clients.name', dataTitle: 'dash.widget.active_clients.title' },
    'ebitda': { name: 'dash.widget.ebitda.name', dataTitle: 'dash.widget.ebitda.title', dataComparisonPeriod: 'dash.widget.ebitda.vs_budget' },
    'net-margin': { name: 'dash.widget.net_margin.name', dataTitle: 'dash.widget.net_margin.title', dataComparisonPeriod: 'dash.widget.net_margin.vs_prior_year' },
    'cash-flow-kpi': { name: 'dash.widget.cash_flow_kpi.name', dataTitle: 'dash.widget.cash_flow_kpi.title', dataComparisonPeriod: 'dash.widget.cash_flow_kpi.vs_budget' },
    'debt-equity': { name: 'dash.widget.debt_equity.name', dataTitle: 'dash.widget.debt_equity.title', dataComparisonPeriod: 'dash.widget.debt_equity.vs_q2' },
    'financial-ratios': { name: 'dash.widget.financial_ratios.name' },
    'kpi-roe': { name: 'dash.widget.kpi_roe.name', dataTitle: 'dash.widget.kpi_roe.title', dataComparisonPeriod: 'dash.widget.kpi_roe.vs_prior_year' },
    'kpi-roa': { name: 'dash.widget.kpi_roa.name', dataTitle: 'dash.widget.kpi_roa.title', dataComparisonPeriod: 'dash.widget.kpi_roa.vs_prior_year' },
    'kpi-current-ratio': { name: 'dash.widget.kpi_current_ratio.name', dataTitle: 'dash.widget.kpi_current_ratio.title', dataComparisonPeriod: 'dash.widget.kpi_current_ratio.vs_prior_month' },
    'kpi-quick-ratio': { name: 'dash.widget.kpi_quick_ratio.name', dataTitle: 'dash.widget.kpi_quick_ratio.title', dataComparisonPeriod: 'dash.widget.kpi_quick_ratio.vs_prior_month' },
    'kpi-working-capital': { name: 'dash.widget.kpi_working_capital.name', dataTitle: 'dash.widget.kpi_working_capital.title', dataComparisonPeriod: 'dash.widget.kpi_working_capital.current' },
    'kpi-leverage': { name: 'dash.widget.kpi_leverage.name', dataTitle: 'dash.widget.kpi_leverage.title', dataComparisonPeriod: 'dash.widget.kpi_leverage.vs_prior_quarter' },
    'kpi-net-margin': { name: 'dash.widget.kpi_net_margin.name', dataTitle: 'dash.widget.kpi_net_margin.title', dataComparisonPeriod: 'dash.widget.kpi_net_margin.vs_prior_year' },
    'kpi-ebitda': { name: 'dash.widget.kpi_ebitda.name', dataTitle: 'dash.widget.kpi_ebitda.title', dataComparisonPeriod: 'dash.widget.kpi_ebitda.vs_budget' },
    'kpi-fcf': { name: 'dash.widget.kpi_fcf.name', dataTitle: 'dash.widget.kpi_fcf.title', dataComparisonPeriod: 'dash.widget.kpi_fcf.vs_budget' },

    // Charts
    'real-vs-budget': { name: 'dash.widget.real_vs_budget.name' },
    'cashflow-waterfall': { name: 'dash.widget.cashflow_waterfall.name' },
    'expenses-pie': { name: 'dash.widget.expenses_pie.name' },
    'ar-aging-bar': { name: 'dash.widget.ar_aging_bar.name' },
    'sales-chart': { name: 'dash.widget.sales_chart.name' },
    'invoice-status': { name: 'dash.widget.invoice_status.name' },
    'top-products': { name: 'dash.widget.top_products.name' },

    // Lists & Panels
    'alerts': { name: 'dash.widget.alerts.name' },
    'low-stock-table': { name: 'dash.widget.low_stock_table.name' },
    'recent-activity': { name: 'dash.widget.recent_activity.name' },
  };

  // ---- Helpers de traducción (no cambian tu lógica) ----
  private t(key: string | undefined, fallback?: string): string {
    if (!key) return fallback ?? '';
    const v = this.translate.instant(key);
    return v === key ? (fallback ?? v) : v;
  }

  private translateWidget<T extends { id: string; name?: string; data?: any }>(w: T): T {
    const m = DashboardService.WIDGET_I18N_KEYS[w.id];
    if (!m) return w;

    const translated: T = { ...w };

    if (m.name) {
      translated.name = this.t(m.name, w.name);
    }

    if (w.data && typeof w.data === 'object') {
      translated.data = { ...w.data };
      if (m.dataTitle) {
        translated.data.title = this.t(m.dataTitle, w.data.title);
      }
      if (m.dataComparisonPeriod && 'comparisonPeriod' in w.data) {
        translated.data.comparisonPeriod = this.t(m.dataComparisonPeriod, w.data.comparisonPeriod);
      }
    }

    return translated;
  }

  private translateLayout<T extends Array<any>>(arr: T): T {
    return arr.map(w => this.translateWidget(w)) as T;
  }

  // >>> layout se inicializa con el resultado de loadLayout(), y translate YA está disponible porque usamos inject() arriba
  layout = signal<DashboardWidget[]>(this.loadLayout());

  private loadLayout(): DashboardWidget[] {
    if (typeof window !== 'undefined') {
      const savedLayout = localStorage.getItem('dashboard_layout');
      if (savedLayout) {
        const parsed = JSON.parse(savedLayout) as DashboardWidget[];
        return this.translateLayout(parsed);
      }
    }
    return this.translateLayout(EXECUTIVE_LAYOUT);
  }

  saveLayout(currentLayout: DashboardWidget[]): void {
    if (typeof window !== 'undefined') {
      const layoutToSave = currentLayout.map(w => ({
        cols: w.cols, rows: w.rows, x: w.x, y: w.y,
        id: w.id, componentType: w.componentType, name: w.name, data: w.data, chartType: w.chartType
      }));
      localStorage.setItem('dashboard_layout', JSON.stringify(layoutToSave));
      this.layout.set(currentLayout);
    }
  }

  resetLayout(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dashboard_layout');
      this.layout.set(JSON.parse(JSON.stringify(this.translateLayout(EXECUTIVE_LAYOUT))));
    }
  }

  getAllWidgets(): Omit<DashboardWidget, 'x' | 'y'>[] {
    return this.translateLayout(ALL_AVAILABLE_WIDGETS);
  }

  addWidget(widgetId: string): void {
    const widgetToAdd = ALL_AVAILABLE_WIDGETS.find(w => w['id'] === widgetId);

    if (widgetToAdd) {
      const newWidget: any = {
        ...widgetToAdd,
        x: 0,
        y: 0,
      };
      const translated = this.translateWidget(newWidget);
      this.layout.update(currentLayout => [translated, ...currentLayout]);
      this.saveLayout(this.layout());
    }
  }

  removeWidget(widgetId: string): void {
    this.layout.update(currentLayout => currentLayout.filter(w => w.id !== widgetId));
    this.saveLayout(this.layout());
  }

  updateWidgetConfig(widgetId: string, newConfig: Partial<DashboardWidget>): void {
    this.layout.update(currentLayout => {
      return currentLayout.map(widget =>
        widget.id === widgetId ? { ...widget, ...newConfig } : widget
      );
    });
    this.saveLayout(this.layout());
  }
}
