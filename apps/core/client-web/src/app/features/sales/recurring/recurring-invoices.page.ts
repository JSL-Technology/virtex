import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { RecurringInvoice, RecurringInvoicesService, RecurringStatus } from './recurring-invoices.service';

const TONE: Record<RecurringStatus, VxTone> = { ACTIVE: 'ok', PAUSED: 'warning', ENDED: 'neutral' };

type Action = 'pause' | 'resume' | 'end' | 'run';

/** Each action's words, spelled out so every key is visible to the catalogue checks. */
const ACTION_KEYS: Record<Action, { done: string; confirm?: { title: string; message: string; button: string } }> = {
  pause: { done: 'invoices.recurring_ui.pause_done' },
  resume: { done: 'invoices.recurring_ui.resume_done' },
  end: {
    done: 'invoices.recurring_ui.end_done',
    confirm: { title: 'invoices.recurring_ui.end_title', message: 'invoices.recurring_ui.end_message', button: 'invoices.recurring_ui.end' },
  },
  run: {
    done: 'invoices.recurring_ui.run_done',
    confirm: { title: 'invoices.recurring_ui.run_title', message: 'invoices.recurring_ui.run_message', button: 'invoices.recurring_ui.run' },
  },
};

/**
 * Recurring invoices: what is billed on a schedule, when it is next due, and whether the last
 * issue failed (no e-NCF range left, a customer without a tax id) — the failure is shown here, and
 * retried every day until it is fixed.
 */
@Component({
  selector: 'app-recurring-invoices-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './recurring-invoices.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurringInvoicesPage implements OnInit {
  private readonly recurring = inject(RecurringInvoicesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);

  protected readonly PlusCircleIcon = PlusCircle;
  readonly tone = TONE;
  readonly rows = signal<RecurringInvoice[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);
  readonly canEdit = computed(() => this.auth.hasPermissions(['invoices:create']));

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.recurring.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'invoices.recurring_ui.load_failed'));
      },
    });
  }

  async act(row: RecurringInvoice, action: Action): Promise<void> {
    const keys = ACTION_KEYS[action];
    if (keys.confirm) {
      const ok = await this.dialog.confirm({
        title: keys.confirm.title,
        message: keys.confirm.message,
        messageParams: { name: row.name },
        confirmText: keys.confirm.button,
      });
      if (!ok) return;
    }
    this.busy.set(row.id);
    this.recurring.action(row.id, action).subscribe({
      next: () => {
        this.busy.set(null);
        this.notifications.showSuccess(keys.done);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.notifications.showHttpError(error, 'invoices.recurring_ui.action_failed');
      },
    });
  }
}
