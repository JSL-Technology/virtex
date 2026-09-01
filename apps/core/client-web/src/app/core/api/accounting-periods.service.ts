import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Mirrors `PeriodStatus` on the server. The value is stored; the label is a catalogue key. */
export type PeriodStatus = 'OPEN' | 'CLOSED';

export interface AccountingPeriod {
  id: string;
  /**
   * Whatever the tenant called the period, in whatever language they wrote it in.
   *
   * It is therefore a secondary label and never the identity of the row: the identity is the
   * date range, which every reader's own locale can spell for itself.
   */
  name: string;
  /** `YYYY-MM-DD`. A calendar date with no time and no zone — render it with `dateOnly`. */
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  generalLedgerStatus: PeriodStatus;
  accountsPayableStatus: PeriodStatus;
  accountsReceivableStatus: PeriodStatus;
  inventoryStatus: PeriodStatus;
}

export interface PeriodCommandResult {
  message: string;
  period: AccountingPeriod;
}

@Injectable({ providedIn: 'root' })
export class AccountingPeriodsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/accounting`;

  list(year?: number): Observable<AccountingPeriod[]> {
    const params = year === undefined ? {} : { params: { year: String(year) } };
    return this.http.get<AccountingPeriod[]>(`${this.apiUrl}/periods`, params);
  }

  close(periodId: string): Observable<PeriodCommandResult> {
    return this.http.post<PeriodCommandResult>(`${this.apiUrl}/close-period`, { periodId });
  }

  /**
   * Reopening a closed period is an audited exception, so the server requires a justification of
   * at least ten characters and rejects the request without one. The reason travels with the
   * command rather than being asked for afterwards.
   */
  reopen(periodId: string, reason: string): Observable<PeriodCommandResult> {
    return this.http.post<PeriodCommandResult>(`${this.apiUrl}/reopen-period`, { periodId, reason });
  }
}
