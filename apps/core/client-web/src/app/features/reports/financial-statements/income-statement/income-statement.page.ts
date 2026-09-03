import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Calendar, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import {
  FinancialReportingService,
  IncomeStatementReport,
} from '../../../../core/api/financial-reporting.service';
import { defaultPeriod } from '../report-period';

/**
 * The income statement.
 *
 * There was no page for it. `getIncomeStatement` had been on the server the whole time, computing
 * revenue, cost of sales, gross profit, operating expenses and the net result from posted entries,
 * and the only financial statement the product rendered was a balance sheet made of invented
 * numbers.
 *
 * Gross margin is the one figure derived here, because it is a ratio of two figures the server
 * already sent rather than a re-addition of the ledger.
 */
@Component({
  selector: 'app-income-statement-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './income-statement.page.html',
  styleUrls: ['../balance-sheet/balance-sheet.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncomeStatementPage {
  private readonly reports = inject(FinancialReportingService);

  protected readonly CalendarIcon = Calendar;
  protected readonly RefreshIcon = RefreshCw;

  readonly startDate = signal(defaultPeriod().startDate);
  readonly endDate = signal(defaultPeriod().endDate);
  readonly report = signal<IncomeStatementReport | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  /** Null rather than zero when there is no revenue: a margin on nothing is not 0 %, it is absent. */
  readonly grossMargin = computed(() => {
    const report = this.report();
    if (!report || report.revenue.total === 0) return null;
    return report.grossProfit / report.revenue.total;
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.reports.incomeStatement(this.startDate(), this.endDate()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: () => {
        this.report.set(null);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  onStartDateChange(value: string): void {
    if (!value) return;
    this.startDate.set(value);
    this.load();
  }

  onEndDateChange(value: string): void {
    if (!value) return;
    this.endDate.set(value);
    this.load();
  }
}
