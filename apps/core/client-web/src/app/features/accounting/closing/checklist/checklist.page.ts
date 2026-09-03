import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, AlertCircle, CheckCircle, Circle, RefreshCw } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
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

  protected readonly CompletedIcon = CheckCircle;
  protected readonly PendingIcon = Circle;
  protected readonly ErrorIcon = AlertCircle;
  protected readonly RefreshIcon = RefreshCw;

  readonly periods = signal<AccountingPeriod[]>([]);
  readonly selectedPeriodId = signal<string | null>(null);
  readonly items = signal<ClosingChecklistItem[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);

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

  iconFor(item: ClosingChecklistItem) {
    if (item.isCompleted) return this.CompletedIcon;
    return item.noteKey ? this.PendingIcon : this.ErrorIcon;
  }

  statusClass(item: ClosingChecklistItem): string {
    if (item.isCompleted) return 'completed';
    return item.noteKey ? 'pending' : 'error';
  }
}
