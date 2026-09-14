import { Component, Input, computed, signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';
import { catchError, of } from 'rxjs';
import { DashboardWidget, DashboardService, ChartType } from '../../../../core/services/dashboard';
import { DashboardApiService, TrendPoint } from '../../../../core/api/dashboard-api.service';
import { FormatService } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Settings, AreaChart, LineChart } from 'lucide-angular';
import Exporting from 'highcharts/modules/exporting';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

// Exporting(Highcharts);

@Component({
  selector: 'app-sales-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent, LucideAngularModule, TranslateModule],
  templateUrl: './sales-chart.html',
  styleUrls: ['../widget-styles.scss'],
})
export class SalesChart {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() isEditMode = false;

  private dashboardService = inject(DashboardService);
  private dashboardApi = inject(DashboardApiService);
  private i18n = inject(TranslateService);
  private format = inject(FormatService);

  /**
   * Revenue per month, from the tenant's own issued documents.
   *
   * This series used to be `[5200, 7500, 6800, 9100, 8800, 12500, 11300]` over `Ene…Jul` — the same
   * seven months, for every customer of the product, for ever.
   */
  private readonly trend = toSignal(
    this.dashboardApi.getSalesTrend(12).pipe(catchError(() => of([] as TrendPoint[]))),
    { initialValue: [] as TrendPoint[] },
  );

  protected readonly SettingsIcon = Settings;
  protected readonly AreaIcon = AreaChart;
  protected readonly LineIcon = LineChart;

  isSettingsOpen = signal(false);
  Highcharts: typeof Highcharts = Highcharts;

  chartOptions = computed<Highcharts.Options>(() => {
    const chartType = this.widget.chartType || 'area';
    const points = this.trend();

    return {
      chart: { type: chartType, backgroundColor: 'transparent' },
      title: { text: '' },
      // Month names in the reader's language and the tenant's timezone, from the same formatter the
      // rest of the product uses — not a hardcoded `['Ene', 'Feb', …]`.
      xAxis: {
        categories: points.map((point) => this.format.date(point.month, 'monthYear')),
        labels: { style: { color: 'var(--text-secondary)' } },
      },
      yAxis: {
        title: { text: this.i18n.instant('dashboard.sales_chart.monthly_revenue') },
        labels: { style: { color: 'var(--text-secondary)' } },
      },
      series: [{
        name: this.i18n.instant('dashboard.sales_chart.monthly_revenue'),
        type: chartType as any,
        data: points.map((point) => point.amount),
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