import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type StockDocumentStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export type StockMovementType =
  | 'OPENING'
  | 'PURCHASE_RECEIPT'
  | 'PURCHASE_RETURN'
  | 'SALE_DISPATCH'
  | 'SALE_RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';

export const STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'SALE_DISPATCH',
  'SALE_RETURN',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
];

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface StockOnHandRow {
  productId: string;
  sku: string | null;
  name: string;
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: number;
  reorderLevel: number | null;
  unitCost: number;
  value: number;
}

export interface StockMovementRow {
  id: string;
  date: string;
  productId: string;
  sku: string | null;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  type: StockMovementType;
  reference: string;
  sourceType: string | null;
  sourceId: string | null;
  quantity: number;
  unitCost: number;
  value: number;
  balance: number;
}

export interface StockOnHandQuery {
  warehouseId?: string | null;
  productId?: string | null;
  search?: string;
  includeZero?: boolean;
  page?: number;
  limit?: number;
}

export interface StockMovementsQuery {
  productId?: string | null;
  warehouseId?: string | null;
  from?: string | null;
  to?: string | null;
  type?: StockMovementType | null;
  page?: number;
  limit?: number;
}

export interface InventoryAdjustmentLine {
  id?: string;
  productId: string;
  productName?: string;
  sku?: string | null;
  countedQuantity: number | null;
  quantityChange: number;
  quantityBefore?: number | null;
  unitCost: number | null;
  newUnitCost: number | null;
  valueChange?: number | null;
  /** What the warehouse holds now; only on a draft. */
  onHand?: number | null;
}

export interface InventoryAdjustment {
  id: string;
  number: string;
  date: string;
  warehouseId: string;
  warehouseName: string | null;
  reason: string;
  notes: string | null;
  status: StockDocumentStatus;
  valueChange: number | null;
  journalEntryId: string | null;
  postedAt: string | null;
  lineCount?: number;
  lines?: InventoryAdjustmentLine[];
}

export interface SaveInventoryAdjustment {
  date: string;
  warehouseId: string;
  reason: string;
  notes?: string;
  lines: Array<{
    productId: string;
    countedQuantity?: number | null;
    quantityChange?: number | null;
    unitCost?: number | null;
    newUnitCost?: number | null;
  }>;
}

export interface StockTransferLine {
  id?: string;
  productId: string;
  productName?: string;
  sku?: string | null;
  quantity: number;
  /** What the origin holds now; only on a draft. */
  available?: number | null;
}

export interface StockTransfer {
  id: string;
  number: string;
  date: string;
  fromWarehouseId: string;
  fromWarehouseName: string | null;
  toWarehouseId: string;
  toWarehouseName: string | null;
  notes: string | null;
  status: StockDocumentStatus;
  postedAt: string | null;
  lineCount?: number;
  lines?: StockTransferLine[];
}

export interface SaveStockTransfer {
  date: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  notes?: string;
  lines: Array<{ productId: string; quantity: number }>;
}

function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
  }
  return params;
}

/**
 * Stock: what each warehouse holds, the kardex, and the adjustment and transfer documents.
 *
 * The quantity on hand is never written from here: it is the sum of the movements the server
 * records when a document is posted.
 */
@Injectable({ providedIn: 'root' })
export class StockService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/inventory`;

  onHand(query: StockOnHandQuery = {}): Observable<Paged<StockOnHandRow> & { totalValue: number }> {
    return this.http.get<Paged<StockOnHandRow> & { totalValue: number }>(`${this.url}/stock`, { params: toParams(query) });
  }

  movements(query: StockMovementsQuery = {}): Observable<Paged<StockMovementRow> & { openingBalance: number | null }> {
    return this.http.get<Paged<StockMovementRow> & { openingBalance: number | null }>(`${this.url}/movements`, {
      params: toParams(query),
    });
  }

  adjustments(query: { status?: StockDocumentStatus; warehouseId?: string } = {}): Observable<InventoryAdjustment[]> {
    return this.http.get<InventoryAdjustment[]>(`${this.url}/adjustments`, { params: toParams(query) });
  }

  adjustment(id: string): Observable<InventoryAdjustment> {
    return this.http.get<InventoryAdjustment>(`${this.url}/adjustments/${id}`);
  }

  createAdjustment(body: SaveInventoryAdjustment): Observable<InventoryAdjustment> {
    return this.http.post<InventoryAdjustment>(`${this.url}/adjustments`, body);
  }

  updateAdjustment(id: string, body: SaveInventoryAdjustment): Observable<InventoryAdjustment> {
    return this.http.patch<InventoryAdjustment>(`${this.url}/adjustments/${id}`, body);
  }

  postAdjustment(id: string): Observable<InventoryAdjustment> {
    return this.http.post<InventoryAdjustment>(`${this.url}/adjustments/${id}/post`, {});
  }

  cancelAdjustment(id: string): Observable<InventoryAdjustment> {
    return this.http.post<InventoryAdjustment>(`${this.url}/adjustments/${id}/cancel`, {});
  }

  transfers(query: { status?: StockDocumentStatus; warehouseId?: string } = {}): Observable<StockTransfer[]> {
    return this.http.get<StockTransfer[]>(`${this.url}/transfers`, { params: toParams(query) });
  }

  transfer(id: string): Observable<StockTransfer> {
    return this.http.get<StockTransfer>(`${this.url}/transfers/${id}`);
  }

  createTransfer(body: SaveStockTransfer): Observable<StockTransfer> {
    return this.http.post<StockTransfer>(`${this.url}/transfers`, body);
  }

  updateTransfer(id: string, body: SaveStockTransfer): Observable<StockTransfer> {
    return this.http.patch<StockTransfer>(`${this.url}/transfers/${id}`, body);
  }

  postTransfer(id: string): Observable<StockTransfer> {
    return this.http.post<StockTransfer>(`${this.url}/transfers/${id}/post`, {});
  }

  cancelTransfer(id: string): Observable<StockTransfer> {
    return this.http.post<StockTransfer>(`${this.url}/transfers/${id}/cancel`, {});
  }
}
