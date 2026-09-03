import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'OTHER';
export type CustomerPaymentStatus = 'POSTED' | 'VOID';

export interface CustomerReceiptLine {
  invoiceId: string;
  /** Cash applied to this invoice, in the receipt's currency. */
  amount: number;
  /** Consumption tax the customer withheld and paid to the authority on our behalf. */
  taxWithheld?: number;
  /** Income tax the customer withheld on this collection. */
  incomeTaxWithheld?: number;
  /** Settlement discount granted on this invoice. */
  discount?: number;
}

export interface CustomerReceipt {
  id: string;
  receiptNumber: string | null;
  customerId: string;
  paymentDate: string;
  bankAccountId: string;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  /** An advance or an overpayment: received but applied to no invoice. */
  unappliedAmount: number;
  status: CustomerPaymentStatus;
  paymentMethod: PaymentMethod;
  reference: string | null;
  journalEntryId: string | null;
  voidReason: string | null;
}

export interface CreateCustomerReceipt {
  customerId: string;
  paymentDate: string;
  /** A bank account, not a chart-of-accounts row. */
  bankAccountId: string;
  /**
   * Everything received.
   *
   * Held apart from the sum of the lines so an advance or an overpayment can be recorded; the
   * difference is carried as unapplied cash. The receipt used to have to match existing invoices
   * exactly, so a customer paying ahead had nowhere to be recorded at all.
   */
  amountReceived: number;
  currencyCode?: string;
  paymentMethod?: PaymentMethod;
  reference?: string;
  lines?: CustomerReceiptLine[];
}

/**
 * Customer collections.
 *
 * ## What this service was
 *
 * One method — `getReceipts()` — against an endpoint the comment described as "assuming this is
 * the new endpoint", returning a shape the server does not send. There was no way to record a
 * collection: the form that should have done it ended in
 * `console.log('La creación de recibos aún no está conectada al backend.')`.
 */
@Injectable({ providedIn: 'root' })
export class CustomerReceiptsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/customer-payments`;

  list(customerId?: string): Observable<CustomerReceipt[]> {
    const params = customerId ? new HttpParams().set('customerId', customerId) : undefined;
    return this.http.get<CustomerReceipt[]>(this.apiUrl, { params });
  }

  findOne(id: string): Observable<CustomerReceipt> {
    return this.http.get<CustomerReceipt>(`${this.apiUrl}/${id}`);
  }

  create(body: CreateCustomerReceipt): Observable<CustomerReceipt> {
    return this.http.post<CustomerReceipt>(this.apiUrl, body);
  }

  /** A bounced cheque, a returned transfer, a receipt raised in error. */
  void(id: string, reason: string, reversalDate?: string): Observable<CustomerReceipt> {
    return this.http.post<CustomerReceipt>(`${this.apiUrl}/${id}/void`, { reason, reversalDate });
  }
}
