import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type RecurringFrequency = 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';
export type RecurringStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';

export interface RecurringLine {
  productId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice?: number | null;
}

export interface RecurringInvoice {
  id: string;
  customerId: string;
  customer?: { id: string; companyName?: string };
  name: string;
  frequency: RecurringFrequency;
  startDate: string;
  nextRunDate: string | null;
  endDate: string | null;
  paymentTermDays: number;
  autoIssue: boolean;
  lines: RecurringLine[];
  notes: string | null;
  status: RecurringStatus;
  runCount: number;
  lastInvoiceId: string | null;
  lastError: string | null;
}

export interface RecurringInput {
  customerId: string;
  name: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate?: string;
  paymentTermDays?: number;
  autoIssue?: boolean;
  notes?: string;
  lines: RecurringLine[];
}

@Injectable({ providedIn: 'root' })
export class RecurringInvoicesService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/invoices/recurring`;

  list(): Observable<RecurringInvoice[]> {
    return this.http.get<RecurringInvoice[]>(this.api);
  }

  get(id: string): Observable<RecurringInvoice> {
    return this.http.get<RecurringInvoice>(`${this.api}/${id}`);
  }

  create(input: RecurringInput): Observable<RecurringInvoice> {
    return this.http.post<RecurringInvoice>(this.api, input);
  }

  update(id: string, input: Partial<RecurringInput>): Observable<RecurringInvoice> {
    return this.http.patch<RecurringInvoice>(`${this.api}/${id}`, input);
  }

  action(id: string, action: 'pause' | 'resume' | 'end' | 'run'): Observable<unknown> {
    return this.http.post(`${this.api}/${id}/${action}`, {});
  }
}
