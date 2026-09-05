import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, AlertTriangle, Calendar, CheckCircle2, FileDown, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import { StatementExportService } from '../../../../core/export/statement-export.service';
import {
  FinancialReportingService,
  TrialBalanceReport,
} from '../../../../core/api/financial-reporting.service';
import { defaultPeriod } from '../report-period';

/**
 * The balanza de comprobación.
 *
 * The report an accountant opens before any other: opening balance, movement and closing balance
 * for every account that moved, with six columns that must agree in pairs. `getTrialBalance` was
 * written on the server, exposed by no route, and rendered by no page — so the product could
 * produce a balance sheet but not the working paper that proves it.
 *
 * The totals row and the agreement check come from the server. A page that summed its own columns
 * would agree with itself and prove nothing.
 */
@Component({
  selector: 'app-trial-balance-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './trial-balance.page.html',
  styleUrls: ['./trial-balance.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialBalancePage {
  private readonly reports = inject(FinancialReportingService);
  private readonly exporter = inject(StatementExportService);

  protected readonly CalendarIcon = Calendar;
  protected readonly ExportIcon = FileDown;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly WarningIcon = AlertTriangle;
  protected readonly OkIcon = CheckCircle2;

  readonly startDate = signal(defaultPeriod().startDate);
  readonly endDate = signal(defaultPeriod().endDate);
  readonly report = signal<TrialBalanceReport | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.reports.trialBalance(this.startDate(), this.endDate()).subscribe({
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
    this.exporter.exportTrialBalance(data);
  }
}
