import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Interfaces based on backend entities (simplified for now)
/**
 * Mirrors `VendorBillStatus` on the server.
 *
 * It used to read `'Draft' | 'Submitted' | 'Approved' | 'Paid' | 'Void'` — five title-case words
 * the server has never sent. The status badge switched on them, so every bill fell through to the
 * default and rendered as a draft whatever it actually was, and the raw value printed beside it
 * was an uppercase enum member no reader was meant to see.
 */
export type VendorBillStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'OPEN'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOID'
  | 'REJECTED';

export interface VendorBill {
  id: string;
  vendorId: string;
  vendorName: string;
  billNumber: string;
  issueDate: string;
  dueDate: string;
  currencyCode: string;
  total: number;
  balance: number;
  status: VendorBillStatus;
}

export interface CreateVendorBillDto {
  supplierId: string;
  billNumber: string;
  issueDate: string;
  dueDate: string;
  lineItems: {
    description: string;
    quantity: number;
    price: number;
    costCenterId?: string;
    expenseAccountId: string;
  }[];
  notes?: string;
}

export type UpdateVendorBillDto = Partial<CreateVendorBillDto>

export interface VendorBillPaymentLine {
  vendorBillId: string;
  /** Cash paid against this bill, in the bill's currency. */
  amount: number;
  /** Consumption tax withheld from the supplier and owed to the authority. */
  taxWithheld?: number;
  /** Income tax withheld on this payment. */
  incomeTaxWithheld?: number;
  /** Settlement discount taken. */
  discount?: number;
}

export interface PayVendorBillsDto {
  paymentDate: string;
  /** The bank account the funds leave. A bank account, not a chart-of-accounts row. */
  bankAccountId: string;
  reference?: string;
  lines: VendorBillPaymentLine[];
}

export interface PaymentBatch {
  id: string;
  paymentDate: string;
  bankAccountId: string;
  reference: string | null;
  status: string;
  journalEntryId?: string | null;
}

export interface VendorPayment {
  id: string;
  vendorBillId: string;
  date: string;
  amount: number;
  amountPaid: number;
  taxWithheld: number;
  incomeTaxWithheld: number;
  discount: number;
  exchangeDifference: number;
  exchangeRate: number;
}

@Injectable({ providedIn: 'root' })
export class AccountsPayableService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/accounts-payable`;

  getVendorBills(): Observable<VendorBill[]> {
    return this.http.get<VendorBill[]>(this.apiUrl);
  }

  getVendorBillById(id: string): Observable<VendorBill> {
    return this.http.get<VendorBill>(`${this.apiUrl}/${id}`);
  }

  createVendorBill(dto: CreateVendorBillDto): Observable<VendorBill> {
    return this.http.post<VendorBill>(this.apiUrl, dto);
  }

  updateVendorBill(id: string, dto: UpdateVendorBillDto): Observable<VendorBill> {
    return this.http.patch<VendorBill>(`${this.apiUrl}/${id}`, dto);
  }

  /**
   * Settle one or more bills.
   *
   * There was no method for it and no route behind it: `createPaymentBatch` existed on the server,
   * was exposed by no controller and called by nothing, so a supplier invoice could be recorded and
   * approved but never paid.
   */
  payBills(dto: PayVendorBillsDto): Observable<PaymentBatch> {
    return this.http.post<PaymentBatch>(`${this.apiUrl}/payments`, dto);
  }

  listPayments(billId: string): Observable<VendorPayment[]> {
    return this.http.get<VendorPayment[]>(`${this.apiUrl}/${billId}/payments`);
  }

  voidBill(id: string, reason: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${id}/void`, { reason });
  }

  submitForApproval(id: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${id}/submit-for-approval`, {});
  }
}
