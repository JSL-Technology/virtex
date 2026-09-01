import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

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

@Injectable({ providedIn: 'root' })
export class JournalEntriesApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/journal-entries`;

  list(): Observable<JournalEntry[]> {
    return this.http.get<JournalEntry[]>(this.apiUrl);
  }

  getById(id: string): Observable<JournalEntry> {
    return this.http.get<JournalEntry>(`${this.apiUrl}/${id}`);
  }
}
