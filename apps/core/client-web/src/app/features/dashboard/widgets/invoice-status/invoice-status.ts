import {
  Component, Input, computed, signal, inject, effect,
  ChangeDetectionStrategy, untracked, ElementRef, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';

// Se importan los módulos ESM directamente para sus efectos secundarios.
import 'highcharts/modules/exporting';
import 'highcharts/modules/export-data';
import 'highcharts/modules/accessibility';
import 'highcharts/modules/full-screen';

import {
  LucideAngularModule, Settings, BarChart, AreaChart, PieChart,
  Menu as MenuIcon, Maximize, FileDown, FileSpreadsheet, Printer
} from 'lucide-angular';

import { DashboardWidget, DashboardService, ChartType } from '../../../../core/services/dashboard';
import { BrandingService } from '../../../../core/services/branding';
import { PointOptionsObject } from 'highcharts';

// Extiende tipos que Highcharts no declara en Chart para los métodos de exportación
type ExportingChart = Highcharts.Chart & {
  print: () => void;
  exportChart: (opts?: any, chartOpts?: Highcharts.Options) => void;
  downloadCSV: () => void;
  downloadXLS: () => void;
  fullscreen?: { toggle: () => void };
};

@Component({
  selector: 'app-invoice-status',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule],
  templateUrl: './invoice-status.html',
  styleUrls: ['./invoice-status.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceStatus {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);
  private brandingService = inject(BrandingService);
  private hostEl = inject(ElementRef<HTMLElement>);

  // Íconos
  protected readonly SettingsIcon = Settings;
  protected readonly ColumnIcon = BarChart;
  protected readonly AreaIcon = AreaChart;
  protected readonly PieIcon = PieChart;
  protected readonly MenuIcon = MenuIcon;
  protected readonly FullscreenIcon = Maximize;
  protected readonly PrintIcon = Printer;
  protected readonly PngIcon = FileDown;
  protected readonly CsvIcon = FileSpreadsheet;

  // Estado UI
  isSettingsOpen = signal(false);
  isExportMenuOpen = signal(false);

  chartRef?: Highcharts.Chart;
  private get chart(): ExportingChart | undefined {
    return this.chartRef as unknown as ExportingChart;
  }

  /**
   * ✅ MEJORA 1: ACTUALIZACIÓN EN TIEMPO REAL
   * Este 'effect' se ejecuta cuando las 'chartOptions' cambian y actualiza el gráfico.
   */
  private chartUpdater = effect(() => {
    untracked(() => {
      if (this.chartRef) {
        this.chartRef.update(this.chartOptions(), true, true);
      }
    });
  });

  // Opciones reactivas
  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = (this.widget.chartType || 'pie') as ChartType;
    const themeOptions = this.getThemeOptions();

    const seriesColors = this.widget.data?.seriesColors || {
      pagadas: '#4ade80',
      pendientes: '#fb923c',
      vencidas: '#f87171'
    };

    const data = [
      { name: 'Pagadas', y: 70, color: seriesColors.pagadas },
      { name: 'Pendientes', y: 20, color: seriesColors.pendientes },
      { name: 'Vencidas', y: 10, color: seriesColors.vencidas }
    ];

    const baseOptions: Highcharts.Options = {
      chart: { type: chartType as any },
      title: { text: 'Distribución de Facturas', style: { color: 'var(--text-primary)', fontSize: '16px', fontWeight: '600' } },
      // subtitle: { text: 'Estado actual de la cartera de clientes', style: { color: 'var(--text-secondary)' } },
      plotOptions: {
        pie: { dataLabels: { enabled: false }, showInLegend: true, borderWidth: 3, borderColor: 'var(--bg-layer-1)', allowPointSelect: true },
        column: { borderWidth: 0, borderRadius: 4, pointWidth: 25, allowPointSelect: true },
        bar: { borderWidth: 0, allowPointSelect: true },
      },
      // ✅ CORRECCIÓN: Se define el xAxis para que el gráfico de columnas tenga las etiquetas correctas
      xAxis: {
        categories: data.map(d => d.name),
        crosshair: true
      },
      series: [{
        name: 'Facturas', type: chartType as any, data,
        states: { hover: { halo: { size: 8 } } }
      }],

      legend: {
        align: 'right',
        verticalAlign: 'middle',
        layout: 'vertical'
      },
      credits: { enabled: false },
      exporting: { enabled: false }
    };

    return Highcharts.merge(baseOptions, themeOptions);
  });

  chartDataPoints = computed(() => {
    const series = this.chartOptions().series?.[0];
    if (series && 'data' in series && Array.isArray(series.data)) {
      return series.data as PointOptionsObject[];
    }
    return [];
  });

  /**
   * ✅ MEJORA 2: MENÚ ADAPTADO AL TEMA
   * Genera los estilos para el menú y el gráfico basados en el tema de la aplicación.
   */
  private getThemeOptions(): Highcharts.Options {
    if (typeof window === 'undefined') return {};
    const bodyStyles = getComputedStyle(document.body);
    const textColor = bodyStyles.getPropertyValue('--text-primary').trim();
    const secondaryTextColor = bodyStyles.getPropertyValue('--text-secondary').trim();
    const bgColor = bodyStyles.getPropertyValue('--bg-layer-1').trim();
    const hoverBgColor = bodyStyles.getPropertyValue('--bg-hover').trim();
    const accentColor = bodyStyles.getPropertyValue('--accent-primary').trim();
    const borderRadiusMd = this.brandingService.settings().borderRadius;

    return {
      chart: { backgroundColor: 'transparent' },
      legend: { itemStyle: { color: secondaryTextColor, fontWeight: '500' } },
      xAxis: { labels: { style: { color: secondaryTextColor } }, lineColor: 'var(--border-color)', tickColor: 'var(--border-color)' },
      yAxis: { title: { style: { color: secondaryTextColor } }, labels: { style: { color: secondaryTextColor } }, gridLineColor: 'var(--border-color)' },
      navigation: {
        buttonOptions: {
          theme: {
            stroke: secondaryTextColor, fill: 'transparent',
            // states: { hover: { fill: hoverBgColor }, select: { fill: hoverBgColor } }

          }
        },
        menuStyle: {
          background: bgColor, border: `1px solid var(--border-color)`,
          boxShadow: `0 8px 16px var(--shadow-color)`, borderRadius: borderRadiusMd, padding: '0.5rem'
        },
        menuItemStyle: {
          color: textColor, fontSize: '13px', fontWeight: '500',
          padding: '0.5rem 1rem', borderRadius: borderRadiusMd * 0.66
        },
        menuItemHoverStyle: { background: hoverBgColor, color: accentColor }
      }
    };
  }

  onChartInstance(chart: Highcharts.Chart) {
    this.chartRef = chart;
  }

  // Acciones de los menús
  closeMenus() {
    this.isExportMenuOpen.set(false);
    this.isSettingsOpen.set(false);
  }

  toggleSettings(event: MouseEvent) {
    event.stopPropagation();
    this.isExportMenuOpen.set(false);
    this.isSettingsOpen.update(o => !o);
  }

  toggleExportMenu(event: MouseEvent) {
    event.stopPropagation();
    this.isSettingsOpen.set(false);
    this.isExportMenuOpen.update(o => !o);
  }

  changeChartType(newType: ChartType, event: MouseEvent) {
    event.stopPropagation();
    if (this.widget.id) {
      this.dashboardService.updateWidgetConfig(this.widget.id, { chartType: newType });
    }
  }

  updateSeriesColor(event: Event, seriesName: string): void {
    const newColor = (event.target as HTMLInputElement).value;
    if (this.widget.id) {
      const currentColors = this.widget.data?.seriesColors || {};
      const updatedColors = { ...currentColors, [seriesName.toLowerCase()]: newColor };

      this.dashboardService.updateWidgetConfig(this.widget.id, {
        data: { ...this.widget.data, seriesColors: updatedColors }
      });
    }
  }

  // Acciones de exportación
  viewFullscreen(ev: MouseEvent) { ev.stopPropagation(); this.chart?.fullscreen?.toggle(); this.closeMenus(); }
  printChart(ev: MouseEvent) { ev.stopPropagation(); this.chart?.print(); this.closeMenus(); }
  downloadPNG(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'image/png' }); this.closeMenus(); }
  downloadJPEG(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'image/jpeg' }); this.closeMenus(); }
  downloadPDF(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'application/pdf' }); this.closeMenus(); }
  downloadSVG(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'image/svg+xml' }); this.closeMenus(); }
  downloadCSV(ev: MouseEvent) { ev.stopPropagation(); this.chart?.downloadCSV(); this.closeMenus(); }
  downloadXLS(ev: MouseEvent) { ev.stopPropagation(); this.chart?.downloadXLS(); this.closeMenus(); }

  // Cierra los menús al hacer clic fuera del componente
  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(ev: MouseEvent) {
    if (!this.hostEl.nativeElement.contains(ev.target as Node)) {
      this.closeMenus();
    }
  }
}