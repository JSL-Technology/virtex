import {
  Component, Input, computed, signal, inject, effect, untracked,
  ElementRef, HostListener, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';
import { PointOptionsObject } from 'highcharts';

import {
  DashboardWidget, DashboardService, ChartType
} from '../../../../core/services/dashboard';

import {
  LucideAngularModule,
  Settings, BarChart, LineChart,
  Menu as MenuIcon, Maximize, FileDown, FileSpreadsheet, Printer,
  Trash2 // Ícono de basura importado
} from 'lucide-angular';

import { TranslateModule, TranslateService } from '@ngx-translate/core';

// Módulos Highcharts (ESM) por efectos secundarios
import 'highcharts/modules/exporting';
import 'highcharts/modules/export-data';
import 'highcharts/modules/accessibility';
import 'highcharts/modules/full-screen';

// Extiende tipos para exportación
type ExportingChart = Highcharts.Chart & {
  print: () => void;
  exportChart: (opts?: any, chartOpts?: Highcharts.Options) => void;
  downloadCSV: () => void;
  downloadXLS: () => void;
  fullscreen?: { toggle: () => void };
};

@Component({
  selector: 'app-top-products-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule, TranslateModule],
  templateUrl: './top-products-chart.html',
  styleUrls: ['../widget-styles.scss', './top-products-chart.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TopProductsChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);
  private i18n = inject(TranslateService);
  private hostEl = inject(ElementRef<HTMLElement>);

  // Íconos
  protected readonly SettingsIcon = Settings;
  protected readonly BarIcon = BarChart;
  protected readonly LineIcon = LineChart;
  protected readonly MenuIcon = MenuIcon;
  protected readonly FullscreenIcon = Maximize;
  protected readonly PrintIcon = Printer;
  protected readonly PngIcon = FileDown;
  protected readonly CsvIcon = FileSpreadsheet;
  protected readonly TrashIcon = Trash2; // Ícono de basura disponible en la plantilla

  // Estado UI
  isSettingsOpen = signal(false);
  isExportMenuOpen = signal(false);

  Highcharts: typeof Highcharts = Highcharts;
  chartRef?: Highcharts.Chart;
  private get chart(): ExportingChart | undefined {
    return this.chartRef as unknown as ExportingChart;
  }

  private chartUpdater = effect(() => {
    untracked(() => {
      if (this.chartRef) {
        this.chartRef.update(this.chartOptions(), true, true);
      }
    });
  });

  private getPaletteFromTheme(): string[] {
    const custom = (this.widget?.data as any)?.colors as string[] | undefined;
    if (custom?.length) return custom;

    if (typeof window !== 'undefined') {
      const css = getComputedStyle(document.body);
      const vars = [
        '--accent-400', '--accent-500', '--accent-600',
        '--success-400', '--warning-400', '--danger-400',
        '--blue-400', '--purple-400', '--pink-400', '--teal-400'
      ];
      const palette = vars.map(v => css.getPropertyValue(v).trim()).filter(Boolean);
      if (palette.length) return palette;
    }
    return ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa'];
  }

  private getThemeOptions(): Highcharts.Options {
    if (typeof window === 'undefined') return {};
    const css = getComputedStyle(document.body);

    const text = css.getPropertyValue('--text-primary').trim() || '#111827';
    const text2 = css.getPropertyValue('--text-secondary').trim() || '#6b7280';
    const border = css.getPropertyValue('--border-color').trim() || '#e5e7eb';
    const bg = css.getPropertyValue('--bg-layer-1').trim() || 'transparent';
    const hoverBg = css.getPropertyValue('--bg-hover').trim() || 'rgba(0,0,0,0.06)';
    const accent = css.getPropertyValue('--accent-primary').trim() || '#6366f1';
    const radius = Number(css.getPropertyValue('--radius-md').replace('px', '').trim() || 10) || 10;

    return {
      chart: { backgroundColor: 'transparent' },
      legend: { itemStyle: { color: text2, fontWeight: '500' } },
      xAxis: { labels: { style: { color: text2 } }, lineColor: border, tickColor: border },
      yAxis: { title: { style: { color: text2 } }, labels: { style: { color: text2 } }, gridLineColor: border },
      tooltip: { backgroundColor: bg, borderColor: border, style: { color: text } },
      navigation: {
        buttonOptions: { theme: { stroke: text2, fill: 'transparent' } },
        menuStyle: {
          background: bg, border: `1px solid ${border}`,
          boxShadow: `0 8px 16px var(--shadow-color)`,
          borderRadius: radius, padding: '0.5rem'
        },
        menuItemStyle: {
          color: text, fontSize: '13px', fontWeight: '500',
          padding: '0.5rem 1rem', borderRadius: Math.max(6, radius * 0.66)
        },
        menuItemHoverStyle: { background: hoverBg, color: accent }
      },
      credits: { enabled: false }
    };
  }

  // NEW: colores por defecto hardcodeados como en tu ejemplo
  private getDefaultSeriesColors(categories: string[], chartType: ChartType): Record<string, string> {
    // Base tomada de tu ejemplo: pagadas (verde), pendientes (naranja), vencidas (rojo)
    const base = ['#4ade80', '#fb923c', '#f87171', '#60a5fa', '#a78bfa']; // extendido para más ítems

    if (chartType === 'line') {
      // Para líneas usamos un solo color por defecto
      return { __series: base[0] };
    }

    const map: Record<string, string> = {};
    categories.forEach((name, i) => {
      map[name.toLowerCase()] = base[i % base.length];
    });
    return map;
  }

  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = (this.widget.chartType || 'bar') as ChartType;

    const categories: string[] =
      (this.widget?.data as any)?.categories ?? ['Laptop Pro', 'Mouse Ergo', 'Monitor UW', 'Teclado RGB', 'Webcam HD'];
    const values: number[] =
      (this.widget?.data as any)?.values ?? [120, 95, 88, 75, 60];

    const palette = this.getPaletteFromTheme();
    const theme = this.getThemeOptions();
    const isBarLike = chartType === 'bar' || chartType === 'column';

    // CHANGED: seriesColors ahora usa hardcoded defaults si no hay configuración del widget
    const seriesColors: Record<string, string> =
      ((this.widget?.data as any)?.seriesColors as Record<string, string> | undefined)
      ?? this.getDefaultSeriesColors(categories, chartType);

    const barData: PointOptionsObject[] = categories.map((name, i) => ({
      name,
      y: values[i] ?? 0,
      color: seriesColors[name.toLowerCase()] ?? palette[i % palette.length],
      borderColor: 'transparent'
    }));

    const lineColor = seriesColors['__series'] ?? '#4ade80'; // por defecto verde (como tu ejemplo)

    const series: Highcharts.SeriesOptionsType[] = [{
      name: this.i18n.instant('CHARTS.TOP_PRODUCTS.SERIES_NAME'),
      type: chartType as any,
      data: isBarLike ? (barData as any) : (values as any),
      ...(isBarLike ? { colorByPoint: true, borderRadius: 4 } : { color: lineColor })
    }];

    const base: Highcharts.Options = {
      chart: { type: chartType as any, backgroundColor: 'transparent' },
      title: { text: '' },
      xAxis: { categories },
      yAxis: {
        min: 0,
        title: { text: this.i18n.instant('CHARTS.TOP_PRODUCTS.Y_AXIS_TITLE') }
      },
      colors: palette,
      plotOptions: {
        column: { borderWidth: 0, borderRadius: 4, pointPadding: 0.1, groupPadding: 0.1 },
        bar: { borderWidth: 0, borderRadius: 4, pointPadding: 0.1, groupPadding: 0.1 },
        series: { states: { hover: { halo: { size: 6 } } } }
      },
      series,
      legend: { enabled: false },
      exporting: { enabled: false } // usamos menú personalizado
    };

    return Highcharts.merge(base, theme);
  });

  // CHANGED: refleja los colores por defecto también en el panel para líneas
  chartDataPoints = computed(() => {
    const type = (this.widget.chartType || 'bar') as ChartType;

    if (type === 'line') {
      const seriesColors: Record<string, string> =
        ((this.widget?.data as any)?.seriesColors as Record<string, string> | undefined)
        ?? this.getDefaultSeriesColors([], 'line');
      const color = seriesColors['__series'] ?? '#4ade80';
      const label = this.i18n.instant('CHARTS.TOP_PRODUCTS.SERIES_NAME') || 'Serie';
      const point: PointOptionsObject = { name: label, color };
      return [point];
    }

    const s = this.chartOptions().series?.[0];
    if (s && 'data' in s && Array.isArray(s.data)) {
      return s.data as PointOptionsObject[];
    }
    return [];
  });

  onChartInstance(chart: Highcharts.Chart) { this.chartRef = chart; }

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
  closeMenus() { this.isExportMenuOpen.set(false); this.isSettingsOpen.set(false); }

  changeChartType(newType: ChartType, event: MouseEvent) {
    event.stopPropagation();
    if (this.widget.id) {
      this.dashboardService.updateWidgetConfig(this.widget.id, { chartType: newType });
    }
  }

  updateSeriesColor(event: Event, seriesName: string): void {
    const newColor = (event.target as HTMLInputElement).value;
    const type = (this.widget.chartType || 'bar') as ChartType;

    const key = (type === 'line') ? '__series' : seriesName.toLowerCase();

    if (this.widget.id) {
      const current = (this.widget.data?.seriesColors ?? {}) as Record<string, string>;
      const updated = { ...current, [key]: newColor };

      this.dashboardService.updateWidgetConfig(this.widget.id, {
        data: { ...this.widget.data, seriesColors: updated }
      });
    }
  }
  
  removeWidget(event: MouseEvent) {
    event.stopPropagation();
    if (this.widget.id) {
        this.dashboardService.removeWidget(this.widget.id);
    }
  }

  // Exportación (menú personalizado)
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