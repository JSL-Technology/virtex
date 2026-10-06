import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, AlertCircle, CheckCircle, Circle, Lock, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import {
  AccountingPeriod,
  AccountingPeriodsService,
  ClosingChecklistItem,
} from '../../../../core/api/accounting-periods.service';

/**
 * The closing checklist, for whichever period the reader chooses.
 *
 * ## What this page was
 *
 * Three invented checklist "templates" — "Checklist de Cierre Mensual Estándar", 15 tasks, assigned
 * to "Carlos López" — held in a signal, with a "New checklist" button that did nothing and a
 * filter button that did nothing. There was no such thing as a checklist template anywhere in the
 * product, no task assignment, and no people by those names.
 *
 * What does exist is `ClosingChecklistService`, which computes the real checks from the tenant's
 * own tables: unposted journal entries, unapproved supplier invoices, unmatched bank movements,
 * pending approvals, revaluation still to run. `month-end-close` shows them for the earliest open
 * period, because that is the one being closed. This page is the same checks for any period the
 * reader picks — which is what an accountant wants when a later month is already being prepared,
 * or when checking what a closed period looked like.
 */
@Component({
  selector: 'app-checklist-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './checklist.page.html',
  styleUrls: ['./checklist.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChecklistPage {
  private readonly periodsApi = inject(AccountingPeriodsService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);

  protected readonly CompletedIcon = CheckCircle;
  protected readonly CloseIcon = Lock;
  protected readonly PendingIcon = Circle;
  protected readonly ErrorIcon = AlertCircle;
  protected readonly RefreshIcon = RefreshCw;

  readonly periods = signal<AccountingPeriod[]>([]);
  readonly selectedPeriodId = signal<string | null>(null);
  readonly items = signal<ClosingChecklistItem[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly closing = signal(false);

  /** The server decides; this only keeps the button away from a role that would be refused. */
  readonly canClose = computed(() => this.auth.hasPermissions(['accounting:close_period']));

  readonly selectedPeriod = computed(
    () => this.periods().find((period) => period.id === this.selectedPeriodId()) ?? null,
  );

  readonly isEmpty = computed(
    () => !this.loading() && !this.failed() && this.items().length === 0,
  );

  /** Whole percentage points, so a bar and a figure beside it never disagree by rounding. */
  readonly progress = computed(() => {
    const items = this.items();
    if (items.length === 0) return 0;
    return Math.round((items.filter((item) => item.isCompleted).length / items.length) * 100);
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.periodsApi.list().subscribe({
      next: (periods) => {
        this.periods.set(periods);
        // The earliest open period is the one being closed; fall back to the most recent when
        // every period is already closed, so the page still has something to show.
        const target =
          periods.find((period) => period.status === 'OPEN') ?? periods[periods.length - 1];
        if (!target) {
          this.items.set([]);
          this.loading.set(false);
          return;
        }
        this.selectPeriod(target.id);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  selectPeriod(periodId: string): void {
    this.selectedPeriodId.set(periodId);
    this.loading.set(true);
    this.failed.set(false);

    this.periodsApi.closingChecklist(periodId).subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  /**
   * Whether the selected period can be closed from here.
   *
   * Only the earliest open period: closing runs oldest first and the server refuses anything
   * else. Every check must be complete — this page exists to say what stands in the way, so
   * offering the close while something does would contradict it.
   */
  readonly closable = computed(() => {
    const period = this.selectedPeriod();
    if (!period || period.status !== 'OPEN') return false;
    const earliestOpen = this.periods().find((candidate) => candidate.status === 'OPEN');
    if (earliestOpen?.id !== period.id) return false;
    return !this.loading() && !this.failed() && this.items().every((item) => item.isCompleted);
  });

  async closePeriod(): Promise<void> {
    const period = this.selectedPeriod();
    if (!period || !this.closable()) return;
    const confirmed = await this.dialog.confirm({
      title: 'accounting.periods.close_confirm_title',
      message: 'accounting.periods.close_confirm_message',
      messageParams: { period: period.name },
      confirmText: 'accounting.periods.close_confirm_action',
      variant: 'warning',
    });
    if (!confirmed) return;

    this.closing.set(true);
    this.periodsApi.close(period.id).subscribe({
      next: () => {
        this.closing.set(false);
        this.load();
      },
      error: (err) => {
        this.closing.set(false);
        this.notifications.showHttpError(err, 'accounting.periods.close_failed', { period: period.name });
      },
    });
  }

  iconFor(item: ClosingChecklistItem) {
    if (item.isCompleted) return this.CompletedIcon;
    return item.noteKey ? this.PendingIcon : this.ErrorIcon;
  }

  statusClass(item: ClosingChecklistItem): string {
    if (item.isCompleted) return 'completed';
    return item.noteKey ? 'pending' : 'error';
  }
}
