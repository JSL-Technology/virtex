import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type InboundMailPurpose = 'BILLS' | 'ORDERS';
export type InboundMessageStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'NEEDS_REVIEW' | 'REJECTED' | 'FAILED' | 'DISMISSED';

export interface InboundMailbox {
  purpose: InboundMailPurpose;
  /** Null when the deployment has no domain to receive at. */
  address: string | null;
  active: boolean;
  allowedSenders: string[];
  updatedAt: string;
}

export interface InboundMessage {
  id: string;
  from: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  status: InboundMessageStatus;
  reason: string | null;
  records: Array<{ type: string; id: string; label: string; link: string }>;
  /** What a person needs to finish it; its shape is the purpose's own. */
  review: Record<string, unknown> | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number }>;
}

/** The company's mail addresses for supplier bills and customer orders, and what arrives at them. */
@Injectable({ providedIn: 'root' })
export class InboundMailService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/inbound-mail`;

  mailboxes(): Observable<{ configured: boolean; mailboxes: InboundMailbox[] }> {
    return this.http.get<{ configured: boolean; mailboxes: InboundMailbox[] }>(`${this.url}/mailboxes`);
  }

  /** Create the address, or replace it: the old one stops working at once. */
  rotate(purpose: InboundMailPurpose): Observable<InboundMailbox> {
    return this.http.post<InboundMailbox>(`${this.url}/mailboxes/${purpose.toLowerCase()}/rotate`, {});
  }

  update(purpose: InboundMailPurpose, change: { active?: boolean; allowedSenders?: string[] }): Observable<InboundMailbox> {
    return this.http.patch<InboundMailbox>(`${this.url}/mailboxes/${purpose.toLowerCase()}`, change);
  }

  messages(purpose: InboundMailPurpose, statuses: InboundMessageStatus[] = []): Observable<InboundMessage[]> {
    const params = statuses.length ? new HttpParams().set('status', statuses.join(',')) : undefined;
    return this.http.get<InboundMessage[]>(`${this.url}/${purpose.toLowerCase()}/messages`, { params });
  }

  retry(purpose: InboundMailPurpose, id: string): Observable<{ id: string; status: InboundMessageStatus }> {
    return this.http.post<{ id: string; status: InboundMessageStatus }>(`${this.url}/${purpose.toLowerCase()}/messages/${id}/retry`, {});
  }

  dismiss(purpose: InboundMailPurpose, id: string): Observable<{ id: string; status: InboundMessageStatus }> {
    return this.http.post<{ id: string; status: InboundMessageStatus }>(`${this.url}/${purpose.toLowerCase()}/messages/${id}/dismiss`, {});
  }

  attachment(purpose: InboundMailPurpose, id: string, attachmentId: string): Observable<Blob> {
    return this.http.get(`${this.url}/${purpose.toLowerCase()}/messages/${id}/attachments/${attachmentId}`, { responseType: 'blob' });
  }
}
