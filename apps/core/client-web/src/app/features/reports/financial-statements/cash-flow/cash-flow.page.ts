import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, AlertTriangle, Calendar, FileDown, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import { StatementExportService } from '../../../../core/export/statement-export.service';
import {
  CashFlowStatementReport,
  FinancialReportingService,
} from '../../../../core/api/financial-reporting.service';
import { defaultPeriod } from '../report-period';

/**
 * The statement of cash flows.
 *
 * Built by the indirect method on the server: the result of the period, adjusted for the movements
 * that did not touch cash, split into operating, investing and financing. It ties to the change in
 * the cash accounts by construction — the statement is derived from those movements rather than
 * assembled beside them — so `unexplainedDifference` is zero, and a non-zero value would mean the
 * derivation itself is wrong. It is shown for exactly that reason.
 */
@Component({
  selector: 'app-cash-flow-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './cash-flow.page.html',
  styleUrls: ['../balance-sheet/balance-sheet.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashFlowPage {
  private readonly reports = inject(FinancialReportingService);
  private readonly exporter = inject(StatementExportService);

  protected readonly CalendarIcon = Calendar;
  protected readonly ExportIcon = FileDown;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly WarningIcon = AlertTriangle;

  readonly startDate = signal(defaultPeriod().startDate);
  readonly endDate = signal(defaultPeriod().endDate);
  readonly report = signal<CashFlowStatementReport | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.reports.cashFlowStatement(this.startDate(), this.endDate()).subscribe({
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
  /**
   * The statement on screen, as a file.
   *
   * Disabled until there is one, because exporting an empty report produces a file that looks like
   * a company with no balances rather than a report that never loaded.
   */
  exportCsv(): void {
    const data = this.report();
    if (!data) return;
    this.exporter.exportCashFlow(data);
  }
}
