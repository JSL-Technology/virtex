import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Lock, Unlock, RefreshCw } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import {
  AccountingPeriod,
  AccountingPeriodsService,
} from '../../../core/api/accounting-periods.service';
import { NotificationService } from '../../../core/services/notification';

/**
 * The tenant's accounting calendar.
 *
 * ## What this page used to be
 *
 * A frozen array of twelve English month names for the year 2025 (`{ month: 'January', year:
 * 2025, startDate: 'Jan 1, 2025', … }`), a `status` of `'Open' | 'Closed' | 'Future'` rendered
 * raw into the badge, and a `togglePeriodStatus` that wrote to the signal and called
 * `console.log`. Closing a period is the control that stops anyone posting into a filed month; a
 * button that only changes a colour is worse than no button.
 *
 * ## Why the label is derived from the dates
 *
 * `name` is free text the tenant typed, so it is in the tenant's language — "Julio 2025" reads
 * as noise to a reader working in Portuguese. The period's identity is its date range, and every
 * locale can spell a date range for itself, so the heading is `startDate` formatted with
 * `monthYear` and the stored name follows as a secondary label when it says something different.
 *
 * `dateOnly` on every date here is not cosmetic: `start_date` and `end_date` are `date` columns,
 * with no time and no zone. Treating them as instants renders 1 July as 30 June for any reader
 * west of UTC, which on a period boundary is the difference between an open month and a closed one.
 */
@Component({
  selector: 'app-periods-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './periods.page.html',
  styleUrls: ['./periods.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeriodsPage {
  private readonly periodsApi = inject(AccountingPeriodsService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;
  protected readonly RefreshIcon = RefreshCw;

  readonly periods = signal<AccountingPeriod[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  /** The period whose command is in flight, so only its own button shows the busy state. */
  readonly pending = signal<string | null>(null);

  readonly isEmpty = computed(() => !this.loading() && !this.failed() && this.periods().length === 0);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.periodsApi.list().subscribe({
      next: (periods) => {
        this.periods.set(periods);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  statusKey(status: AccountingPeriod['status']): string {
    return status === 'OPEN' ? 'ACCOUNTING.PERIODS.STATUS_OPEN' : 'ACCOUNTING.PERIODS.STATUS_CLOSED';
  }

  statusClass(status: AccountingPeriod['status']): string {
    return status === 'OPEN' ? 'status-open' : 'status-closed';
  }

  close(period: AccountingPeriod): void {
    this.pending.set(period.id);
    this.periodsApi.close(period.id).subscribe({
      next: (result) => this.applyCommand(result.period, result.message),
      error: () => this.pending.set(null),
    });
  }

  /**
   * Reopening asks for the justification the server requires.
   *
   * `prompt` is the browser's own dialog and therefore already in the reader's language, chrome
   * and all; its question is not. It is translated here rather than in the template because a
   * pipe cannot run inside an event binding, and passing a raw key would put
   * `ACCOUNTING.PERIODS.REOPEN_REASON_PROMPT` in front of the reader.
   */
  reopen(period: AccountingPeriod): void {
    const question = this.translate.instant('ACCOUNTING.PERIODS.REOPEN_REASON_PROMPT');
    const reason = window.prompt(question)?.trim();
    if (!reason) return;
    if (reason.length < 10) {
      this.notifications.showError('ACCOUNTING.PERIODS.REASON_TOO_SHORT');
      return;
    }

    this.pending.set(period.id);
    this.periodsApi.reopen(period.id, reason).subscribe({
      next: (result) => this.applyCommand(result.period, result.message),
      error: () => this.pending.set(null),
    });
  }

  /**
   * The server's answer replaces the row, rather than the client guessing the new state.
   *
   * Closing a period can also close its modules, and reopening one writes a reopening journal
   * entry — outcomes the client cannot derive. `message` arrives already translated by the
   * response interceptor, so it is shown as-is.
   */
  private applyCommand(period: AccountingPeriod, message: string): void {
    this.periods.update((rows) => rows.map((row) => (row.id === period.id ? period : row)));
    this.pending.set(null);
    this.notifications.showSuccess(message);
  }
}
