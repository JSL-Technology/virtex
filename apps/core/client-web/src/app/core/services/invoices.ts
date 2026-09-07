import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { IdempotencyKeyService } from '../http/idempotency-key.service';

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

/**
 * A fiscal document type the tenant's market lets them issue.
 *
 * This used to be a union of the twelve Dominican comprobante codes, which made every other
 * market's document type unrepresentable in the client: a Chilean DTE 33, a Mexican `I` or a
 * Brazilian `55` could not be typed, let alone offered. The server now describes the types its
 * market's adapter owns, and the label travels as a translation key so the client carries no
 * country's vocabulary of its own.
 */
export interface FiscalDocumentTypeOption {
  /** The authority's own code, written verbatim into the document. */
  code: string;
  /** Translation key naming the type. */
  labelKey: string;
  /** Whether the buyer's tax identifier is mandatory for this type. */
  requiresBuyerTaxId: boolean;
}

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

/** One line of a priced document, as the server computed it. */
export interface InvoicePreviewLine {
  gross: number;
  discountAmount: number;
  subtotal: number;
  documentDiscountAmount: number;
  taxableBase: number;
  taxRate: number;
  taxAmount: number;
  exciseAmount: number;
  isService: boolean;
}

/**
 * What a document comes to, computed by the server without creating anything.
 *
 * The invoice form used to derive these figures itself. That was a second implementation of the
 * document arithmetic and it had already diverged — it taxed the base before the document
 * discount, knew nothing of excise, and applied whatever withholding the form carried rather than
 * the buyer's regime. The operator watched one number and was issued another.
 */
export interface InvoicePreview {
  subtotal: number;
  discountTotal: number;
  taxedTotal: number;
  exemptTotal: number;
  goodsTotal: number;
  servicesTotal: number;
  tax: number;
  excise: number;
  serviceCharge: number;
  taxWithheld: number;
  incomeTaxWithheld: number;
  total: number;
  netReceivable: number;
  lines: InvoicePreviewLine[];
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
  fiscalDocumentType?: string;
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
  fiscalDocumentTypes: FiscalDocumentTypeOption[];
  serviceChargeRate: number;
}

@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private http = inject(HttpClient);
  private readonly idempotency = inject(IdempotencyKeyService);
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

  /**
   * Price a document without creating it.
   *
   * Runs the same code that will issue it — catalogue tax rates, excise, the buyer's withholding
   * regime — and writes nothing, so the figures the operator sees while composing are the ones
   * that will be on the comprobante.
   */
  preview(invoice: CreateInvoiceDto): Observable<InvoicePreview> {
    return this.http.post<InvoicePreview>(`${this.apiUrl}/preview`, invoice);
  }

  updateDraft(id: string, invoice: CreateInvoiceDto): Observable<Invoice> {
    return this.http.put<Invoice>(`${this.apiUrl}/${id}`, invoice);
  }

  discardDraft(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /**
   * Assigns the fiscal number, posts the ledger entry and transmits the e-CF.
   *
   * The idempotency key is minted per invoice, not per call, and held until the issue succeeds.
   * Two clicks on "Emitir" therefore carry ONE key: the server executes once and replays its answer
   * to the second, instead of consuming two fiscal numbers and posting two journal entries for one
   * sale. A key minted inside the HTTP layer could not do this — it would be a different key each
   * time, which is exactly the case idempotency exists to cover.
   */
  issue(id: string, fiscalDocumentType?: string): Observable<Invoice> {
    const operation = `invoice:issue:${id}`;
    return this.http
      .post<Invoice>(
        `${this.apiUrl}/${id}/issue`,
        fiscalDocumentType ? { fiscalDocumentType } : {},
        { headers: { 'Idempotency-Key': this.idempotency.keyFor(operation) } },
      )
      .pipe(tap(() => this.idempotency.settle(operation)));
  }

  createCreditNote(invoiceId: string, request: CreditNoteRequest = {}): Observable<Invoice> {
    // Keyed by the invoice being credited AND the amount, so correcting the figure after a mistake
    // is a new intention rather than a replay of the previous answer.
    const operation = `invoice:credit-note:${invoiceId}:${JSON.stringify(request)}`;
    return this.http
      .post<Invoice>(`${this.apiUrl}/${invoiceId}/credit-note`, request, {
        headers: { 'Idempotency-Key': this.idempotency.keyFor(operation) },
      })
      .pipe(tap(() => this.idempotency.settle(operation)));
  }

  downloadInvoicePdf(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/pdf`, { responseType: 'blob' });
  }

  /** Readiness, currency, legal rates and issuable document types for this tenant's market. */
  context(): Observable<InvoicingContext> {
    return this.http.get<InvoicingContext>(`${this.apiUrl}/context`);
  }
}
