import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, AlertTriangle, Calendar, FileDown, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import {
  ProfitabilityApiService,
  ProfitabilityReport,
} from '../../../core/api/profitability.service';
import { StatementExportService } from '../../../core/export/statement-export.service';
import { defaultPeriod } from '../financial-statements/report-period';

/**
 * Gross margin by customer.
 *
 * Its sibling page's note applies here word for word: three invented rows, no request, no
 * server-side report to make one to. Both now read the same endpoint, which derives the figures
 * from the invoices that were actually issued.
 */
@Component({
  selector: 'app-profitability-by-customer-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './profitability-by-customer.page.html',
  styleUrls: ['./profitability-by-customer.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfitabilityByCustomerPage {
  private readonly api = inject(ProfitabilityApiService);
  private readonly exporter = inject(StatementExportService);

  protected readonly ExportIcon = FileDown;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly CalendarIcon = Calendar;
  protected readonly WarningIcon = AlertTriangle;

  readonly startDate = signal(defaultPeriod().startDate);
  readonly endDate = signal(defaultPeriod().endDate);
  readonly report = signal<ProfitabilityReport | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly isEmpty = computed(() => (this.report()?.rows.length ?? 0) === 0);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .byCustomer({ startDate: this.startDate(), endDate: this.endDate() })
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
        },
        error: () => {
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

  /** The report on screen, as a file. Disabled until there is one. */
  exportCsv(): void {
    const data = this.report();
    if (!data) return;
    this.exporter.exportProfitability(data, 'customer');
  }
}
