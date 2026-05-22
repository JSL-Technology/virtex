import {
  Component, Input, computed, signal, inject, effect,
  ChangeDetectionStrategy, untracked, ElementRef, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';

// Se importan los módulos ESM necesarios
import 'highcharts/modules/exporting';
import 'highcharts/modules/export-data';
import 'highcharts/modules/accessibility';
import 'highcharts/modules/full-screen';

import {
  LucideAngularModule, Settings, BarChart, PieChart,
  Menu as MenuIcon, Maximize, FileDown, FileSpreadsheet, Printer
} from 'lucide-angular';

import { DashboardWidget, DashboardService, ChartType } from '../../../../core/services/dashboard';
import { BrandingService } from '../../../../core/services/branding';

type ExportingChart = Highcharts.Chart & {
  print: () => void;
  exportChart: (opts?: any, chartOpts?: Highcharts.Options) => void;
  downloadCSV: () => void;
  downloadXLS: () => void;
  fullscreen?: { toggle: () => void };
};

@Component({
  selector: 'app-ar-aging-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule],
  templateUrl: './ar-aging-chart.html',
  styleUrls: ['./ar-aging-chart.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArAgingChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);
  private brandingService = inject(BrandingService);
  private hostEl = inject(ElementRef<HTMLElement>);

  // Íconos
  protected readonly SettingsIcon = Settings;
  protected readonly BarIcon = BarChart;
  protected readonly ColumnIcon = PieChart;
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

  // Effect para la actualización en tiempo real
  private chartUpdater = effect(() => {
    untracked(() => {
      if (this.chartRef) {
        this.chartRef.update(this.chartOptions(), true, true);
      }
    });
  });

  // Opciones reactivas del gráfico
  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = (this.widget.chartType || 'bar') as ChartType;
    const themeOptions = this.getThemeOptions();

    const data = [
      { name: 'Corriente', y: 65000, color: '#4ade80' },
      { name: '1-30 Días', y: 22000, color: '#fbbf24' },
      { name: '31-60 Días', y: 15000, color: '#fb923c' },
      { name: '61-90 Días', y: 8500, color: '#f87171' },
      { name: '+90 Días', y: 4000, color: '#ef4444' }
    ];

    const baseOptions: Highcharts.Options = {
      chart: { type: chartType },
      title: { text: 'Antigüedad de Saldos por Cobrar' },
      xAxis: { categories: data.map(d => d.name) },
      yAxis: { title: { text: 'Monto Pendiente ($)' } },
      plotOptions: {
        bar: { dataLabels: { enabled: true }, borderRadius: 4 },
        column: { dataLabels: { enabled: true }, borderRadius: 4 },
        pie: { dataLabels: { enabled: false }, showInLegend: true, innerSize: '60%' }
      },
      series: [{
        name: 'Cartera',
        type: chartType as any,
        data
      }],
      credits: { enabled: false },
      exporting: { enabled: false },
      legend: { enabled: false }
    };

    return Highcharts.merge(baseOptions, themeOptions);
  });

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
      title: { style: { color: textColor } },
      legend: { itemStyle: { color: secondaryTextColor } },
      xAxis: { labels: { style: { color: secondaryTextColor } }, lineColor: 'var(--border-color)', tickColor: 'var(--border-color)' },
      yAxis: { title: { style: { color: secondaryTextColor } }, labels: { style: { color: secondaryTextColor } }, gridLineColor: 'var(--border-color)' },
      plotOptions: { series: { dataLabels: { style: { color: secondaryTextColor, textOutline: 'none' } } } },
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
      },
      tooltip: {
        backgroundColor: bgColor,
        borderColor: 'var(--border-color)',
        style: { color: textColor }
      }
    };
  }

  onChartInstance(chart: Highcharts.Chart) {
    this.chartRef = chart;
  }

  // Control de menús
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

  // Acciones de exportación
  viewFullscreen(ev: MouseEvent) { ev.stopPropagation(); this.chart?.fullscreen?.toggle(); this.closeMenus(); }
  printChart(ev: MouseEvent) { ev.stopPropagation(); this.chart?.print(); this.closeMenus(); }
  downloadPNG(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'image/png' }); this.closeMenus(); }
  downloadJPEG(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'image/jpeg' }); this.closeMenus(); }
  downloadPDF(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'application/pdf' }); this.closeMenus(); }
  downloadSVG(ev: MouseEvent) { ev.stopPropagation(); this.chart?.exportChart({ type: 'image/svg+xml' }); this.closeMenus(); }
  downloadCSV(ev: MouseEvent) { ev.stopPropagation(); this.chart?.downloadCSV(); this.closeMenus(); }
  downloadXLS(ev: MouseEvent) { ev.stopPropagation(); this.chart?.downloadXLS(); this.closeMenus(); }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(ev: MouseEvent) {
    if (!this.hostEl.nativeElement.contains(ev.target as Node)) {
      this.closeMenus();
    }
  }
}