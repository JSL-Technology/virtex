import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type TaxTreatment = 'TAXED' | 'ZERO_RATED' | 'EXEMPT';

export type PaymentMethod =
  | 'CASH'
  | 'CHECK'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'CREDIT'
  | 'BANK_TRANSFER'
  | 'GIFT_CARD'
  | 'SWAP'
  | 'OTHER';

export type InvoiceStatus =
  | 'Draft'
  | 'Pending'
  | 'Paid'
  | 'Partially Paid'
  | 'Void'
  | 'Credit Note';

export type FiscalDocumentType =
  | 'B01' | 'B02' | 'B04' | 'B11' | 'B15'
  | 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'E46';

export interface InvoiceLineItem {
  id?: string;
  productId?: string | null;
  description: string;
  sortOrder: number;
  quantity: number;
  unitOfMeasure?: string | null;
  price: number;
  discountRate: number;
  discountAmount: number;
  lineSubtotal: number;
  taxRate: number;
  taxAmount: number;
  taxTreatment: TaxTreatment;
  isService: boolean;
  creditedQuantity: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  ncfNumber?: string | null;
  fiscalDocumentType?: string | null;
  ncfExpiresAt?: string | null;
  customerId: string;
  customerName: string;
  customerAddress?: string | null;
  customerTaxId?: string | null;
  issueDate: string;
  dueDate: string;
  issuedAt?: string | null;
  subtotal: number;
  discountTotal: number;
  taxedTotal: number;
  exemptTotal: number;
  goodsTotal: number;
  servicesTotal: number;
  tax: number;
  serviceCharge: number;
  taxWithheld: number;
  incomeTaxWithheld: number;
  total: number;
  netReceivable: number;
  balance: number;
  creditedTotal: number;
  currencyCode: string;
  status: InvoiceStatus;
  type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  paymentMethod: PaymentMethod;
  lineItems: InvoiceLineItem[];
  notes?: string;
  originalInvoiceId?: string | null;
}

/** The server derives every amount; the request carries intent, never totals. */
export interface CreateInvoiceLine {
  productId?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  discountRate?: number;
  taxTreatment?: TaxTreatment;
  taxRate?: number;
  unitOfMeasure?: string;
  isService?: boolean;
}

export interface CreateInvoiceDto {
  customerId: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  currencyCode?: string;
  documentDiscountRate?: number;
  serviceChargeRate?: number;
  taxWithholdingRate?: number;
  incomeTaxWithholdingRate?: number;
  paymentMethod?: PaymentMethod;
  fiscalDocumentType?: FiscalDocumentType;
  /** False leaves the document as a draft, consuming no fiscal numbering. */
  issue?: boolean;
  lineItems: CreateInvoiceLine[];
}

export interface CreditNoteRequest {
  reason?: string;
  items?: Array<{ lineId: string; quantity: number }>;
  modificationCode?: '1' | '2' | '3' | '4' | '5';
  restockGoods?: boolean;
}

export interface InvoiceQuery {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  customerId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface PaginatedInvoices {
  items: Invoice[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * What the invoicing screen needs before it can present a correct form.
 *
 * The client used to hardcode `USD` and an 18 % rate for every market: a Mexican tenant saw 18 %
 * where the IVA is 16 %, and a Dominican one invoiced in dollars by default. The server knows the
 * tenant's country, its functional currency and the rates its regime levies; the client asks.
 */
export interface InvoicingContext {
  ready: boolean;
  missing: string[];
  countryCode: string | null;
  baseCurrency: string;
  /** Rates the market levies, as fractions, standard rate first. */
  taxRates: number[];
  /** True where the tax base is sub-national and the tenant must configure it (US, Brazil). */
  taxRequiresConfiguration: boolean;
  fiscalDocumentTypes: FiscalDocumentType[];
  serviceChargeRate: number;
}

@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/invoices`;

  /**
   * Paginated, filtered and searched SERVER-side.
   *
   * The previous client fetched every invoice of the tenant on every visit and filtered in memory —
   * and then fetched the whole list a second time just to compute "previous / next".
   */
  getInvoices(query: InvoiceQuery = {}): Observable<PaginatedInvoices> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<PaginatedInvoices>(this.apiUrl, { params });
  }

  getInvoiceById(id: string): Observable<Invoice> {
    return this.http.get<Invoice>(`${this.apiUrl}/${id}`);
  }

  createInvoice(invoice: CreateInvoiceDto): Observable<Invoice> {
    return this.http.post<Invoice>(this.apiUrl, invoice);
  }

  updateDraft(id: string, invoice: CreateInvoiceDto): Observable<Invoice> {
    return this.http.put<Invoice>(`${this.apiUrl}/${id}`, invoice);
  }

  discardDraft(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /** Assigns the fiscal number, posts the ledger entry and transmits the e-CF. */
  issue(id: string, fiscalDocumentType?: FiscalDocumentType): Observable<Invoice> {
    return this.http.post<Invoice>(
      `${this.apiUrl}/${id}/issue`,
      fiscalDocumentType ? { fiscalDocumentType } : {},
    );
  }

  createCreditNote(invoiceId: string, request: CreditNoteRequest = {}): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.apiUrl}/${invoiceId}/credit-note`, request);
  }

  downloadInvoicePdf(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/pdf`, { responseType: 'blob' });
  }

  /** Readiness, currency, legal rates and issuable document types for this tenant's market. */
  context(): Observable<InvoicingContext> {
    return this.http.get<InvoicingContext>(`${this.apiUrl}/context`);
  }
}
