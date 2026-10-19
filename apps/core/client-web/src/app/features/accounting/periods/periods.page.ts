import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, Lock, Unlock, RefreshCw } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES, FormatService } from '@virteex/shared/ui-i18n';
import {
  AccountingPeriod,
  AccountingPeriodsService,
} from '../../../core/api/accounting-periods.service';
import { NotificationService } from '../../../core/services/notification';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VX_SORT, sortable } from '../../../shared/components/sort';

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
  imports: [...VX_SORT, CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './periods.page.html',
  styleUrls: ['./periods.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeriodsPage {
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.periods(), { status: (period) => this.translate.instant(this.statusKey(period.status, period)) });
  private readonly dialog = inject(DialogService);
  private readonly periodsApi = inject(AccountingPeriodsService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;
  protected readonly RefreshIcon = RefreshCw;

  readonly periods = signal<AccountingPeriod[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  /** The period whose command is in flight, so only its own button shows the busy state. */
  readonly pending = signal<string | null>(null);

  readonly isEmpty = computed(() => !this.loading() && !this.failed() && this.periods().length === 0);

  /** Today as `YYYY-MM-DD`, the form period dates are stored in, so they compare as strings. */
  private readonly today = localIsoDate(new Date());

  /**
   * The one period that can be closed now: the earliest open one that has already ended.
   *
   * Every open row used to carry the same «Cerrar período» button (QA M-13), twelve of them, which
   * invited closing December before October — the server refuses it, but only after the click.
   * Periods close in order, so the screen offers exactly the one that is next.
   */
  readonly nextClosableId = computed<string | null>(() => {
    const next = [...this.periods()]
      .filter((p) => p.status === 'OPEN' && p.endDate < this.today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    return next?.id ?? null;
  });

  /** The period that has to be closed before this one, for the hint on its row. */
  readonly nextClosable = computed(() => this.periods().find((p) => p.id === this.nextClosableId()) ?? null);

  /** Where an open period stands in time: ended, current or still to come. */
  phase(period: AccountingPeriod): 'ended' | 'current' | 'future' {
    if (period.endDate < this.today) return 'ended';
    if (period.startDate > this.today) return 'future';
    return 'current';
  }

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

  statusKey(status: AccountingPeriod['status'], period?: AccountingPeriod): string {
    if (status !== 'OPEN') return 'accounting.periods.status_closed';
    if (period && this.phase(period) === 'current') return 'accounting.periods.status_current';
    if (period && this.phase(period) === 'future') return 'accounting.periods.status_future';
    return 'accounting.periods.status_open';
  }

  /** The month as the reader's locale spells it — not the stored Spanish name. */
  label(period: AccountingPeriod): string {
    return this.format.date(period.startDate, 'monthYear', { dateOnly: true });
  }

  /**
   * Abierto admite asientos; cerrado no. Esa es la diferencia que el color tiene que comunicar.
   *
   * `danger` y no `neutral` para el cerrado a propósito: no es un estado inerte, es el que hace
   * que registrar algo en ese período sea imposible.
   */
  statusTone(status: AccountingPeriod['status'], period?: AccountingPeriod): VxTone {
    if (status !== 'OPEN') return 'danger';
    return period && this.phase(period) === 'future' ? 'neutral' : 'ok';
  }

  /**
   * Closing asks first, and says why it failed when it does.
   *
   * It did neither (QA C-06): one click closed a filed month with no confirmation — an action
   * that stops every module posting into that period — and a refusal (an earlier period still
   * open, a pre-closing task that could not run) left the button spinning back to its idle state
   * with nothing on screen.
   */
  async close(period: AccountingPeriod): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'accounting.periods.close_confirm_title',
      message: 'accounting.periods.close_confirm_message',
      messageParams: { period: this.label(period) },
      confirmText: 'accounting.periods.close_confirm_action',
      variant: 'warning',
    });
    if (!confirmed) return;

    this.pending.set(period.id);
    this.periodsApi.close(period.id).subscribe({
      next: (result) => this.applyCommand(result.period, result.message),
      error: (err) => {
        this.pending.set(null);
        this.notifications.showHttpError(err, 'accounting.periods.close_failed', { period: this.label(period) });
      },
    });
  }

  /**
   * Reopening asks for the justification the server requires.
   *
   * This used `window.prompt`, whose chrome is in the reader's language but whose question was
   * not, and which several browsers refuse to show at all — in which case it returns null and the
   * reopening silently never happens. The product's own dialog asks, and enforces the ten
   * characters the server demands before the request is sent rather than after.
   */
  async reopen(period: AccountingPeriod): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'dialog.reopen_period.title',
      message: 'accounting.periods.reopen_reason_prompt',
      placeholder: 'dialog.reopen_period.reason_reopening',
      minLength: 10,
      tooShort: 'accounting.periods.reason_too_short',
      variant: 'warning',
    });
    if (!reason) return;

    this.pending.set(period.id);
    this.periodsApi.reopen(period.id, reason).subscribe({
      next: (result) => this.applyCommand(result.period, result.message),
      error: (err) => {
        this.pending.set(null);
        this.notifications.showHttpError(err, 'accounting.periods.reopen_failed', { period: this.label(period) });
      },
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

function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
