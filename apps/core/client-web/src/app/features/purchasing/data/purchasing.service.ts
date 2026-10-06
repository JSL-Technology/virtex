import { BranchesService } from '../../../core/tenancy/branches.service';
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
  /** How much the supplier has invoiced. Read-only: it moves when a bill for the order is approved. */
  billedQuantity?: number;
  unitPrice: number;
  taxRate?: number;
  unitOfMeasure?: string;
}

export type GoodsReceiptStatus = 'POSTED' | 'VOID';

export interface PurchaseOrderReceipt {
  id: string;
  /** `GR-2026-000042`. */
  number: string;
  status: GoodsReceiptStatus;
  receivedAt: string;
  receivedByUserId: string | null;
  warehouseId: string | null;
  journalEntryId: string | null;
  notes: string | null;
  lines: Array<{
    lineId: string;
    productId: string | null;
    description: string;
    quantity: number;
    unitCost: number;
    stocked: boolean;
  }>;
}

/** A goods receipt as the list shows it. */
export interface GoodsReceiptRow {
  id: string;
  number: string;
  receivedAt: string;
  status: GoodsReceiptStatus;
  orderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string | null;
  warehouseId: string | null;
  branchId: string | null;
  journalEntryId: string | null;
  lineCount: number;
  /** In the books' currency, at the cost each line came in at. */
  value: number;
}

/** A goods receipt as its own page shows it: with how much of each line the order has billed. */
export interface GoodsReceipt {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  receivedAt: string;
  receivedByUserId: string | null;
  orderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string | null;
  currencyCode: string;
  warehouseId: string | null;
  branchId: string | null;
  notes: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  value: number;
  lines: Array<{
    lineId: string;
    productId: string | null;
    description: string;
    quantity: number;
    unitCost: number;
    value: number;
    stocked: boolean;
    ordered: number | null;
    receivedOnOrder: number | null;
    billedOnOrder: number | null;
  }>;
}

export interface GoodsReceiptQuery {
  supplierId?: string | null;
  orderId?: string | null;
  warehouseId?: string | null;
  branchId?: string | null;
  status?: GoodsReceiptStatus | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  limit?: number;
}

export interface CreateGoodsReceipt {
  orderId: string;
  lines: { lineId: string; quantity: number }[];
  receivedAt?: string;
  warehouseId?: string;
  notes?: string;
}

/** The list endpoints for receipts page with `limit`; orders, older, with `pageSize`. */
export interface ReceiptsPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
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
  /** Why the last approver sent it back to draft; cleared when it is submitted again. */
  rejectionReason: string | null;
  notes: string | null;
  /** The ordering branch; null for a company without branches. */
  branchId?: string | null;
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
  private readonly receiptsUrl = `${environment.apiUrl}/procurement/receipts`;

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

  listOrders(
    page = 1,
    pageSize = 50,
    branchId?: string | null,
    filters: { receivable?: boolean; supplierId?: string | null } = {},
  ): Observable<Paged<PurchaseOrder>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (filters.receivable) params = params.set('receivable', 'true');
    if (filters.supplierId) params = params.set('supplierId', filters.supplierId);
    return this.http.get<Paged<PurchaseOrder>>(this.ordersUrl, { params: BranchesService.params(branchId, params) });
  }

  getOrder(id: string): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(`${this.ordersUrl}/${id}`);
  }

  createOrder(body: {
    supplierId: string;
    orderDate?: string;
    expectedDate?: string;
    currencyCode?: string;
    branchId?: string;
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
      branchId?: string;
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

  /** Sends a pending order back to draft with the approver's reason. */
  rejectOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/reject`, { reason });
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
    extra: { receivedAt?: string; notes?: string } = {},
  ): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/receive`, { lines, ...extra });
  }

  /** The deliveries recorded against an order, newest first, each with the entry it posted. */
  orderReceipts(id: string): Observable<PurchaseOrderReceipt[]> {
    return this.http.get<PurchaseOrderReceipt[]>(`${this.ordersUrl}/${id}/receipts`);
  }

  // ── Goods receipts ─────────────────────────────────────────────────────────

  receipts(query: GoodsReceiptQuery = {}): Observable<ReceiptsPage<GoodsReceiptRow>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<ReceiptsPage<GoodsReceiptRow>>(this.receiptsUrl, { params });
  }

  receipt(id: string): Observable<GoodsReceipt> {
    return this.http.get<GoodsReceipt>(`${this.receiptsUrl}/${id}`);
  }

  /** Record a delivery against an order; answers with the receipt it became. */
  createReceipt(body: CreateGoodsReceipt): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(this.receiptsUrl, body);
  }

  /** Undo a receipt not yet billed: the stock goes back out and the order is owed it again. */
  voidReceipt(id: string, reason: string, reversalDate?: string): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(`${this.receiptsUrl}/${id}/void`, { reason, reversalDate });
  }

  cancelOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.ordersUrl}/${id}/cancel`, { reason });
  }

  deleteOrder(id: string): Observable<void> {
    return this.http.delete<void>(`${this.ordersUrl}/${id}`);
  }
}
