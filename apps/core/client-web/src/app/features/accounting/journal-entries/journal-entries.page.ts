import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import {
  JournalEntriesApiService,
  JournalEntry,
  JournalEntryStatus,
} from '../../../core/api/journal-entries.service';

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
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './journal-entries.page.html',
  styleUrls: ['./journal-entries.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntriesPage {
  private readonly entriesApi = inject(JournalEntriesApiService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  readonly entries = signal<JournalEntry[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly isEmpty = computed(() => !this.loading() && !this.failed() && this.entries().length === 0);

  /** The window the list is showing. The route is bounded now, so the page has to be able to move. */
  readonly page = signal(1);
  readonly total = signal(0);
  readonly hasMore = signal(false);

  constructor() {
    this.load();
  }

  nextPage(): void {
    if (!this.hasMore()) return;
    this.page.update((current) => current + 1);
    this.load();
  }

  previousPage(): void {
    if (this.page() <= 1) return;
    this.page.update((current) => current - 1);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.entriesApi.list({ page: this.page(), pageSize: PAGE_SIZE }).subscribe({
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
      Draft: 'ACCOUNTING.JOURNAL_ENTRIES.STATUS_DRAFT',
      'Pending Approval': 'ACCOUNTING.JOURNAL_ENTRIES.STATUS_PENDING_APPROVAL',
      Posted: 'ACCOUNTING.JOURNAL_ENTRIES.STATUS_POSTED',
      Modified: 'ACCOUNTING.JOURNAL_ENTRIES.STATUS_MODIFIED',
      Void: 'ACCOUNTING.JOURNAL_ENTRIES.STATUS_VOID',
      Rejected: 'ACCOUNTING.JOURNAL_ENTRIES.STATUS_REJECTED',
    };
    return keys[status] ?? status;
  }

  statusClass(status: JournalEntryStatus): string {
    if (status === 'Posted') return 'status-posted';
    if (status === 'Void' || status === 'Rejected') return 'status-void';
    return 'status-draft';
  }
}
