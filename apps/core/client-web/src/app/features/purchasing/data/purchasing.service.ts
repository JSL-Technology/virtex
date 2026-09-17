import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type PurchaseRequisitionStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED_TO_PO';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface PurchaseRequisitionLine {
  id?: string;
  productId?: string | null;
  description: string;
  quantity: number;
  estimatedUnitPrice: number;
  unitOfMeasure?: string;
}

export interface PurchaseRequisition {
  id: string;
  number: string;
  status: PurchaseRequisitionStatus;
  totalAmount: number;
  requiredDate: string | null;
  notes: string | null;
  requestedByUserId: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  purchaseOrderId: string | null;
  createdAt: string;
  lines: PurchaseRequisitionLine[];
}

export interface PurchaseOrderLine {
  id?: string;
  productId?: string | null;
  description: string;
  quantity: number;
  /** How much has arrived. Read-only: it moves through the receive endpoint. */
  receivedQuantity?: number;
  unitPrice: number;
  taxRate?: number;
  unitOfMeasure?: string;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplier?: { id: string; name: string } | null;
  orderDate: string;
  expectedDate: string | null;
  status: PurchaseOrderStatus;
  currencyCode: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  requisitionId: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  lines: PurchaseOrderLine[];
}

/** The envelope the API's `toPage` helper returns. */
export interface Paged<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Purchasing: requisitions and orders.
 *
 * ## What this replaces
 *
 * Nothing — there was no service, because there was nothing to call. Both screens carried their
 * rows as literals in the browser bundle: `PO-2025-001 OfiSuministros SRL $1,250.00 Sent` and
 * `REQ-001 Ana Pérez IT $2,500.00 Pending Approval`, the same seven documents for every tenant of
 * the product, with no table behind them and no way to create an eighth.
 */
@Injectable({ providedIn: 'root' })
export class PurchasingService {
  private readonly http = inject(HttpClient);
  private readonly requisitionsUrl = `${environment.apiUrl}/procurement/requisitions`;
  private readonly ordersUrl = `${environment.apiUrl}/procurement/orders`;

  // ── Requisitions ───────────────────────────────────────────────────────────

  listRequisitions(page = 1, pageSize = 50): Observable<Paged<PurchaseRequisition>> {
    return this.http.get<Paged<PurchaseRequisition>>(this.requisitionsUrl, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  getRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.get<PurchaseRequisition>(`${this.requisitionsUrl}/${id}`);
  }

  createRequisition(body: {
    requiredDate?: string;
    notes?: string;
    lines: PurchaseRequisitionLine[];
  }): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(this.requisitionsUrl, body);
  }

  updateRequisition(
    id: string,
    body: { requiredDate?: string; notes?: string; lines?: PurchaseRequisitionLine[] },
  ): Observable<PurchaseRequisition> {
    return this.http.patch<PurchaseRequisition>(`${this.requisitionsUrl}/${id}`, body);
  }

  submitRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.requisitionsUrl}/${id}/submit`, {});
  }

  approveRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.requisitionsUrl}/${id}/approve`, {});
  }

  rejectRequisition(id: string, reason: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.requisitionsUrl}/${id}/reject`, { reason });
  }

  reopenRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.requisitionsUrl}/${id}/reopen`, {});
  }

  deleteRequisition(id: string): Observable<void> {
    return this.http.delete<void>(`${this.requisitionsUrl}/${id}`);
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  listOrders(page = 1, pageSize = 50): Observable<Paged<PurchaseOrder>> {
    return this.http.get<Paged<PurchaseOrder>>(this.ordersUrl, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  getOrder(id: string): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(`${this.ordersUrl}/${id}`);
  }

  createOrder(body: {
    supplierId: string;
    orderDate?: string;
    expectedDate?: string;
    currencyCode?: string;
    notes?: string;
    lines: PurchaseOrderLine[];
  }): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(this.ordersUrl, body);
  }

  updateOrder(
    id: string,
    body: {
      supplierId?: string;
      orderDate?: string;
      expectedDate?: string;
      currencyCode?: string;
      notes?: string;
      lines?: PurchaseOrderLine[];
    },
  ): Observable<PurchaseOrder> {
    return this.http.patch<PurchaseOrder>(`${this.ordersUrl}/${id}`, body);
  }

  /** Turn an approved requisition into an order to one supplier. */
  orderFromRequisition(requisitionId: string, supplierId: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/from-requisition/${requisitionId}`, {
      supplierId,
    });
  }

  submitOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/submit`, {});
  }

  approveOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/approve`, {});
  }

  reopenOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/reopen`, {});
  }

  sendOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/send`, {});
  }

  receiveOrder(
    id: string,
    lines: { lineId: string; quantity: number }[],
  ): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/receive`, { lines });
  }

  cancelOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/cancel`, { reason });
  }

  deleteOrder(id: string): Observable<void> {
    return this.http.delete<void>(`${this.ordersUrl}/${id}`);
  }
}
