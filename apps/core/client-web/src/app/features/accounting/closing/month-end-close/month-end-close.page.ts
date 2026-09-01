import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, CheckCircle, Circle, AlertCircle } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../../core/i18n/pipes/format.pipes';
import {
  AccountingPeriod,
  AccountingPeriodsService,
  ClosingChecklistItem,
} from '../../../../core/api/accounting-periods.service';

/**
 * What still stands between the tenant and closing the open period.
 *
 * ## What this page used to be
 *
 * Seven hardcoded task names in English — "Close Accounts Payable Subledger", "Bank
 * Reconciliation" — with invented owners ("Ana Pérez", "Carlos López"), a heading that said
 * "Month-End Closing Process - July 2025" whatever month it was, and a progress bar fixed at
 * `width: 30%`. None of it came from the tenant's data.
 *
 * Meanwhile `ClosingChecklistService` on the server already computed the real checks — unposted
 * journal entries, unapproved vendor bills, unreconciled bank lines, pending approvals — from
 * that tenant's own tables, and had no controller, so nothing could reach it. It has one now.
 *
 * The period shown is the tenant's open one, and its name is derived from its dates so it reads
 * correctly in whatever language the reader is using.
 */
@Component({
  selector: 'app-month-end-close-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './month-end-close.page.html',
  styleUrls: ['./month-end-close.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonthEndClosePage {
  private readonly periodsApi = inject(AccountingPeriodsService);

  protected readonly CompletedIcon = CheckCircle;
  protected readonly PendingIcon = Circle;
  protected readonly ErrorIcon = AlertCircle;

  readonly period = signal<AccountingPeriod | null>(null);
  readonly items = signal<ClosingChecklistItem[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly isEmpty = computed(() => !this.loading() && !this.failed() && this.items().length === 0);

  /** Whole percentage points, so the bar and any figure beside it never disagree by rounding. */
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
        // The earliest open period is the one being closed: closing runs oldest first, and a later
        // open month is not closable while an earlier one is still open.
        const open = periods.find((candidate) => candidate.status === 'OPEN') ?? null;
        this.period.set(open);
        if (!open) {
          this.items.set([]);
          this.loading.set(false);
          return;
        }
        this.periodsApi.closingChecklist(open.id).subscribe({
          next: (items) => {
            this.items.set(items);
            this.loading.set(false);
          },
          error: () => {
            this.failed.set(true);
            this.loading.set(false);
          },
        });
      },
      error: () => {
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
