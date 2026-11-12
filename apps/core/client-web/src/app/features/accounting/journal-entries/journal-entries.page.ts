import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, MoreHorizontal, PlusCircle, RotateCw, Undo2 } from 'lucide-angular';
import { RouterLink } from '@angular/router';

import { TranslateModule, FORMAT_PIPES, tenantToday } from '@virteex/shared/ui-i18n';
import {
  JournalEntriesApiService,
  JournalEntry,
  JournalEntryStatus,
} from '../../../core/api/journal-entries.service';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxPagerComponent } from '../../../shared/components/pager';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { TableSort, VX_SORT } from '../../../shared/components/sort';

import { VX_TABLE } from '../../../shared/components/table';
/**
 * The journal.
 *
 * ## What this page used to be
 *
 * Three hardcoded rows (`JE-001 … 'Jul 28, 2025'`), amounts already rounded into the array, and
 * `{{ entry.status }}` printed straight into the badge — so a Spanish screen said "Posted" and a
 * Portuguese one said it too. The endpoint it needed already existed.
 *
 * ## Totals are derived, never stored
 *
 * An entry's debit and credit totals are the sums of its lines. Sending them separately would be
 * a second copy of a number the ledger already holds, and the copy is the one that goes stale.
 * `Number()` guards the decimal columns, which TypeORM hands back as strings.
 */
/** Entries per page. */
const PAGE_SIZE = 50;

@Component({
  selector: 'app-journal-entries-page',
  standalone: true,
  imports: [...VX_TABLE, ...VX_CONTEXT_MENU, ...VX_SORT, RowLinkDirective, CanOpenDirective, CommonModule, LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxPagerComponent],
  templateUrl: './journal-entries.page.html',
  styleUrls: ['./journal-entries.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntriesPage {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly entriesMenu: ListMenuConfig<JournalEntry> = {
    resource: 'journal-entries',
    relationshipMapType: 'JOURNAL_ENTRY',
    row: (ctx) => {
      const entry = ctx.entity as JournalEntry;
      return [
        {
          id: 'corrections',
          items: [
            {
              id: 'reverse',
              label: 'accounting.journal_entries.reverse',
              icon: Undo2,
              danger: true,
              permission: 'journal_entries:create',
              // Only a posted entry a person wrote: one a document posted is voided through it.
              visible: () => entry.status === 'Posted' && !entry.isReversed && !entry.systemReason,
              run: () => this.reverseEntry(entry),
            },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.load() }] },
      ];
    },
  };

  private readonly entriesApi = inject(JournalEntriesApiService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);

  /**
   * Reverse a posted entry from its row (QA R3-B08): the reason is asked for, as the API requires,
   * and the reversal is dated today in the company's calendar. The API had the route and no screen
   * offered it.
   */
  async reverseEntry(entry: JournalEntry): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'accounting.journal_entries.reverse_title',
      message: 'accounting.journal_entries.reverse_message',
      messageParams: { number: entry.entryNumber ?? '' },
      confirmText: 'accounting.journal_entries.reverse',
      variant: 'danger',
      minLength: 3,
      tooShort: 'accounting.journal_entries.reverse_reason_required',
    });
    if (!reason) return;
    this.entriesApi.reverse(entry.id, { reversalDate: tenantToday(), reason: reason.trim() }).subscribe({
      next: (reversal) => {
        this.notifications.showSuccess('accounting.journal_entries.reversed', { number: entry.entryNumber ?? '', reversal: reversal.entryNumber ?? '' });
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'accounting.journal_entries.reverse_failed'),
    });
  }

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  readonly entries = signal<JournalEntry[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly isEmpty = computed(() => !this.loading() && !this.failed() && this.entries().length === 0);

  /** The window the list is showing. The route is bounded now, so the page has to be able to move. */
  readonly page = signal(1);
  readonly total = signal(0);
  readonly hasMore = signal(false);

  /**
   * The server orders the rows (QA B-01): sorting one page would reorder the wrong rows. Debit and
   * credit are sums over the lines, not columns, so they are not offered.
   */
  readonly sort = new TableSort<JournalEntry, 'date' | 'entryNumber' | 'description' | 'status'>();

  constructor() {
    // The first run loads; every later change of order is a new result set, from its first page.
    let initial = true;
    effect(() => {
      this.sort.state();
      untracked(() => {
        if (!initial) this.page.set(1);
        initial = false;
        this.load();
      });
    });
  }

  /** El tamaño de página, ahora elegible por el lector en vez de fijado por una constante. */
  pageSize = PAGE_SIZE;

  goToPage(page: number): void {
    if (page < 1) return;
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.pageSize = size;
    this.page.set(1);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    const { key, direction } = this.sort.state();
    this.entriesApi.list({ page: this.page(), pageSize: this.pageSize, sort: key ?? undefined, direction }).subscribe({
      next: (page) => {
        this.entries.set(page.rows);
        this.total.set(page.total);
        this.hasMore.set(page.hasMore);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  debitTotal(entry: JournalEntry): number {
    return (entry.lines ?? []).reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  }

  creditTotal(entry: JournalEntry): number {
    return (entry.lines ?? []).reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
  }

  /**
   * The stored status becomes a catalogue key.
   *
   * Unknown values fall through to the raw status rather than to an empty cell: a status the
   * client has not been taught about is a deployment mismatch, and showing it is how anybody
   * finds out.
   */
  statusKey(status: JournalEntryStatus): string {
    const keys: Record<string, string> = {
      Draft: 'accounting.journal_entries.status_draft',
      'Pending Approval': 'accounting.journal_entries.status_pending_approval',
      Posted: 'accounting.journal_entries.status_posted',
      Modified: 'accounting.journal_entries.status_modified',
      Void: 'accounting.journal_entries.status_void',
      Rejected: 'accounting.journal_entries.status_rejected',
    };
    return keys[status] ?? status;
  }

  statusTone(status: JournalEntryStatus): VxTone {
    if (status === 'Posted') return 'ok';
    if (status === 'Void' || status === 'Rejected') return 'danger';
    return 'draft';
  }

  /** Un asiento anulado o rechazado ya no cuenta en el mayor, y se tacha. */
  isVoid(status: JournalEntryStatus): boolean {
    return status === 'Void' || status === 'Rejected';
  }
}
