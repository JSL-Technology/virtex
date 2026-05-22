import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface InvoiceLineItem {
  id?: string;
  productId?: string;
  description: string;
  quantity: number;
  price: number;
  taxRate?: number;
  taxAmount?: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  ncfNumber?: string;
  customerName: string;
  customerAddress: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  balance: number;
  currencyCode: string;
  status: 'Draft' | 'Pending' | 'Paid' | 'Partially Paid' | 'Void' | 'Credit Note';
  type: 'INVOICE' | 'CREDIT_NOTE';
  lineItems: InvoiceLineItem[];
  notes?: string;
  originalInvoiceId?: string;
}

// DTO ya no incluye totales, se calculan en backend
export interface CreateInvoiceDto {
    customerId: string;
    issueDate: string;
    dueDate: string;
    notes?: string;
    currencyCode?: string;
    lineItems: {
        productId: string;
        quantity: number;
        price: number;
        description: string;
        taxRate?: number;
    }[];
}


@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/invoices`;

  getInvoices(): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(this.apiUrl);
  }

  getInvoiceById(id: string): Observable<Invoice> {
    return this.http.get<Invoice>(`${this.apiUrl}/${id}`);
  }

  createInvoice(invoiceData: CreateInvoiceDto): Observable<Invoice> {
    return this.http.post<Invoice>(this.apiUrl, invoiceData);
  }

  createCreditNote(invoiceId: string): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.apiUrl}/${invoiceId}/credit-note`, {});
  }

  downloadInvoicePdf(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/pdf`, { responseType: 'blob' });
  }

  getInvoiceNavigation(currentId: string): Observable<{ first: string, prev: string, next: string, last: string }> {
    return this.getInvoices().pipe(
      map(invoices => {
        const sorted = [...invoices].sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());
        const index = sorted.findIndex(inv => inv.id === currentId);
        return {
          first: sorted[0]?.id,
          prev: sorted[index - 1]?.id || sorted[0]?.id,
          next: sorted[index + 1]?.id || sorted[sorted.length - 1]?.id,
          last: sorted[sorted.length - 1]?.id
        };
      })
    );
  }
}