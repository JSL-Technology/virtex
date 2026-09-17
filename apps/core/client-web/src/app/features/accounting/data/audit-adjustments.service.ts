import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Page } from '../../../core/api/page';

export type AdjustmentStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'FAILED';

/** One line of a proposed adjustment: an account, a side, and why. */
export interface ProposedAdjustmentLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  dimensions?: Record<string, string>;
}

export interface ProposedAdjustmentEvidence {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

export interface ProposedAdjustment {
  id: string;
  fiscalYearId: string;
  date: string;
  description: string;
  journalId: string;
  lines: ProposedAdjustmentLine[];
  status: AdjustmentStatus;
  proposerId: string | null;
  proposer?: { id: string; firstName: string; lastName: string } | null;
  approvalRequestId?: string | null;
  journalEntryId?: string | null;
  evidence?: ProposedAdjustmentEvidence[];
  createdAt: string;
}

export interface ProposeAdjustmentInput {
  fiscalYearId: string;
  date: string;
  description: string;
  journalId: string;
  lines: ProposedAdjustmentLine[];
}

/**
 * The corrections an external audit proposes to a year that is already closed.
 *
 * The whole feature was unreachable: the service, the entities, the approval workflow and the
 * listener that posts the approved entry all existed and none of them was registered in a module
 * or exposed by a route, so there was nothing for a client to call. See
 * `AuditAdjustmentsController`.
 */
@Injectable({ providedIn: 'root' })
export class AuditAdjustmentsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/audit/adjustments`;

  list(
    options: { page?: number; pageSize?: number; fiscalYearId?: string; status?: AdjustmentStatus } = {},
  ): Observable<Page<ProposedAdjustment>> {
    let params = new HttpParams();
    if (options.page) params = params.set('page', String(options.page));
    if (options.pageSize) params = params.set('pageSize', String(options.pageSize));
    if (options.fiscalYearId) params = params.set('fiscalYearId', options.fiscalYearId);
    if (options.status) params = params.set('status', options.status);
    return this.http.get<Page<ProposedAdjustment>>(this.apiUrl, { params });
  }

  findOne(id: string): Observable<ProposedAdjustment> {
    return this.http.get<ProposedAdjustment>(`${this.apiUrl}/${id}`);
  }

  propose(input: ProposeAdjustmentInput): Observable<ProposedAdjustment> {
    return this.http.post<ProposedAdjustment>(this.apiUrl, input);
  }

  /** A working paper: the evidence behind the proposal, uploaded against it. */
  addEvidence(id: string, file: File): Observable<ProposedAdjustmentEvidence> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ProposedAdjustmentEvidence>(`${this.apiUrl}/${id}/evidence`, form);
  }
}
