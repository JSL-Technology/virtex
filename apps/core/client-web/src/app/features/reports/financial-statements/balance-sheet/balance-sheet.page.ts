import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, AlertTriangle, Calendar, FileDown, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import { StatementExportService } from '../../../../core/export/statement-export.service';
import {
  BalanceSheetReport,
  FinancialReportingService,
} from '../../../../core/api/financial-reporting.service';

/**
 * The balance sheet.
 *
 * ## What this page was
 *
 * Nine invented account names with invented figures — cash 75,000, receivables 70,000, inventory
 * 30,000 — written into the component as signals, dated "Julio 31, 2025" whatever day it was
 * opened, and wrapped in a `div` whose class was `asdfsdfarsgassadfargpokqrpeot`. It made no
 * request. A tenant looking at it saw someone else's imaginary company and had no way to know.
 *
 * `FinancialReportingService.getBalanceSheet` had computed the real statement on the server the
 * whole time.
 *
 * Nothing is recomputed here. The subtotals, the totals and the balance check are the server's,
 * because a page that adds up its own columns is a second implementation of the ledger and will
 * eventually disagree with it.
 */
@Component({
  selector: 'app-balance-sheet-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './balance-sheet.page.html',
  styleUrls: ['./balance-sheet.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BalanceSheetPage {
  private readonly reports = inject(FinancialReportingService);
  private readonly exporter = inject(StatementExportService);

  protected readonly ExportIcon = FileDown;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly CalendarIcon = Calendar;
  protected readonly WarningIcon = AlertTriangle;

  readonly asOfDate = signal(todayIso());
  readonly report = signal<BalanceSheetReport | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly isEmpty = computed(() => {
    const report = this.report();
    if (!report) return false;
    return (
      report.assets.sections.length === 0 &&
      report.liabilities.sections.length === 0 &&
      report.equity.sections.length === 0
    );
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.reports.balanceSheet(this.asOfDate()).subscribe({
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

  onDateChange(value: string): void {
    if (!value) return;
    this.asOfDate.set(value);
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
    this.exporter.exportBalanceSheet(data);
  }
}

/** Today as `YYYY-MM-DD`, in the reader's own day rather than UTC's. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
