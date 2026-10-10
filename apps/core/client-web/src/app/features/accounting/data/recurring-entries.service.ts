import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ANNUALLY';
export const FREQUENCIES: readonly Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'ANNUALLY'];

/** A line kept to be posted: one side, an amount, optional analytic tags. */
export interface StoredEntryLine {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
  dimensions?: Record<string, string> | null;
}

export interface RecurringEntry {
  id: string;
  description: string;
  journalId: string;
  lines: StoredEntryLine[];
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  lastRunDate: string | null;
  isActive: boolean;
  nextRunDate: string | null;
  pendingOccurrences: number;
  amount: number;
}

export interface RecurringEntryInput {
  description: string;
  journalId: string;
  lines: StoredEntryLine[];
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  isActive?: boolean;
}

export interface RecurringPostedEntry {
  id: string;
  entryNumber: string | null;
  date: string;
  status: string;
  amount: number;
}

export type TemplateSide = 'DEBIT' | 'CREDIT';

export interface TemplateLine {
  accountId: string;
  description?: string;
  type: TemplateSide;
  /** Share of the amount on its side; absent on every line of a side, split equally. */
  percentage?: number;
  dimensions?: Record<string, string> | null;
}

export interface EntryTemplate {
  id: string;
  name: string;
  description: string;
  lines: TemplateLine[];
}

export interface EntryTemplateInput {
  name: string;
  description: string;
  lines: TemplateLine[];
}

export interface UseTemplateInput {
  date: string;
  description: string;
  amount: number;
  journalId: string;
}

/** Recurring journal entries and entry templates (audit H-21). */
@Injectable({ providedIn: 'root' })
export class RecurringEntriesService {
  private readonly http = inject(HttpClient);
  private readonly recurringUrl = `${environment.apiUrl}/recurring-journal-entries`;
  private readonly templatesUrl = `${environment.apiUrl}/journal-entry-templates`;

  list(): Observable<RecurringEntry[]> {
    return this.http.get<RecurringEntry[]>(this.recurringUrl);
  }

  get(id: string): Observable<RecurringEntry> {
    return this.http.get<RecurringEntry>(`${this.recurringUrl}/${id}`);
  }

  create(input: RecurringEntryInput): Observable<RecurringEntry> {
    return this.http.post<RecurringEntry>(this.recurringUrl, input);
  }

  update(id: string, input: Partial<RecurringEntryInput>): Observable<RecurringEntry> {
    return this.http.patch<RecurringEntry>(`${this.recurringUrl}/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.recurringUrl}/${id}`);
  }

  postedEntries(id: string): Observable<RecurringPostedEntry[]> {
    return this.http.get<RecurringPostedEntry[]>(`${this.recurringUrl}/${id}/entries`);
  }

  templates(): Observable<EntryTemplate[]> {
    return this.http.get<EntryTemplate[]>(this.templatesUrl);
  }

  template(id: string): Observable<EntryTemplate> {
    return this.http.get<EntryTemplate>(`${this.templatesUrl}/${id}`);
  }

  createTemplate(input: EntryTemplateInput): Observable<EntryTemplate> {
    return this.http.post<EntryTemplate>(this.templatesUrl, input);
  }

  updateTemplate(id: string, input: Partial<EntryTemplateInput>): Observable<EntryTemplate> {
    return this.http.patch<EntryTemplate>(`${this.templatesUrl}/${id}`, input);
  }

  removeTemplate(id: string): Observable<void> {
    return this.http.delete<void>(`${this.templatesUrl}/${id}`);
  }

  /** Post an entry from the template: the date, a description and the amount to split. */
  useTemplate(id: string, input: UseTemplateInput): Observable<{ id: string; entryNumber?: string | null }> {
    return this.http.post<{ id: string; entryNumber?: string | null }>(`${this.templatesUrl}/${id}/create-entry`, input);
  }
}

/**
 * What each line of a template takes of `amount`: by percentage on its side, or equally, the last
 * line taking the rounding — the server's `allocate`, to preview the entry before posting it.
 */
export function allocateTemplate(lines: readonly TemplateLine[], amount: number): number[] {
  const totalCents = Math.round(amount * 100);
  const result = new Array<number>(lines.length).fill(0);
  for (const side of ['DEBIT', 'CREDIT'] as const) {
    const indexes = lines.map((line, index) => (line.type === side ? index : -1)).filter((index) => index >= 0);
    let allocated = 0;
    indexes.forEach((index, position) => {
      const share = lines[index].percentage;
      const cents =
        position === indexes.length - 1
          ? totalCents - allocated
          : share !== undefined && share !== null
            ? Math.round((totalCents * Number(share)) / 100)
            : Math.floor(totalCents / indexes.length);
      allocated += cents;
      result[index] = cents / 100;
    });
  }
  return result;
}
