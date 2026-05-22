import { Component, Input, computed, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';
import { DashboardWidget, DashboardService, ChartType } from '../../../../core/services/dashboard';
import { LucideAngularModule, Settings, BarChart, AreaChart, PieChart } from 'lucide-angular';

// Importar y activar el módulo de exportación de Highcharts para habilitar el menú contextual (imprimir, descargar, etc.)
import Exporting from 'highcharts/modules/exporting';
// Exporting(Highcharts);

@Component({
  selector: 'app-comparison-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule],
  templateUrl: './comparison-chart.html',
  styleUrls: ['../widget-styles.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);

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

    // Datos base para los gráficos
    const seriesData: Highcharts.SeriesOptionsType[] = [
      { name: 'Presupuesto', type: 'column', data: [100, 110, 105, 120, 125, 130, 135], color: 'var(--gray-300)' },
      { name: 'Real', type: 'column', data: [95, 105, 108, 125, 120, 132, 140], color: 'var(--accent-primary)', pointPadding: 0.2 }
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
          name: 'Total', type: 'pie',
          data: [
            { name: 'Presupuesto', y: 135, color: 'var(--gray-300)' },
            { name: 'Real', y: 140, color: 'var(--accent-primary)' }
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
      xAxis: { categories: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul'], labels: { style: { color: 'var(--text-secondary)' } } },
      yAxis: { title: { text: 'Monto ($)' }, labels: { style: { color: 'var(--text-secondary)' } } },
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