import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type PartnerKind = 'customer' | 'supplier';

export interface StatementMovement {
  date: string;
  kind: string;
  documentId: string;
  reference: string | null;
  amount: number;
  balance: number;
}

export interface PartnerStatement {
  partnerId: string;
  partnerName: string;
  currencyCode: string;
  currencies: string[];
  from: string;
  to: string;
  openingBalance: number;
  movements: StatementMovement[];
  totals: { increases: number; decreases: number };
  closingBalance: number;
}

/** Statements of account (audit H-17): one partner's documents and running balance. */
@Injectable({ providedIn: 'root' })
export class StatementsService {
  private readonly http = inject(HttpClient);

  statement(kind: PartnerKind, partnerId: string, query: { from?: string; to?: string; currency?: string | null }): Observable<PartnerStatement> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.currency) params = params.set('currency', query.currency);
    const base = kind === 'customer' ? 'customers' : 'suppliers';
    return this.http.get<PartnerStatement>(`${environment.apiUrl}/${base}/${partnerId}/statement`, { params });
  }
}

/** Where a statement line opens: the document it came from. */
export function documentRoute(kind: string, documentId: string): unknown[] | null {
  switch (kind) {
    case 'invoice':
    case 'credit_note':
    case 'debit_note':
      return ['/invoices', documentId];
    case 'bill':
    case 'bill_void':
      return ['/accounts-payable', documentId];
    case 'payment':
    case 'payment_void':
      return ['/accounts-payable/payments', documentId];
    case 'vendor_debit_note':
    case 'vendor_debit_note_void':
      return ['/accounts-payable/debit-notes', documentId];
    default:
      return null;
  }
}
