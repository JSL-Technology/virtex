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
 * Gross margin by product.
 *
 * ## What this page was
 *
 * Three invented rows written into the component as a signal — a `Laptop Pro 15"` that sold 120
 * units for 191,998.80, an ergonomic wireless mouse, an ultrawide monitor. No request, no service,
 * no server-side report to request. A tenant opening this screen saw an imaginary company's
 * figures presented as its own, with nothing on the page to say so, and margin is the number a
 * business acts on.
 *
 * Nothing is computed here. The revenue, the cost, the margin and the totals are the server's,
 * because a page that adds up its own columns is a second implementation of the ledger.
 */
@Component({
  selector: 'app-profitability-by-product-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './profitability-by-product.page.html',
  styleUrls: ['./profitability-by-product.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfitabilityByProductPage {
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
      .byProduct({ startDate: this.startDate(), endDate: this.endDate() })
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
    this.exporter.exportProfitability(data, 'product');
  }
}
