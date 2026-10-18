import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HighchartsChartComponent } from 'highcharts-angular';
import type * as Highcharts from 'highcharts';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { baseChartOptions, categoricalPalette, token } from '../../../core/utils/chart-theme';
import { ForecastSeries } from '../data/ai.service';

/** `#rrggbb` → `rgba(r, g, b, alpha)`, for the band drawn in its line's own hue. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * Units sold, then the forecast: its median as a line and the P10–P90 range as a band around it.
 *
 * One axis, two identities — what happened and what is expected — each in its fixed categorical
 * colour, the band in the forecast's own hue at low opacity so it reads as "the same thing, less
 * certain". A shared crosshair tooltip gives the exact values, and the table under the chart
 * carries the same numbers for anyone who cannot or does not want to read the plot.
 */
@Component({
  selector: 'app-forecast-chart',
  standalone: true,
  imports: [HighchartsChartComponent, TranslatePipe, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <highcharts-chart class="forecast-chart" [options]="options()" />
    <details class="forecast-table">
      <summary>{{ 'ai.predictions.chart.show_table' | translate }}</summary>
      <table class="data-table">
        <thead>
          <tr>
            <th>{{ 'ai.predictions.chart.date' | translate }}</th>
            <th class="numeric">{{ 'ai.predictions.chart.p10' | translate }}</th>
            <th class="numeric">{{ 'ai.predictions.chart.p50' | translate }}</th>
            <th class="numeric">{{ 'ai.predictions.chart.p90' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of series().forecast.slice(0, 30); track row.date) {
            <tr>
              <td>{{ row.date | vxDate }}</td>
              <td class="numeric">{{ row.p10 | vxNumber: '1.0-2' }}</td>
              <td class="numeric">{{ row.p50 | vxNumber: '1.0-2' }}</td>
              <td class="numeric">{{ row.p90 | vxNumber: '1.0-2' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </details>
  `,
  styles: [
    `
      :host { display: block; }
      .forecast-chart { display: block; width: 100%; height: 280px; }
      .forecast-table { margin-top: var(--space-2); font-size: var(--text-sm); }
      .forecast-table summary { cursor: pointer; color: var(--accent-text); }
    `,
  ],
})
export class ForecastChartComponent {
  private readonly i18n = inject(TranslateService);
  readonly series = input.required<ForecastSeries>();

  readonly options = computed<Highcharts.Options>(() => {
    const data = this.series();
    const palette = categoricalPalette();
    const actualColor = palette[0] || token('--content-secondary');
    const forecastColor = palette[1] || token('--accent-solid');
    const base = baseChartOptions();
    const t = (key: string) => this.i18n.instant(key);

    return {
      ...base,
      chart: { ...base.chart, type: 'line', height: 280, zooming: { type: 'x' } },
      legend: { ...base.legend, enabled: true },
      xAxis: { ...(base.xAxis as Highcharts.XAxisOptions), type: 'datetime', crosshair: true },
      yAxis: { ...(base.yAxis as Highcharts.YAxisOptions), min: 0, title: { text: t('ai.predictions.chart.units') } },
      tooltip: { ...base.tooltip, shared: true, valueDecimals: 1, xDateFormat: '%e %b %Y' },
      plotOptions: { series: { marker: { enabled: false, radius: 4 }, lineWidth: 2, animation: false } },
      series: [
        {
          type: 'line',
          name: t('ai.predictions.chart.actual'),
          color: actualColor,
          data: data.history.map((p) => [utc(p.date), p.quantity]),
        },
        {
          type: 'line',
          name: t('ai.predictions.chart.forecast'),
          color: forecastColor,
          dashStyle: 'ShortDash',
          zIndex: 2,
          data: data.forecast.map((p) => [utc(p.date), p.p50]),
        },
        {
          type: 'arearange',
          name: t('ai.predictions.chart.range'),
          color: withAlpha(forecastColor, 0.22),
          lineWidth: 0,
          zIndex: 1,
          enableMouseTracking: true,
          data: data.forecast.map((p) => [utc(p.date), p.p10, p.p90]),
        },
      ],
    } as Highcharts.Options;
  });
}
