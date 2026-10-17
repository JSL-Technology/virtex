import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HighchartsChartComponent } from 'highcharts-angular';
import type * as Highcharts from 'highcharts';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { baseChartOptions, categoricalPalette, token } from '../../../core/utils/chart-theme';
import { CashflowDay } from './cashflow.service';

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * The projected balance: the median path as a line, the P10–P90 range as a band, the threshold as
 * a line across — and, when a scenario is shown, its median dashed beside the projection's. The
 * table under it carries the same numbers week by week.
 */
@Component({
  selector: 'app-cashflow-chart',
  standalone: true,
  imports: [HighchartsChartComponent, TranslateModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <highcharts-chart class="cf-chart" [options]="options()" />
    <details class="cf-table">
      <summary>{{ 'ai.cashflow.chart.show_table' | translate }}</summary>
      <table class="data-table">
        <thead>
          <tr>
            <th>{{ 'ai.cashflow.chart.date' | translate }}</th>
            <th class="numeric">{{ 'ai.cashflow.chart.p10' | translate }}</th>
            <th class="numeric">{{ 'ai.cashflow.chart.p50' | translate }}</th>
            <th class="numeric">{{ 'ai.cashflow.chart.p90' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of weekly(); track row.day) {
            <tr>
              <td>{{ row.day | vxDate }}</td>
              <td class="numeric">{{ row.p10 | vxMoney: currency() }}</td>
              <td class="numeric">{{ row.p50 | vxMoney: currency() }}</td>
              <td class="numeric">{{ row.p90 | vxMoney: currency() }}</td>
            </tr>
          }
        </tbody>
      </table>
    </details>
  `,
  styles: [
    `
      :host { display: block; }
      .cf-chart { display: block; width: 100%; height: 320px; }
      .cf-table { margin-top: var(--space-2); font-size: var(--text-sm); }
      .cf-table summary { cursor: pointer; color: var(--accent-text); }
    `,
  ],
})
export class CashflowChartComponent {
  private readonly i18n = inject(TranslateService);
  readonly days = input.required<CashflowDay[]>();
  readonly compare = input<CashflowDay[] | null>(null);
  readonly threshold = input(0);
  readonly currency = input<string | null>(null);

  readonly weekly = computed(() => this.days().filter((_, index, all) => index % 7 === 0 || index === all.length - 1));

  readonly options = computed<Highcharts.Options>(() => {
    const palette = categoricalPalette();
    const projection = palette[1] || token('--accent-solid');
    const scenario = palette[2] || token('--content-secondary');
    const base = baseChartOptions();
    const t = (key: string) => this.i18n.instant(key);
    const series: Highcharts.SeriesOptionsType[] = [
      {
        type: 'arearange',
        name: t('ai.cashflow.chart.range'),
        color: withAlpha(projection, 0.22),
        lineWidth: 0,
        zIndex: 1,
        data: this.days().map((d) => [utc(d.day), d.p10, d.p90]),
      },
      {
        type: 'line',
        name: t('ai.cashflow.chart.expected'),
        color: projection,
        zIndex: 2,
        data: this.days().map((d) => [utc(d.day), d.p50]),
      },
    ];
    const compare = this.compare();
    if (compare?.length) {
      series.push({
        type: 'line',
        name: t('ai.cashflow.chart.scenario'),
        color: scenario,
        dashStyle: 'ShortDash',
        zIndex: 3,
        data: compare.map((d) => [utc(d.day), d.p50]),
      });
    }
    return {
      ...base,
      chart: { ...base.chart, type: 'line', height: 320, zooming: { type: 'x' } },
      legend: { ...base.legend, enabled: true },
      xAxis: { ...(base.xAxis as Highcharts.XAxisOptions), type: 'datetime', crosshair: true },
      yAxis: {
        ...(base.yAxis as Highcharts.YAxisOptions),
        title: { text: this.currency() ?? '' },
        plotLines: [{ value: this.threshold(), color: token('--error-text'), width: 1, dashStyle: 'Dash', zIndex: 4 }],
      },
      tooltip: { ...base.tooltip, shared: true, valueDecimals: 0, xDateFormat: '%e %b %Y' },
      plotOptions: { series: { marker: { enabled: false, radius: 4 }, lineWidth: 2, animation: false } },
      series,
    } as Highcharts.Options;
  });
}
