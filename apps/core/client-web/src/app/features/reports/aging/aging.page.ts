import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Calendar, RefreshCw } from 'lucide-angular';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { AgingReport, AgingService } from '../../../core/api/aging.service';
import { toIsoDate } from '../financial-statements/report-period';

export type AgingSide = 'payables' | 'receivables';

/**
 * Ageing of open balances, by counterparty and by how overdue.
 *
 * Neither side of the product had this report. It is what a treasurer opens to decide what to pay
 * next, what a collections clerk works from, and what an auditor asks for to substantiate the
 * receivable and payable balances on the balance sheet.
 *
 * One component serves both sides: the ladder, the arithmetic and the layout are identical, and
 * the only differences are which endpoint to call and whether the column says supplier or customer.
 * Two copies of this would drift.
 */
@Component({
  selector: 'app-aging-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './aging.page.html',
  styleUrls: ['./aging.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgingPage {
  private readonly api = inject(AgingService);

  /**
   * Which side of the ledger, from the route's own data.
   *
   * Read here rather than declared as a routed `input()`: the application does not enable
   * `withComponentInputBinding`, so a required input bound from route data would never be set and
   * the page would throw on its first read. Turning that on globally to serve one component would
   * change how every route in the product receives its parameters.
   */
  readonly side: AgingSide =
    (inject(ActivatedRoute).snapshot.data['side'] as AgingSide | undefined) ?? 'receivables';

  protected readonly CalendarIcon = Calendar;
  protected readonly RefreshIcon = RefreshCw;

  readonly asOfDate = signal(toIsoDate(new Date()));
  readonly report = signal<AgingReport | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly titleKey =
    this.side === 'payables' ? 'REPORTS.AGING.TITULO_CXP' : 'REPORTS.AGING.TITULO_CXC';

  readonly partyKey =
    this.side === 'payables' ? 'REPORTS.AGING.PROVEEDOR' : 'REPORTS.AGING.CLIENTE';

  /**
   * The bucket labels the server sent, as catalogue keys.
   *
   * The labels are `'1-30'`, `'31-60'`, `'61-90'`, `'90+'` — stable identifiers, not sentences —
   * so the reader's language decides how they are spelled.
   */
  readonly bucketKeys = computed(() => {
    const buckets = this.report()?.totals.buckets ?? [];
    return buckets.map((bucket) => ({
      label: bucket.label,
      key: BUCKET_KEYS[bucket.label] ?? bucket.label,
    }));
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    const request =
      this.side === 'payables'
        ? this.api.payables(this.asOfDate())
        : this.api.receivables(this.asOfDate());

    request.subscribe({
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

  bucketAmount(buckets: { label: string; amount: number }[], label: string): number {
    return buckets.find((bucket) => bucket.label === label)?.amount ?? 0;
  }
}

const BUCKET_KEYS: Record<string, string> = {
  '1-30': 'REPORTS.AGING.DIAS_1_30',
  '31-60': 'REPORTS.AGING.DIAS_31_60',
  '61-90': 'REPORTS.AGING.DIAS_61_90',
  '90+': 'REPORTS.AGING.MAS_90',
};
