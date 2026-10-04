import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { InvoicePreview } from '../../../../core/services/invoices';

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'INVOICED' | 'CANCELLED';

export interface QuoteLine {
  id?: string;
  lineOrder: number;
  product?: { id: string; name?: string } | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  status: QuoteStatus;
  /** Draft or sent, past its validity date. */
  expired: boolean;
  customer: { id: string; companyName?: string; name?: string } | null;
  issueDate: string;
  expiryDate: string;
  currencyCode: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  documentDiscountRate: number;
  notes: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  invoiceId: string | null;
  /** Where it was quoted from; null for a company without branches. */
  branchId?: string | null;
  lines: QuoteLine[];
}

export interface QuoteLineInput {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate?: number;
}

export interface QuoteInput {
  customerId: string;
  issueDate: string;
  expiryDate: string;
  currencyCode?: string;
  /** The quoting branch. Omitted: the person's default branch, else the headquarters. */
  branchId?: string;
  documentDiscountRate?: number;
  notes?: string;
  lines: QuoteLineInput[];
}

/** Sales quotes (`/sales/quotes`). Totals come from the invoice engine on the server. */
@Injectable({ providedIn: 'root' })
export class QuotesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/sales/quotes`;

  list(status?: QuoteStatus, branchId?: string | null): Observable<Quote[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (branchId) params = params.set('branchId', branchId);
    return this.http.get<Quote[]>(this.url, { params });
  }

  get(id: string): Observable<Quote> {
    return this.http.get<Quote>(`${this.url}/${id}`);
  }

  preview(input: QuoteInput): Observable<InvoicePreview> {
    return this.http.post<InvoicePreview>(`${this.url}/preview`, input);
  }

  create(input: QuoteInput): Observable<Quote> {
    return this.http.post<Quote>(this.url, input);
  }

  update(id: string, input: QuoteInput): Observable<Quote> {
    return this.http.patch<Quote>(`${this.url}/${id}`, input);
  }

  markSent(id: string): Observable<Quote> {
    return this.http.post<Quote>(`${this.url}/${id}/send`, {});
  }

  accept(id: string): Observable<Quote> {
    return this.http.post<Quote>(`${this.url}/${id}/accept`, {});
  }

  reject(id: string, reason: string): Observable<Quote> {
    return this.http.post<Quote>(`${this.url}/${id}/reject`, { reason });
  }

  cancel(id: string, reason?: string): Observable<Quote> {
    return this.http.post<Quote>(`${this.url}/${id}/cancel`, reason ? { reason } : {});
  }

  duplicate(id: string): Observable<Quote> {
    return this.http.post<Quote>(`${this.url}/${id}/duplicate`, {});
  }

  convertToInvoice(id: string): Observable<{ id: string; invoiceNumber?: string }> {
    return this.http.post<{ id: string; invoiceNumber?: string }>(`${this.url}/${id}/convert-to-invoice`, {});
  }
}
