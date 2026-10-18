import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { PaymentMethod as PaymentSettlementKind } from '../services/invoices';

/**
 * One of the company's payment methods (`GET /treasury/payment-methods`).
 *
 * `code` is what documents record; `fiscalCode` the authority's code for it where the market has a
 * catalogue; `kind` how it settles, which is what an invoice's e-invoicing form of payment maps from.
 */
export interface PaymentMethodRow {
  id: string;
  code: string;
  name: string;
  kind: PaymentSettlementKind;
  fiscalCode: string | null;
  /** From an authority's fixed catalogue: not editable. */
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface PaymentMethodInput {
  code: string;
  name: string;
  kind: PaymentSettlementKind;
  fiscalCode?: string | null;
  sortOrder?: number;
}

/** The settlement kinds a method can map to, in the order a person thinks of them. */
export const SETTLEMENT_KINDS: ReadonlyArray<{ value: PaymentSettlementKind; labelKey: string }> = [
  { value: 'CASH', labelKey: 'invoices.new.payment_method_cash' },
  { value: 'BANK_TRANSFER', labelKey: 'invoices.new.bank_transfer' },
  { value: 'CHECK', labelKey: 'invoices.new.cheque' },
  { value: 'CREDIT_CARD', labelKey: 'invoices.new.credit_card' },
  { value: 'DEBIT_CARD', labelKey: 'invoices.new.debit_card' },
  { value: 'CREDIT', labelKey: 'invoices.new.credit_sale' },
  { value: 'GIFT_CARD', labelKey: 'invoices.new.voucher_gift_certificate' },
  { value: 'SWAP', labelKey: 'invoices.new.barter' },
  { value: 'OTHER', labelKey: 'invoices.new.other' },
];

/** The company's payment methods: listed by every form that records how a document is paid. */
@Injectable({ providedIn: 'root' })
export class PaymentMethodsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/treasury/payment-methods`;

  /** Every method, retired ones included — what the master screen shows. */
  list(): Observable<PaymentMethodRow[]> {
    return this.http.get<PaymentMethodRow[]>(this.base);
  }

  /** The methods a document may be recorded with now. */
  active(): Observable<PaymentMethodRow[]> {
    return this.http.get<PaymentMethodRow[]>(this.base, { params: { activeOnly: 'true' } });
  }

  create(input: PaymentMethodInput): Observable<PaymentMethodRow> {
    return this.http.post<PaymentMethodRow>(this.base, input);
  }

  update(id: string, input: Partial<PaymentMethodInput> & { isActive?: boolean }): Observable<PaymentMethodRow> {
    return this.http.patch<PaymentMethodRow>(`${this.base}/${id}`, input);
  }
}
