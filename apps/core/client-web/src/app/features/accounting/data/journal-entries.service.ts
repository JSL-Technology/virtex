import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Page } from '../../../core/api/page';

/**
 * Mirrors `JournalEntryStatus` on the server.
 *
 * The values are English words because they are stored values, not labels — the catalogue turns
 * them into `ACCOUNTING.JOURNAL_ENTRIES.STATUS_*` for display. Rendering the stored value is what
 * put the word "Posted" on a Spanish screen.
 */
export type JournalEntryStatus =
  | 'Draft'
  | 'Pending Approval'
  | 'Posted'
  | 'Modified'
  | 'Void'
  | 'Rejected';

export interface JournalEntryLine {
  id: string;
  accountId: string;
  debit: number | string;
  credit: number | string;
  description?: string;
}

export interface JournalEntry {
  id: string;
  /**
   * The document number — `GENERAL-2026-000003`, `VENTAS-2026-000002`.
   *
   * The server has allocated one per posted entry from the tenant's own sequence for some time,
   * and the model did not declare it, so the register printed `entry.id` instead: a UUID, in the
   * column headed "Nº de asiento", and again as the title of every journal-entry tab. Nobody can
   * cite a UUID to an auditor.
   *
   * Null until the entry is posted: a draft has not consumed a number, because a number consumed
   * and then discarded is a gap in a sequence that is supposed to have none.
   */
  entryNumber: string | null;
  /** `YYYY-MM-DD`. A posting date: a calendar date, with no time and no zone. */
  date: string;
  description: string;
  currencyCode?: string;
  status: JournalEntryStatus;
  lines: JournalEntryLine[];
}

/** Re-exported so existing callers keep their import; the shape lives in `./page`. */
export type { Page } from '../../../core/api/page';

@Injectable({ providedIn: 'root' })
export class JournalEntriesApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/journal-entries`;

  /**
   * A page of entries, newest first.
   *
   * The route used to return every entry the tenant had ever posted. It is bounded now, so the
   * caller has to say which page it wants and what came back has to say whether there is more.
   */
  list(query: { page?: number; pageSize?: number } = {}): Observable<Page<JournalEntry>> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', String(query.page));
    if (query.pageSize) params = params.set('pageSize', String(query.pageSize));
    return this.http.get<Page<JournalEntry>>(this.apiUrl, { params });
  }

  getById(id: string): Observable<JournalEntry> {
    return this.http.get<JournalEntry>(`${this.apiUrl}/${id}`);
  }
}
