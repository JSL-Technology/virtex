
import { Component, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartComponent } from 'highcharts-angular';
import * as Highcharts from 'highcharts';

@Component({
  selector: 'app-datasheet-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartComponent],
  template: `
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg p-2 overflow-hidden">
      <highcharts-chart
        [options]="chartOptions"
        style="width: 100%; height: 300px; display: block;"
      ></highcharts-chart>
    </div>
  `
})
export class DatasheetChartComponent implements OnInit {
  Highcharts: typeof Highcharts = Highcharts;

  @Input() options: Highcharts.Options = {};

  chartOptions: Highcharts.Options = {
    title: { text: 'Gráfico de DataSheets' },
    series: [{
      type: 'line',
      data: [1, 2, 3, 4, 5]
    }]
  };

  ngOnInit(): void {
    if (this.options) {
      this.chartOptions = { ...this.chartOptions, ...this.options };
    }
  }
}
