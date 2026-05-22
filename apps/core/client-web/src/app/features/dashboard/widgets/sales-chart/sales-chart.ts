import { Component, Input, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';
import { DashboardWidget, DashboardService, ChartType } from '../../../../core/services/dashboard';
import { LucideAngularModule, Settings, AreaChart, LineChart } from 'lucide-angular';
import Exporting from 'highcharts/modules/exporting';

// Exporting(Highcharts);

@Component({
  selector: 'app-sales-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule],
  templateUrl: './sales-chart.html',
  styleUrls: ['../widget-styles.scss'],
})
export class SalesChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);

  protected readonly SettingsIcon = Settings;
  protected readonly AreaIcon = AreaChart;
  protected readonly LineIcon = LineChart;

  isSettingsOpen = signal(false);
  Highcharts: typeof Highcharts = Highcharts;

  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = this.widget.chartType || 'area';

    return {
      chart: { type: chartType, backgroundColor: 'transparent' },
      title: { text: '' },
      xAxis: { categories: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul'], labels: { style: { color: 'var(--text-secondary)' } } },
      yAxis: { title: { text: 'Ingresos ($)' }, labels: { style: { color: 'var(--text-secondary)' } } },
      series: [{
        name: 'Ventas',
        type: chartType as any,
        data: [5200, 7500, 6800, 9100, 8800, 12500, 11300],
        color: 'var(--accent-primary)',
        fillOpacity: 0.1,
        marker: { enabled: true, symbol: 'circle' }
      }],
      credits: { enabled: false },
      legend: { enabled: false },
      exporting: { enabled: true },
      tooltip: { backgroundColor: 'var(--bg-layer-1)', borderColor: 'var(--border-color)', style: { color: 'var(--text-primary)' } }
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