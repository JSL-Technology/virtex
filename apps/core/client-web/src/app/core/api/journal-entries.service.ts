import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Page } from './page';

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
  /** `YYYY-MM-DD`. A posting date: a calendar date, with no time and no zone. */
  date: string;
  description: string;
  currencyCode?: string;
  status: JournalEntryStatus;
  lines: JournalEntryLine[];
}

/** Re-exported so existing callers keep their import; the shape lives in `./page`. */
export type { Page } from './page';

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
