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
    | 'kpi-card'
    | 'stat-card'
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

// Lista maestra de todos los widgets disponibles en la aplicación
const ALL_AVAILABLE_WIDGETS: Omit<DashboardWidget, 'x' | 'y'>[] = [
  // KPIs & Stats
  { id: 'sales-today', componentType: 'stat-card', name: 'Ventas de Hoy', cols: 1, rows: 1, data: { title: 'Ventas de Hoy', value: '$1,250.00', change: '+15%', iconName: 'DollarSign', color: 'blue' } },
  { id: 'pending-invoices', componentType: 'stat-card', name: 'Facturas Pendientes', cols: 1, rows: 1, data: { title: 'Facturas Pendientes', value: '12', change: '-5%', iconName: 'Receipt', color: 'orange' } },
  { id: 'low-stock-items', componentType: 'stat-card', name: 'Productos Bajos', cols: 1, rows: 1, data: { title: 'Productos Bajos', value: '8', change: '+2', iconName: 'Package', color: 'red' } },
  { id: 'active-clients', componentType: 'stat-card', name: 'Clientes Activos', cols: 1, rows: 1, data: { title: 'Clientes Activos', value: '312', change: '+1.2%', iconName: 'Users', color: 'green' } },
  { id: 'ebitda', componentType: 'kpi-card', name: 'KPI: EBITDA', cols: 1, rows: 2, data: { title: 'EBITDA', value: '$1.2M', comparisonValue: '+5.2%', comparisonPeriod: 'vs Presupuesto', isPositive: true } as Kpi },
  { id: 'net-margin', componentType: 'kpi-card', name: 'KPI: Margen Neto', cols: 1, rows: 2, data: { title: 'Margen Neto', value: '18.5%', comparisonValue: '-1.5%', comparisonPeriod: 'vs Año Anterior', isPositive: false } as Kpi },
  { id: 'cash-flow-kpi', componentType: 'kpi-card', name: 'KPI: Cash Flow Libre', cols: 1, rows: 2, data: { title: 'Cash Flow Libre', value: '$350K', comparisonValue: '+20%', comparisonPeriod: 'vs Presupuesto', isPositive: true } as Kpi },
  { id: 'debt-equity', componentType: 'kpi-card', name: 'KPI: Endeudamiento', cols: 1, rows: 2, data: { title: 'Endeudamiento (D/E)', value: '0.45', comparisonValue: '+0.05', comparisonPeriod: 'vs Q2', isPositive: false } as Kpi },
  { id: 'financial-ratios', componentType: 'financial-ratios', name: 'KPIs: Ratios Financieros', cols: 4, rows: 2 },
  { id: 'kpi-roe', componentType: 'kpi-roe', name: 'KPI: ROE', cols: 1, rows: 2 },
  { id: 'kpi-roa', componentType: 'kpi-roa', name: 'KPI: ROA', cols: 1, rows: 2 },
  { id: 'kpi-current-ratio', componentType: 'kpi-current-ratio', name: 'KPI: Liquidez Corriente', cols: 1, rows: 2 },
  { id: 'kpi-quick-ratio', componentType: 'kpi-quick-ratio', name: 'KPI: Prueba Ácida', cols: 1, rows: 2 },
  { id: 'kpi-working-capital', componentType: 'kpi-working-capital', name: 'KPI: Capital de Trabajo', cols: 1, rows: 2 },
  { id: 'kpi-leverage', componentType: 'kpi-leverage', name: 'KPI: Apalancamiento', cols: 1, rows: 2 },
  { id: 'kpi-net-margin', componentType: 'kpi-net-margin', name: 'KPI: Margen Neto', cols: 1, rows: 2 },
  { id: 'kpi-ebitda', componentType: 'kpi-ebitda', name: 'KPI: EBITDA', cols: 1, rows: 2 },
  { id: 'kpi-fcf', componentType: 'kpi-fcf', name: 'KPI: Flujo de Caja Libre', cols: 1, rows: 2 },

  // Charts
  { id: 'real-vs-budget', componentType: 'comparison-chart', name: 'Gráfico Real vs. Presupuesto', cols: 2, rows: 5, chartType: 'column' },
  { id: 'cashflow-waterfall', componentType: 'cashflow-chart', name: 'Gráfico Flujo de Efectivo', cols: 2, rows: 4, chartType: 'waterfall' },
  { id: 'expenses-pie', componentType: 'expenses-chart', name: 'Gráfico Desglose de Gastos', cols: 2, rows: 4, chartType: 'pie' },
  { id: 'ar-aging-bar', componentType: 'ar-aging-chart', name: 'Gráfico Cuentas por Cobrar', cols: 2, rows: 4, chartType: 'bar' },
  { id: 'sales-chart', componentType: 'sales-chart', name: 'Gráfico de Ingresos', cols: 3, rows: 4, chartType: 'area' },
  { id: 'invoice-status', componentType: 'invoice-status', name: 'Gráfico Estado de Facturas', cols: 1, rows: 4, chartType: 'pie' },
  { id: 'top-products', componentType: 'top-products', name: 'Gráfico Productos Más Vendidos', cols: 2, rows: 4, chartType: 'bar' },

  // Lists & Panels
  { id: 'alerts', componentType: 'alerts-panel', name: 'Panel de Alertas', cols: 1, rows: 5 },
  { id: 'low-stock-table', componentType: 'low-stock', name: 'Tabla de Bajo Stock', cols: 1, rows: 4 },
  { id: 'recent-activity', componentType: 'recent-activity', name: 'Actividad Reciente', cols: 1, rows: 4 },
];

// Layout por defecto para el Dashboard Financiero Ejecutivo
const EXECUTIVE_LAYOUT: DashboardWidget[] = [
  { id: 'ebitda', componentType: 'kpi-card', x: 0, y: 0, cols: 1, rows: 2, name: 'KPI: EBITDA', data: { title: 'EBITDA', value: '$1.2M', comparisonValue: '+5.2%', comparisonPeriod: 'vs Presupuesto', isPositive: true } as Kpi },
  { id: 'net-margin', componentType: 'kpi-card', x: 1, y: 0, cols: 1, rows: 2, name: 'KPI: Margen Neto', data: { title: 'Margen Neto', value: '18.5%', comparisonValue: '-1.5%', comparisonPeriod: 'vs Año Anterior', isPositive: false } as Kpi },
  { id: 'cash-flow-kpi', componentType: 'kpi-card', x: 2, y: 0, cols: 1, rows: 2, name: 'KPI: Cash Flow Libre', data: { title: 'Cash Flow Libre', value: '$350K', comparisonValue: '+20%', comparisonPeriod: 'vs Presupuesto', isPositive: true } as Kpi },
  { id: 'debt-equity', componentType: 'kpi-card', x: 3, y: 0, cols: 1, rows: 2, name: 'KPI: Endeudamiento', data: { title: 'Endeudamiento (D/E)', value: '0.45', comparisonValue: '+0.05', comparisonPeriod: 'vs Q2', isPositive: false } as Kpi },
  { id: 'real-vs-budget', componentType: 'comparison-chart', x: 0, y: 2, cols: 2, rows: 5, name: 'Gráfico Real vs. Presupuesto', chartType: 'column' },
  { id: 'cashflow-waterfall', componentType: 'cashflow-chart', x: 2, y: 2, cols: 2, rows: 5, name: 'Gráfico Flujo de Efectivo', chartType: 'waterfall' },
  { id: 'alerts', componentType: 'alerts-panel', x: 0, y: 7, cols: 4, rows: 4, name: 'Panel de Alertas' },
  { id: 'financial-ratios', componentType: 'financial-ratios', x: 0, y: 11, cols: 4, rows: 2, name: 'KPIs: Ratios Financieros' },
  { id: 'kpi-roe', componentType: 'kpi-roe', x: 0, y: 0, cols: 1, rows: 2, name: 'KPI: ROE' },
  { id: 'kpi-roa', componentType: 'kpi-roa', x: 1, y: 0, cols: 1, rows: 2, name: 'KPI: ROA' },
  { id: 'kpi-current-ratio', componentType: 'kpi-current-ratio', x: 2, y: 0, cols: 1, rows: 2, name: 'KPI: Liquidez Corriente' },
  { id: 'kpi-quick-ratio', componentType: 'kpi-quick-ratio', x: 3, y: 0, cols: 1, rows: 2, name: 'KPI: Prueba Ácida' },
  { id: 'kpi-working-capital', componentType: 'kpi-working-capital', x: 4, y: 0, cols: 1, rows: 2, name: 'KPI: Capital de Trabajo' },
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
    'sales-today': { name: 'DASH.WIDGET.SALES_TODAY.NAME', dataTitle: 'DASH.WIDGET.SALES_TODAY.TITLE' },
    'pending-invoices': { name: 'DASH.WIDGET.PENDING_INVOICES.NAME', dataTitle: 'DASH.WIDGET.PENDING_INVOICES.TITLE' },
    'low-stock-items': { name: 'DASH.WIDGET.LOW_STOCK_ITEMS.NAME', dataTitle: 'DASH.WIDGET.LOW_STOCK_ITEMS.TITLE' },
    'active-clients': { name: 'DASH.WIDGET.ACTIVE_CLIENTS.NAME', dataTitle: 'DASH.WIDGET.ACTIVE_CLIENTS.TITLE' },
    'ebitda': { name: 'DASH.WIDGET.EBITDA.NAME', dataTitle: 'DASH.WIDGET.EBITDA.TITLE', dataComparisonPeriod: 'DASH.WIDGET.EBITDA.COMP_PERIOD' },
    'net-margin': { name: 'DASH.WIDGET.NET_MARGIN.NAME', dataTitle: 'DASH.WIDGET.NET_MARGIN.TITLE', dataComparisonPeriod: 'DASH.WIDGET.NET_MARGIN.COMP_PERIOD' },
    'cash-flow-kpi': { name: 'DASH.WIDGET.CASH_FLOW_KPI.NAME', dataTitle: 'DASH.WIDGET.CASH_FLOW_KPI.TITLE', dataComparisonPeriod: 'DASH.WIDGET.CASH_FLOW_KPI.COMP_PERIOD' },
    'debt-equity': { name: 'DASH.WIDGET.DEBT_EQUITY.NAME', dataTitle: 'DASH.WIDGET.DEBT_EQUITY.TITLE', dataComparisonPeriod: 'DASH.WIDGET.DEBT_EQUITY.COMP_PERIOD' },
    'financial-ratios': { name: 'DASH.WIDGET.FINANCIAL_RATIOS.NAME' },
    'kpi-roe': { name: 'DASH.WIDGET.KPI_ROE.NAME', dataTitle: 'DASH.WIDGET.KPI_ROE.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_ROE.COMP_PERIOD' },
    'kpi-roa': { name: 'DASH.WIDGET.KPI_ROA.NAME', dataTitle: 'DASH.WIDGET.KPI_ROA.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_ROA.COMP_PERIOD' },
    'kpi-current-ratio': { name: 'DASH.WIDGET.KPI_CURRENT_RATIO.NAME', dataTitle: 'DASH.WIDGET.KPI_CURRENT_RATIO.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_CURRENT_RATIO.COMP_PERIOD' },
    'kpi-quick-ratio': { name: 'DASH.WIDGET.KPI_QUICK_RATIO.NAME', dataTitle: 'DASH.WIDGET.KPI_QUICK_RATIO.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_QUICK_RATIO.COMP_PERIOD' },
    'kpi-working-capital': { name: 'DASH.WIDGET.KPI_WORKING_CAPITAL.NAME', dataTitle: 'DASH.WIDGET.KPI_WORKING_CAPITAL.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_WORKING_CAPITAL.COMP_PERIOD' },
    'kpi-leverage': { name: 'DASH.WIDGET.KPI_LEVERAGE.NAME', dataTitle: 'DASH.WIDGET.KPI_LEVERAGE.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_LEVERAGE.COMP_PERIOD' },
    'kpi-net-margin': { name: 'DASH.WIDGET.KPI_NET_MARGIN.NAME', dataTitle: 'DASH.WIDGET.KPI_NET_MARGIN.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_NET_MARGIN.COMP_PERIOD' },
    'kpi-ebitda': { name: 'DASH.WIDGET.KPI_EBITDA.NAME', dataTitle: 'DASH.WIDGET.KPI_EBITDA.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_EBITDA.COMP_PERIOD' },
    'kpi-fcf': { name: 'DASH.WIDGET.KPI_FCF.NAME', dataTitle: 'DASH.WIDGET.KPI_FCF.TITLE', dataComparisonPeriod: 'DASH.WIDGET.KPI_FCF.COMP_PERIOD' },

    // Charts
    'real-vs-budget': { name: 'DASH.WIDGET.REAL_VS_BUDGET.NAME' },
    'cashflow-waterfall': { name: 'DASH.WIDGET.CASHFLOW_WATERFALL.NAME' },
    'expenses-pie': { name: 'DASH.WIDGET.EXPENSES_PIE.NAME' },
    'ar-aging-bar': { name: 'DASH.WIDGET.AR_AGING_BAR.NAME' },
    'sales-chart': { name: 'DASH.WIDGET.SALES_CHART.NAME' },
    'invoice-status': { name: 'DASH.WIDGET.INVOICE_STATUS.NAME' },
    'top-products': { name: 'DASH.WIDGET.TOP_PRODUCTS.NAME' },

    // Lists & Panels
    'alerts': { name: 'DASH.WIDGET.ALERTS.NAME' },
    'low-stock-table': { name: 'DASH.WIDGET.LOW_STOCK_TABLE.NAME' },
    'recent-activity': { name: 'DASH.WIDGET.RECENT_ACTIVITY.NAME' },
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
