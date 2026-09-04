import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, Calendar } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { JournalEntriesApiService, JournalEntry } from '../../../core/api/journal-entries.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { accountNameOf } from '../../../core/i18n/localized-name';

/**
 * The journal, entry by entry, with every line shown.
 *
 * ## What this page used to be
 *
 * Two hardcoded entries dated "Jul 28, 2025" against accounts named in English ("Accounts
 * Receivable - Local", "Sales Revenue - Products"), and a period button that said "Jul 2025"
 * whatever the date. The endpoint it needed is the one the journal-entries list already uses:
 * `GET /journal-entries` returns each entry with its lines eagerly loaded.
 *
 * ## Why the account name is resolved here
 *
 * A line carries `accountId`, not a name. The chart of accounts is fetched once and indexed, so
 * the grid renders `1200-01 — Cuentas por cobrar` without a request per row, and the name is the
 * tenant's own — the one they typed into their chart, in the language of their books.
 */
/** Entries per page. The daybook is read a day at a time; fifty rows covers a busy day. */
const PAGE_SIZE = 50;

@Component({
  selector: 'app-daily-journal-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './daily-journal.page.html',
  styleUrls: ['./daily-journal.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailyJournalPage {
  private readonly entriesApi = inject(JournalEntriesApiService);
  private readonly accountsApi = inject(ChartOfAccountsApiService);

  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;

  readonly journalEntries = signal<JournalEntry[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);

  /** `accountId` → `code — name`, so a line renders without another request. */
  private readonly accountLabels = signal<Map<string, string>>(new Map());

  readonly isEmpty = computed(
    () => !this.loading() && !this.failed() && this.journalEntries().length === 0,
  );

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

    this.accountsApi.getAccounts().subscribe({
      next: (accounts) => {
        this.accountLabels.set(
          // `accountNameOf`, not `account.name`. The server sends the name as a translation map,
          // so interpolating it directly rendered `1101 — [object Object]`.
          new Map(
            accounts.map((account) => [
              account.id,
              `${account.code} — ${accountNameOf(account.name)}`,
            ]),
          ),
        );
      },
      // A missing chart is not a reason to hide the journal: the code falls back to the id.
      error: () => this.accountLabels.set(new Map()),
    });

    this.entriesApi.list({ page: this.page(), pageSize: PAGE_SIZE }).subscribe({
      next: (page) => {
        this.journalEntries.set(page.rows);
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

  accountLabel(accountId: string): string {
    return this.accountLabels().get(accountId) ?? accountId;
  }
}
