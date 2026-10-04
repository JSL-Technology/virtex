import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type FiscalYearStatus = 'OPEN' | 'CLOSED' | 'LOCKED';

export interface FiscalYear {
  id: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  closingJournalEntryId?: string | null;
}

export type YearEndCheckId =
  | 'periods_exist'
  | 'periods_closed'
  | 'entries_posted'
  | 'retained_earnings'
  | 'closing_journal'
  | 'default_ledger'
  | 'earlier_years_closed';

export interface YearEndReadiness {
  fiscalYear: FiscalYear;
  checks: { id: YearEndCheckId; ok: boolean; blocking: boolean; params: Record<string, unknown> }[];
  /** Profit positive, loss negative; null when the books have no default ledger to read. */
  result: { result: number; accounts: number } | null;
  canClose: boolean;
}

/**
 * The tenant's fiscal years.
 *
 * One route closed a year and another reopened one; nothing listed them. So no screen could name
 * the year it was about, and an audit adjustment — proposed against a CLOSED year — had no way to
 * offer the reader one to choose.
 */
@Injectable({ providedIn: 'root' })
export class FiscalYearsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/accounting/fiscal-years`;
  private readonly closeUrl = `${environment.apiUrl}/accounting/year-end-close`;

  /** What stands between a year and its close, and the result the close will transfer. */
  readiness(fiscalYearId: string): Observable<YearEndReadiness> {
    return this.http.get<YearEndReadiness>(`${this.closeUrl}/${fiscalYearId}/readiness`);
  }

  close(fiscalYearId: string): Observable<{ messageKey: string; messageParams: Record<string, unknown>; fiscalYear: FiscalYear }> {
    return this.http.post<{ messageKey: string; messageParams: Record<string, unknown>; fiscalYear: FiscalYear }>(this.closeUrl, { fiscalYearId });
  }

  reopen(fiscalYearId: string, reason: string): Observable<{ messageKey: string; messageParams: Record<string, unknown>; fiscalYear: FiscalYear }> {
    return this.http.post<{ messageKey: string; messageParams: Record<string, unknown>; fiscalYear: FiscalYear }>(`${this.closeUrl}/reopen`, { fiscalYearId, reason });
  }

  list(options: { status?: FiscalYearStatus } = {}): Observable<FiscalYear[]> {
    let params = new HttpParams();
    if (options.status) params = params.set('status', options.status);
    return this.http.get<FiscalYear[]>(this.apiUrl, { params });
  }
}
