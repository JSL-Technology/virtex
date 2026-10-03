import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** One document waiting for a decision, from any source (`GET /approvals/inbox`). */
export interface PendingDecision {
  source: string;
  id: string;
  documentTypeKey: string;
  number: string | null;
  party: string | null;
  amount: number | null;
  currencyCode: string | null;
  requestedAt: string | null;
  route: string | null;
  step: number | null;
  canDecide: boolean;
  blockedReasonKey: string | null;
}

/**
 * The approvals inbox (QA A-11): workflow requests, purchase orders and requisitions in one list,
 * each decision routed back to the module that owns the document and enforces its rules.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalsInboxService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/approvals/inbox`;

  pending(): Observable<PendingDecision[]> {
    return this.http.get<PendingDecision[]>(this.apiUrl);
  }

  approve(decision: Pick<PendingDecision, 'source' | 'id'>, comment?: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${decision.source}/${decision.id}/approve`, { comment });
  }

  reject(decision: Pick<PendingDecision, 'source' | 'id'>, reason: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${decision.source}/${decision.id}/reject`, { reason });
  }
}
