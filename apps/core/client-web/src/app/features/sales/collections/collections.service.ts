import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type CollectionAction = 'call' | 'firm_reminder' | 'reminder' | 'courtesy_reminder' | 'await_promise' | 'wait' | 'none';
export type CollectionReason =
  | 'large_balance'
  | 'unlikely_soon'
  | 'doubtful'
  | 'long_overdue'
  | 'broken_promise'
  | 'promise_in_date'
  | 'recently_contacted'
  | 'due_soon';
export type ReminderTone = 'cordial' | 'formal' | 'firm';
export type CollectionActivityKind = 'REMINDER' | 'CALL' | 'PROMISE' | 'NOTE';
export type CallOutcome = 'reached' | 'no_answer' | 'promised' | 'disputed' | 'wrong_contact' | 'paid_already';

export interface CollectionsWorklistItem {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  currencyCode: string;
  balance: number;
  balanceBase: number;
  pBy7: number | null;
  pBy30: number;
  expectedDate: string | null;
  likelihoodSource: 'projection' | 'age';
  doubtful: boolean;
  priority: number;
  action: CollectionAction;
  suggestedTone: ReminderTone | null;
  reasons: CollectionReason[];
  lastContact: { kind: CollectionActivityKind; occurredAt: string; outcome: string | null } | null;
  openPromise: { date: string; amount: number | null } | null;
  brokenPromises: number;
  draftReminderId: string | null;
}

export interface CollectionsWorklist {
  asOfDate: string;
  baseCurrency: string;
  projectionAt: string | null;
  totals: { invoices: number; balanceBase: number; overdueBase: number; byAction: Partial<Record<CollectionAction, number>> };
  total: number;
  items: CollectionsWorklistItem[];
}

export interface CollectionActivity {
  id: string;
  invoiceId: string | null;
  kind: CollectionActivityKind;
  status: 'DRAFT' | 'DONE' | 'CANCELLED';
  occurredAt: string;
  userId: string | null;
  userName: string | null;
  channel: string | null;
  outcome: CallOutcome | null;
  promisedDate: string | null;
  promisedAmount: number | null;
  recipient: string | null;
  message: string | null;
  tone: ReminderTone | null;
}

export interface LogActivityInput {
  invoiceId: string;
  kind: 'CALL' | 'PROMISE' | 'NOTE';
  outcome?: CallOutcome;
  promisedDate?: string;
  promisedAmount?: number;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class CollectionsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/collections`;

  worklist(query: { action?: CollectionAction | null; customerId?: string | null; limit?: number; offset?: number } = {}): Observable<CollectionsWorklist> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<CollectionsWorklist>(`${this.apiUrl}/worklist`, { params });
  }

  activities(invoiceId: string): Observable<CollectionActivity[]> {
    return this.http.get<CollectionActivity[]>(`${this.apiUrl}/invoices/${invoiceId}/activities`);
  }

  log(input: LogActivityInput): Observable<CollectionActivity[]> {
    return this.http.post<CollectionActivity[]>(`${this.apiUrl}/activities`, input);
  }

  /** The assistant's note, for the person to edit. Sends nothing. */
  compose(invoiceId: string, tone: ReminderTone): Observable<{ message: string; tone: ReminderTone }> {
    return this.http.post<{ message: string; tone: ReminderTone }>(`${this.apiUrl}/invoices/${invoiceId}/reminder/compose`, { tone });
  }

  saveDraft(invoiceId: string, draft: { tone?: ReminderTone; message?: string; to?: string }): Observable<CollectionActivity> {
    return this.http.post<CollectionActivity>(`${this.apiUrl}/invoices/${invoiceId}/reminder/draft`, draft);
  }

  send(
    invoiceId: string,
    reminder: { tone?: ReminderTone; message?: string; to?: string; draftId?: string },
  ): Observable<{ queued: true; to: string; activityId: string }> {
    return this.http.post<{ queued: true; to: string; activityId: string }>(`${this.apiUrl}/invoices/${invoiceId}/reminder/send`, reminder);
  }

  cancelDraft(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/drafts/${id}`);
  }
}
