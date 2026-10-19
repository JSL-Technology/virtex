import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HighchartsChartComponent } from 'highcharts-angular';
import type * as Highcharts from 'highcharts';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, Pin, PinOff } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { baseChartOptions, categoricalPalette } from '../../../core/utils/chart-theme';
import { CopilotChart } from './copilot-api.service';

/**
 * A chart the copilot drew — in the panel, and on the dashboard once pinned.
 *
 * The figures are the server's, read from the tool that holds them; this only draws them, with the
 * same numbers in a table underneath for anyone who cannot or does not want to read the plot.
 */
@Component({
  selector: 'app-copilot-chart',
  standalone: true,
  imports: [HighchartsChartComponent, TranslatePipe, LucideAngularModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="cc" [attr.aria-label]="chart().title">
      <figcaption class="cc__header">
        <span class="cc__title">{{ chart().title }}</span>
        @if (pinnable()) {
          <button
            type="button"
            class="cc__pin"
            [disabled]="busy()"
            [attr.aria-pressed]="chart().pinned"
            [title]="(chart().pinned ? 'ai.copilot.chart.unpin' : 'ai.copilot.chart.pin') | translate"
            (click)="togglePin.emit(chart())"
          >
            <lucide-icon [img]="chart().pinned ? UnpinIcon : PinIcon" [size]="14" aria-hidden="true" />
            <span>{{ (chart().pinned ? 'ai.copilot.chart.unpin' : 'ai.copilot.chart.pin') | translate }}</span>
          </button>
        }
      </figcaption>
      @if (chart().data; as data) {
        <highcharts-chart class="cc__plot" [style.height.px]="height()" [options]="options()" />
        <p class="cc__meta">
          {{ 'ai.copilot.chart.drawn_at' | translate: { date: (data.drawnAt | vxDate: 'short') } }}
          @if (data.omitted > 0) {
            · {{ 'ai.copilot.chart.omitted' | translate: { count: data.omitted } }}
          }
        </p>
        <details class="cc__table">
          <summary>{{ 'ai.copilot.chart.show_table' | translate }}</summary>
          <table class="data-table">
            <thead>
              <tr>
                <th></th>
                @for (series of data.series; track series.name) {
                  <th class="numeric">{{ series.name }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (category of data.categories; track $index; let i = $index) {
                <tr>
                  <td>{{ category }}</td>
                  @for (series of data.series; track series.name) {
                    <td class="numeric">{{ series.values[i] | vxNumber: '1.0-2' }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </details>
      } @else {
        <p class="cc__unavailable" role="status">{{ k('ai.copilot.chart.unavailable', chart().unavailable ?? 'failed') | translate }}</p>
      }
    </figure>
  `,
  styles: [
    `
      :host { display: block; }
      .cc { margin: 0; }
      .cc__header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-1); }
      .cc__title { font-weight: var(--font-semibold); font-size: var(--text-sm); color: var(--text-primary); }
      .cc__pin {
        display: inline-flex; align-items: center; gap: var(--space-1);
        border: 1px solid var(--border-default); border-radius: var(--radius-md); background: transparent;
        color: var(--text-secondary); font-size: var(--text-xs); padding: var(--space-1) var(--space-2); cursor: pointer;
      }
      .cc__pin[aria-pressed='true'] { color: var(--accent-text); border-color: var(--accent-solid); }
      .cc__pin:disabled { opacity: 0.6; cursor: progress; }
      .cc__plot { display: block; width: 100%; }
      .cc__meta, .cc__unavailable { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--text-secondary); }
      .cc__table { margin-top: var(--space-1); font-size: var(--text-sm); }
      .cc__table summary { cursor: pointer; color: var(--accent-text); font-size: var(--text-xs); }
    `,
  ],
})
export class CopilotChartComponent {
  readonly chart = input.required<CopilotChart>();
  /** Whether the pin button is offered (the panel offers it; so does the dashboard, to unpin). */
  readonly pinnable = input(true);
  readonly busy = input(false);
  readonly height = input(220);
  readonly togglePin = output<CopilotChart>();

  protected readonly PinIcon = Pin;
  protected readonly UnpinIcon = PinOff;
  protected readonly k = composeKey;

  readonly options = computed<Highcharts.Options>(() => {
    const chart = this.chart();
    const data = chart.data;
    const base = baseChartOptions();
    const palette = categoricalPalette();
    if (!data) return base;
    const unit = data.unit ? ` ${data.unit}` : '';
    const cartesian = chart.type !== 'pie';
    return {
      ...base,
      chart: { ...base.chart, type: chart.type, height: this.height() },
      legend: { ...base.legend, enabled: data.series.length > 1 || !cartesian },
      xAxis: cartesian ? { ...(base.xAxis as Highcharts.XAxisOptions), categories: data.categories, crosshair: true } : undefined,
      yAxis: cartesian ? { ...(base.yAxis as Highcharts.YAxisOptions), title: { text: data.unit ?? undefined } } : undefined,
      tooltip: { ...base.tooltip, shared: cartesian, valueSuffix: unit, valueDecimals: 2 },
      plotOptions: { series: { animation: false, marker: { enabled: data.categories.length <= 12, radius: 3 } } },
      series: cartesian
        ? data.series.map((series, index) => ({
            type: chart.type,
            name: series.name,
            color: palette[index % Math.max(palette.length, 1)],
            data: series.values,
          }))
        : [
            {
              type: 'pie',
              name: data.series[0]?.name ?? chart.title,
              data: data.categories.map((category, index) => ({
                name: category,
                y: data.series[0]?.values[index] ?? 0,
                color: palette[index % Math.max(palette.length, 1)],
              })),
            },
          ],
    } as Highcharts.Options;
  });
}
