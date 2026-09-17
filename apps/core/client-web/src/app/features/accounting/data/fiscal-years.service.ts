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

  list(options: { status?: FiscalYearStatus } = {}): Observable<FiscalYear[]> {
    let params = new HttpParams();
    if (options.status) params = params.set('status', options.status);
    return this.http.get<FiscalYear[]>(this.apiUrl, { params });
  }
}
