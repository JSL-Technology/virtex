import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AgingBucket {
  /** `'1-30'`, `'31-60'`, `'61-90'`, `'90+'` — days past due, oldest bucket open-ended. */
  label: string;
  from: number;
  to: number | null;
  amount: number;
}

export interface AgingRow {
  partyId: string;
  partyName: string;
  /** Not yet due. */
  current: number;
  buckets: AgingBucket[];
  total: number;
}

export interface AgingReport {
  asOfDate: string;
  rows: AgingRow[];
  totals: { current: number; buckets: AgingBucket[]; total: number };
}

/**
 * What is owed, and for how long — on both sides.
 *
 * There was no ageing report anywhere in the product: not for payables, not for receivables. It is
 * the report a treasurer opens to decide what to pay next and the one an auditor asks for to
 * substantiate the balance, and neither module could produce it.
 */
@Injectable({ providedIn: 'root' })
export class AgingService {
  private readonly http = inject(HttpClient);

  payables(asOfDate?: string): Observable<AgingReport> {
    return this.http.get<AgingReport>(`${environment.apiUrl}/accounts-payable/aging`, {
      params: this.params(asOfDate),
    });
  }

  receivables(asOfDate?: string): Observable<AgingReport> {
    return this.http.get<AgingReport>(`${environment.apiUrl}/customer-payments/aging`, {
      params: this.params(asOfDate),
    });
  }

  private params(asOfDate?: string): HttpParams | undefined {
    return asOfDate ? new HttpParams().set('asOfDate', asOfDate) : undefined;
  }
}
