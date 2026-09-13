import {
  Component, Input, computed, signal, inject, effect,
  ChangeDetectionStrategy, untracked, ElementRef, HostListener
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { catchError, of } from 'rxjs';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';
import { categoricalPalette } from '../../../../core/utils/chart-theme';

// Se importan los módulos ESM directamente para sus efectos secundarios.
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
import { PointOptionsObject } from 'highcharts';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreakdownSlice, DashboardApiService } from '../../../../core/api/dashboard-api.service';

type ExportingChart = Highcharts.Chart & {
  print: () => void;
  exportChart: (opts?: any, chartOpts?: Highcharts.Options) => void;
  downloadCSV: () => void;
  downloadXLS: () => void;
  fullscreen?: { toggle: () => void };
};

@Component({
  selector: 'app-expenses-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule, TranslateModule],
  templateUrl: './expenses-chart.html',
  styleUrls: ['./expenses-chart.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpensesChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);
  private brandingService = inject(BrandingService);
  private hostEl = inject(ElementRef<HTMLElement>);

  // Íconos
  protected readonly SettingsIcon = Settings;
  protected readonly ColumnIcon = BarChart;
  protected readonly PieIcon = PieChart;
  protected readonly MenuIcon = MenuIcon;
  protected readonly FullscreenIcon = Maximize;
  protected readonly PrintIcon = Printer;
  protected readonly PngIcon = FileDown;
  protected readonly CsvIcon = FileSpreadsheet;

  // Estado UI
  isSettingsOpen = signal(false);
  isExportMenuOpen = signal(false);

  private readonly dashboardApi = inject(DashboardApiService);
  private readonly i18n = inject(TranslateService);

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

  /**
   * Operating expenses by account, from the ledger.
   *
   * This was five hardcoded slices — "Nómina y Salarios 45 %, Marketing 25 %, Alquiler 15 %…" —
   * identical for every tenant and untranslated. By account rather than by an invented taxonomy:
   * the chart of accounts is the classification the tenant chose and the one their accountant
   * reconciles against.
   */
  private readonly breakdown = toSignal(
    this.dashboardApi.getExpenseBreakdown(12, 8).pipe(catchError(() => of([] as BreakdownSlice[]))),
    { initialValue: [] as BreakdownSlice[] },
  );

  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = (this.widget.chartType || 'pie') as ChartType;
    const themeOptions = this.getThemeOptions();
    const palette = categoricalPalette();
    const configuredColors = this.widget.data?.seriesColors ?? {};

    // Colour by position in the palette, keyed on the account's own name so a given expense keeps
    // its hue between sessions and between charts.
    const data = this.breakdown().map((slice, index) => ({
      name: slice.label,
      y: slice.amount,
      color: configuredColors[slice.label.toLowerCase()] ?? palette[index % palette.length],
    }));

    const baseOptions: Highcharts.Options = {
      chart: { type: chartType as any },
      title: { text: this.i18n.instant('DASHBOARD.EXPENSES_CHART.TITLE') },
      legend: {
        enabled: true,
        itemStyle: { color: 'var(--text-secondary)', fontWeight: '500' }
      },

      subtitle: { text: this.i18n.instant('DASHBOARD.EXPENSES_CHART.SUBTITLE') },
      plotOptions: {
        pie: { innerSize: '60%', dataLabels: { enabled: false }, showInLegend: true, borderWidth: 3, borderColor: 'var(--bg-layer-1)', allowPointSelect: true },
        column: { borderWidth: 0, borderRadius: 4, pointWidth: 25, allowPointSelect: true },

      },
      xAxis: { categories: data.map(d => d.name), crosshair: true },
      series: [{
        name: this.i18n.instant('DASHBOARD.EXPENSES_CHART.SERIES'), type: chartType as any, data,
        states: { hover: { halo: { size: 8 } } }
      }],
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
      subtitle: { style: { color: secondaryTextColor } },
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
      const updatedColors = { ...currentColors, [seriesName.toLowerCase().replace(/ /g, '_')]: newColor };

      this.dashboardService.updateWidgetConfig(this.widget.id, {
        data: { ...this.widget.data, seriesColors: updatedColors }
      });
    }
  }

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