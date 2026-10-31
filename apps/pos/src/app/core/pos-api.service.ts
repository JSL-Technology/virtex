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
    address?: string | null;
    city?: string | null;
  };
  currency: string;
  standardTaxRate: number;
  taxRequiresConfiguration: boolean;
  /** Each sale is a fiscal document (e-CF in the DR): ask for the RNC, print the e-NCF and QR. */
  issuesFiscalDocuments?: boolean;
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
  /** The buyer's RNC or cédula, for a crédito fiscal (E31). */
  customerTaxId?: string;
  payments: PosPayment[];
  /** When the till rang it, for a sale captured offline and sent later. */
  capturedAt?: string;
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
  /**
   * `PENDING_SYNC` exists only on the till: a sale captured offline, waiting in the outbox. Its
   * fiscal document is issued when it reaches the server.
   */
  status: 'PAID' | 'CANCELLED' | 'PENDING_SYNC';
  voidedAt?: string | null;
  voidReason?: string | null;
  createdAt: string;
  invoiceId?: string | null;
  fiscalNumber?: string | null;
  fiscalDocumentType?: string | null;
  customerTaxId?: string | null;
  creditNoteId?: string | null;
  capturedAt?: string | null;
}

/** `GET /pos/sales/:id/fiscal` — what the ticket prints about the sale's comprobante. */
export interface PosFiscalStatus {
  saleId: string;
  fiscal: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  fiscalNumber: string | null;
  fiscalDocumentType: string | null;
  securityCode: string | null;
  qrUrl: string | null;
  status: string | null;
  signedAt: string | null;
  creditNoteId: string | null;
  creditNoteFiscalNumber: string | null;
  customer: { name: string | null; taxId: string | null };
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

  /** The sale's fiscal document: e-NCF, security code and timbre QR once signed. */
  fiscalStatus(saleId: string): Observable<PosFiscalStatus> {
    return this.http.get<PosFiscalStatus>(`${this.api}/sales/${saleId}/fiscal`);
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
