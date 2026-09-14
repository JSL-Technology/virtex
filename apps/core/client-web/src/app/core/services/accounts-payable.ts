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

/**
 * A supplier bill as the server actually returns it.
 *
 * ## What this replaced
 *
 * `billNumber`, `issueDate` and `vendorName` — three fields the API has never sent. The entity
 * carries `ncf`, `date` and a `vendor` relation. The list template printed all three, so the
 * supplier column and the date columns were blank and the link into the detail page had no text to
 * click on. The create DTO was worse: `supplierId`, `billNumber`, `issueDate` and
 * `lineItems[{description, quantity, price}]` against a server expecting `vendorId`, `date`,
 * `dueDate` and `lines[{product, quantity, unitPrice, total}]`. Not one field name matched, and
 * with `whitelist` and `forbidNonWhitelisted` both on, every POST was rejected: the "new supplier
 * bill" screen could not create a bill, ever, and the component reported a generic save error.
 */
export interface VendorBillLine {
  id?: string;
  /** The item or service, as it reads on the supplier's document. */
  product: string;
  quantity: number;
  unitPrice: number;
  total: number;
  productId?: string | null;
  expenseAccountId?: string | null;
}

export interface VendorBill {
  id: string;
  vendorId: string;
  vendor?: { id: string; name: string; taxId?: string | null };
  /** Comprobante fiscal number. Optional: not every jurisdiction has one. */
  ncf?: string | null;
  ncfModified?: string | null;
  date: string;
  dueDate: string;
  paidAt?: string | null;
  currencyCode: string;
  exchangeRate: number;
  total: number;
  totalInBaseCurrency: number;
  balance: number;
  status: VendorBillStatus;
  lines?: VendorBillLine[];

  // Fiscal breakdown. The server models all of it for the DGII 606 and the ledger entry posts from
  // it; the client had no way to capture any of it, so every field was stored at zero.
  goodsAmount: number;
  servicesAmount: number;
  taxAmount: number;
  taxWithheld: number;
  incomeTaxWithheld: number;
  taxToCost: number;
  taxProportional: number;
  exciseAmount: number;
  otherTaxes: number;
  serviceCharge: number;
  purchaseCategory?: string;
  isrRetentionType?: string | null;
  paymentForm?: string;

  journalEntryId?: string | null;
  reversalJournalEntryId?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
}

export interface CreateVendorBillLineDto {
  product: string;
  quantity: number;
  unitPrice: number;
  /** Recomputed server-side from quantity × unitPrice; sent so the server can check the client. */
  total: number;
  productId?: string;
  expenseAccountId?: string;
}

export interface CreateVendorBillDto {
  vendorId: string;
  date: string;
  dueDate: string;
  lines: CreateVendorBillLineDto[];
  /** Checked against the lines and the tax breakdown, not stored as given. */
  total?: number;
  currencyCode?: string;
  ncf?: string;
  ncfModified?: string;

  taxAmount?: number;
  taxWithheld?: number;
  incomeTaxWithheld?: number;
  taxToCost?: number;
  taxProportional?: number;
  exciseAmount?: number;
  otherTaxes?: number;
  serviceCharge?: number;
  goodsAmount?: number;
  servicesAmount?: number;

  purchaseCategory?: string;
  isrRetentionType?: string;
  paymentForm?: string;
}

/** `lines` cannot be patched: the server refuses it and says to raise a note instead. */
export type UpdateVendorBillDto = Partial<Omit<CreateVendorBillDto, 'lines'>>;

/** DGII 606 "Tipo de Bienes y Servicios Comprados". */
export const PURCHASE_CATEGORIES = [
  { code: '01', labelKey: 'accounts_payable.purchase_category.personnel_expenses' },
  { code: '02', labelKey: 'accounts_payable.purchase_category.work_goods_services' },
  { code: '03', labelKey: 'accounts_payable.purchase_category.leasing' },
  { code: '04', labelKey: 'accounts_payable.purchase_category.fixed_asset_leasing' },
  { code: '05', labelKey: 'accounts_payable.purchase_category.improvement_expenses' },
  { code: '06', labelKey: 'accounts_payable.purchase_category.merchandise_purchases' },
  { code: '07', labelKey: 'accounts_payable.purchase_category.related_services' },
  { code: '08', labelKey: 'accounts_payable.purchase_category.financial_expenses' },
  { code: '09', labelKey: 'accounts_payable.purchase_category.extraordinary_expenses' },
  { code: '10', labelKey: 'accounts_payable.purchase_category.cost_of_sales' },
  { code: '11', labelKey: 'accounts_payable.purchase_category.asset_acquisitions' },
  { code: '12', labelKey: 'accounts_payable.purchase_category.insurance_expenses' },
] as const;

/** DGII "Forma de Pago". */
export const PAYMENT_FORMS = [
  { code: '01', labelKey: 'accounts_payable.payment_form.cash' },
  { code: '02', labelKey: 'accounts_payable.payment_form.check_transfer' },
  { code: '03', labelKey: 'accounts_payable.payment_form.card' },
  { code: '04', labelKey: 'accounts_payable.payment_form.credit' },
  { code: '05', labelKey: 'accounts_payable.payment_form.barter' },
  { code: '06', labelKey: 'accounts_payable.payment_form.credit_note' },
  { code: '07', labelKey: 'accounts_payable.payment_form.mixed' },
] as const;

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

  voidBill(id: string, reason: string, reversalDate?: string): Observable<VendorBill> {
    return this.http.post<VendorBill>(`${this.apiUrl}/${id}/void`, { reason, reversalDate });
  }

  submitForApproval(id: string): Observable<VendorBill> {
    return this.http.post<VendorBill>(`${this.apiUrl}/${id}/submit-for-approval`, {});
  }

  aging(asOfDate?: string): Observable<unknown> {
    return this.http.get(`${this.apiUrl}/aging`, {
      params: asOfDate ? { asOfDate } : {},
    });
  }
}
