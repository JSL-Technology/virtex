import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** One sellable item, priced and taxed by the server (`GET /pos/catalog`). */
export interface CatalogueItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Unit price before tax. */
  price: number;
  /** The rate the server will tax a line at, already resolved — the till never re-derives it. */
  taxRate: number;
  /** 'GOOD' is stocked; 'SERVICE' is not, and is never out of stock. */
  kind: 'GOOD' | 'SERVICE';
  stock: number;
  unitOfMeasure: string;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

/** `GET /pos/context`. */
export interface PosContext {
  organization: {
    legalName: string | null;
    taxId: string | null;
    country: string | null;
  };
  currency: string;
  standardTaxRate: number;
  taxRequiresConfiguration: boolean;
}

export interface MyBranches {
  branches: {
    id: string;
    code: string;
    name: string;
    isHeadquarters: boolean;
  }[];
  closed: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
  restricted: boolean;
}

export interface PosShift {
  id: string;
  terminalId: string;
  userId: string;
  /** The branch the till stands in; every sale on the shift belongs to it. */
  branchId?: string | null;
  status: 'OPEN' | 'CLOSED';
  openingBalance: number;
  salesTotal: number;
  salesCount: number;
  cashSalesTotal?: number;
  voidedTotal?: number;
  voidedCount?: number;
  expectedBalance?: number | null;
  closingBalance?: number | null;
  closingVariance?: number | null;
  openedAt: string;
  closedAt?: string | null;
}

export type TenderMethod = 'cash' | 'card' | 'transfer' | 'other';

/** One tender of a sale. */
export interface PosPayment {
  method: TenderMethod;
  amount: number;
  reference?: string | null;
}

export interface PosSaleItemPayload {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
}

export interface ProcessSalePayload {
  terminalId: string;
  items: PosSaleItemPayload[];
  subtotal: number;
  tax: number;
  total: number;
  customerName?: string;
  payments: PosPayment[];
}

/** A line as the server priced and stored it. */
export interface PosSaleLine {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
}

export interface PosSale {
  id: string;
  terminalId: string;
  shiftId: string | null;
  branchId?: string | null;
  cashierId: string | null;
  items: PosSaleLine[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string | null;
  customerName: string | null;
  payments: PosPayment[];
  amountTendered: number | null;
  changeDue: number;
  status: 'PAID' | 'CANCELLED';
  voidedAt?: string | null;
  voidReason?: string | null;
  createdAt: string;
}

/** The X report of an open shift, the Z report of a closed one. */
export interface ShiftReport {
  shift: PosShift;
  salesCount: number;
  subtotal: number;
  tax: number;
  total: number;
  byMethod: Record<TenderMethod, number>;
  itemsSold: number;
  averageTicket: number;
  voidedCount: number;
  voidedTotal: number;
  expectedCash: number;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    total: number;
  }>;
}

/**
 * Everything the terminal needs from the API. Only `pos:*` routes (plus the caller's own branches),
 * so a cashier's role needs nothing from the back office to sell.
 */
@Injectable({ providedIn: 'root' })
export class PosApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/pos`;

  catalogue(): Observable<CatalogueItem[]> {
    return this.http.get<CatalogueItem[]>(`${this.api}/catalog`);
  }

  context(): Observable<PosContext> {
    return this.http.get<PosContext>(`${this.api}/context`);
  }

  /** The branches this cashier may open a till in, and their default one. */
  myBranches(): Observable<MyBranches> {
    return this.http.get<MyBranches>(
      `${environment.apiUrl}/organizations/branches/mine`,
    );
  }

  activeShift(terminalId: string): Observable<PosShift | null> {
    return this.http.get<PosShift | null>(`${this.api}/shifts/active`, {
      params: { terminalId },
    });
  }

  /** `branchId` omitted: the cashier's default branch, else the headquarters. */
  openShift(
    terminalId: string,
    openingBalance: number,
    branchId?: string | null,
  ): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.api}/shifts`, {
      terminalId,
      openingBalance,
      ...(branchId ? { branchId } : {}),
    });
  }

  closeShift(shiftId: string, closingBalance: number): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.api}/shifts/${shiftId}/close`, {
      closingBalance,
    });
  }

  shiftReport(shiftId: string): Observable<ShiftReport> {
    return this.http.get<ShiftReport>(`${this.api}/shifts/${shiftId}/report`);
  }

  /**
   * Ring a sale. `idempotencyKey` identifies THIS sale: a retry of the same cart after a lost
   * response sends the same key, so the server returns the sale it already recorded instead of
   * ringing — and moving the stock of — a second one. The route requires it.
   */
  processSale(
    payload: ProcessSalePayload,
    idempotencyKey: string,
  ): Observable<PosSale> {
    return this.http.post<PosSale>(`${this.api}/sales`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  /** The shift's sales, newest first. */
  listSales(shiftId: string): Observable<PosSale[]> {
    return this.http.get<PosSale[]>(`${this.api}/sales`, {
      params: new HttpParams().set('shiftId', shiftId),
    });
  }

  /** Supervisor only (`pos:manage_shifts`), on an open shift, with a reason. */
  voidSale(
    saleId: string,
    reason: string,
    idempotencyKey: string,
  ): Observable<PosSale> {
    return this.http.post<PosSale>(
      `${this.api}/sales/${saleId}/void`,
      { reason },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  }
}
