import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';

export type SalesOrderStatus = 'CONFIRMED' | 'PARTIALLY_DELIVERED' | 'DELIVERED' | 'CLOSED' | 'CANCELLED';
export type DeliveryNoteStatus = 'POSTED' | 'INVOICED' | 'VOIDED';

export interface SalesOrderLine {
  id: string;
  lineOrder: number;
  productId: string | null;
  description: string;
  isStocked: boolean;
  quantity: number;
  deliveredQuantity: number;
  invoicedQuantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  lineTotal: number;
}

export interface DeliveryNoteLine {
  id: string;
  orderLineId: string;
  description: string;
  quantity: number;
}

export interface DeliveryNote {
  id: string;
  number: string;
  orderId: string;
  deliveryDate: string;
  status: DeliveryNoteStatus;
  invoiceId: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  receivedBy: string | null;
  voidReason: string | null;
  lines?: DeliveryNoteLine[];
  customer?: { id: string; companyName?: string };
  order?: { id: string; orderNumber: string };
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customer?: { id: string; companyName?: string; taxId?: string | null };
  quoteId: string | null;
  customerReference: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  status: SalesOrderStatus;
  notes: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  lines?: SalesOrderLine[];
  deliveries?: DeliveryNote[];
  invoiceable?: Array<{ orderLineId: string; quantity: number }>;
}

export interface DeliverPayload {
  deliveryDate?: string;
  lines: Array<{ orderLineId: string; quantity: number }>;
  driverName?: string;
  vehiclePlate?: string;
  deliveryAddress?: string;
  receivedBy?: string;
  notes?: string;
}

/** `/sales/orders`, `/sales/deliveries` — orders, their conduces and their invoicing. */
@Injectable({ providedIn: 'root' })
export class SalesOrdersService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/sales`;

  list(status?: SalesOrderStatus): Observable<SalesOrder[]> {
    return this.http.get<SalesOrder[]>(`${this.api}/orders`, { params: status ? new HttpParams().set('status', status) : undefined });
  }

  get(id: string): Observable<SalesOrder> {
    return this.http.get<SalesOrder>(`${this.api}/orders/${id}`);
  }

  fromQuote(quoteId: string): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(`${this.api}/quotes/${quoteId}/order`, {});
  }

  deliver(orderId: string, payload: DeliverPayload): Observable<DeliveryNote> {
    return this.http.post<DeliveryNote>(`${this.api}/orders/${orderId}/deliveries`, payload);
  }

  invoice(orderId: string, deliveryNoteIds?: string[]): Observable<{ id: string; fiscalNumber?: string; invoiceNumber?: string }> {
    return this.http.post<{ id: string; fiscalNumber?: string; invoiceNumber?: string }>(`${this.api}/orders/${orderId}/invoice`, deliveryNoteIds?.length ? { deliveryNoteIds } : {});
  }

  close(orderId: string): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(`${this.api}/orders/${orderId}/close`, {});
  }

  cancel(orderId: string, reason: string): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(`${this.api}/orders/${orderId}/cancel`, { reason });
  }

  deliveries(status?: DeliveryNoteStatus): Observable<DeliveryNote[]> {
    return this.http.get<DeliveryNote[]>(`${this.api}/deliveries`, { params: status ? new HttpParams().set('status', status) : undefined });
  }

  voidDelivery(id: string, reason: string): Observable<DeliveryNote> {
    return this.http.post<DeliveryNote>(`${this.api}/deliveries/${id}/void`, { reason });
  }

  /** The printable conduce (HTML) — fetched with the session, opened for printing. */
  printDelivery(id: string): Observable<string> {
    return this.http.get(`${this.api}/deliveries/${id}/print`, { responseType: 'text' });
  }
}
