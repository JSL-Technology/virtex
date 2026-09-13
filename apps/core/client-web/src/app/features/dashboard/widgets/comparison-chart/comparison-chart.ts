import { Component, Input, computed, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { DashboardWidget, DashboardService, ChartType } from '../../../../core/services/dashboard';
import {
  BudgetVsActualPoint,
  DashboardApiService,
} from '../../../../core/api/dashboard-api.service';
import { FormatService } from '../../../../core/i18n/format.service';
import { LucideAngularModule, Settings, BarChart, AreaChart, PieChart } from 'lucide-angular';

// Importar y activar el módulo de exportación de Highcharts para habilitar el menú contextual (imprimir, descargar, etc.)
import Exporting from 'highcharts/modules/exporting';
import { TranslateModule } from '@ngx-translate/core';
// Exporting(Highcharts);

@Component({
  selector: 'app-comparison-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule, TranslateModule],
  templateUrl: './comparison-chart.html',
  styleUrls: ['../widget-styles.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);
  private dashboardApi = inject(DashboardApiService);
  private i18n = inject(TranslateService);
  private format = inject(FormatService);

  /**
   * Plan against reality, month by month, on the accounts the budget itself names.
   *
   * It used to be `Presupuesto [100, 110, 105, …]` against `Real [95, 105, 108, …]`: two invented
   * series shown to every tenant, including the ones that keep no budget at all.
   */
  private readonly points = toSignal(
    this.dashboardApi.getBudgetVsActual(12).pipe(catchError(() => of([] as BudgetVsActualPoint[]))),
    { initialValue: [] as BudgetVsActualPoint[] },
  );

  /** True when this tenant has no budget at all for the window: worth saying, not worth faking. */
  readonly hasBudget = computed(() => this.points().some((point) => point.budgeted !== 0));

  // Íconos para el menú de edición del widget
  protected readonly SettingsIcon = Settings;
  protected readonly ColumnIcon = BarChart;
  protected readonly AreaIcon = AreaChart;
  protected readonly PieIcon = PieChart;

  isSettingsOpen = signal(false);
  Highcharts: typeof Highcharts = Highcharts;

  // El gráfico ahora es una señal computada que reacciona a los cambios en `widget.chartType`
  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = this.widget.chartType || 'column';

    const points = this.points();
    const budgetLabel = this.i18n.instant('DASHBOARD.COMPARISON_CHART.PRESUPUESTO');
    const actualLabel = this.i18n.instant('DASHBOARD.COMPARISON_CHART.REAL');

    const seriesData: Highcharts.SeriesOptionsType[] = [
      { name: budgetLabel, type: 'column', data: points.map((p) => p.budgeted), color: 'var(--gray-300)' },
      { name: actualLabel, type: 'column', data: points.map((p) => p.actual), color: 'var(--accent-primary)', pointPadding: 0.2 }
    ];

    // Si el tipo de gráfico es 'pie', necesita una estructura de datos diferente
    if (chartType === 'pie') {
      return {
        chart: { type: 'pie', backgroundColor: 'transparent' },
        title: { text: '' },
        plotOptions: {
          pie: {
            innerSize: '60%',
            allowPointSelect: true,
            cursor: 'pointer',
            dataLabels: { enabled: false },
            showInLegend: true,
            borderColor: 'var(--bg-layer-1)'
          }
        },
        legend: { itemStyle: { color: 'var(--text-secondary)' } },
        series: [{
          name: this.i18n.instant('DASHBOARD.COMPARISON_CHART.TOTAL'), type: 'pie',
          data: [
            {
              name: budgetLabel,
              y: points.reduce((sum, point) => sum + point.budgeted, 0),
              color: 'var(--gray-300)',
            },
            {
              name: actualLabel,
              y: points.reduce((sum, point) => sum + point.actual, 0),
              color: 'var(--accent-primary)',
            },
          ]
        }],
        credits: { enabled: false },
        exporting: { enabled: true }, // Habilita el menú de exportación
      };
    }

    // Opciones para los demás tipos de gráficos (columnas, áreas, líneas)
    return {
      chart: { type: chartType, backgroundColor: 'transparent' },
      title: { text: '' },
      xAxis: {
        categories: points.map((point) => this.format.date(point.month, 'monthYear')),
        labels: { style: { color: 'var(--text-secondary)' } },
      },
      yAxis: {
        title: { text: this.i18n.instant('DASHBOARD.COMPARISON_CHART.MONTO') },
        labels: { style: { color: 'var(--text-secondary)' } },
      },
      plotOptions: { column: { grouping: false, borderWidth: 0, shadow: false } },
      series: seriesData.map(s => ({ ...s, type: chartType as any })),
      credits: { enabled: false },
      exporting: { enabled: true }, // Habilita el menú de exportación
      legend: { itemStyle: { color: 'var(--text-secondary)' } },
      tooltip: {
        backgroundColor: 'var(--bg-layer-1)',
        borderColor: 'var(--border-color)',
        style: { color: 'var(--text-primary)' }
      }
    };
  });

  toggleSettings(event: MouseEvent): void {
    event.stopPropagation();
    this.isSettingsOpen.update(open => !open);
  }

  changeChartType(newType: ChartType, event: MouseEvent): void {
    event.stopPropagation();
    if (this.widget.id) {
      this.dashboardService.updateWidgetConfig(this.widget.id, { chartType: newType });
    }
    this.isSettingsOpen.set(false);
  }
}