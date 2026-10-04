import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Product {
  id: string;
  name: string;
  sku?: string;
  price: number;
  stock: number;
  status: 'Active' | 'Inactive';
  /** 'GOOD' is stocked; 'SERVICE' is not. */
  kind?: 'GOOD' | 'SERVICE';
  /** How the item is taxed; only 'TAXED' items carry `taxRate`. */
  taxTreatment?: string;
  /** Consumption-tax rate as a fraction (0.18 = 18 %). */
  taxRate?: number;
}

export interface MyBranches {
  branches: { id: string; code: string; name: string; isHeadquarters: boolean }[];
  closed: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
  restricted: boolean;
}

export interface PosShift {
  id: string;
  terminalId: string;
  /** The branch the till stands in; every sale on the shift belongs to it. */
  branchId?: string | null;
  status: 'OPEN' | 'CLOSED';
  openingBalance: number;
  salesTotal: number;
  salesCount: number;
  cashSalesTotal?: number;
  expectedBalance?: number | null;
  closingBalance?: number | null;
  closingVariance?: number | null;
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
  paymentMethod?: string;
  customerName?: string;
}

/** Everything the terminal needs from the API: the catalogue, the shift, and ringing sales. */
@Injectable({ providedIn: 'root' })
export class PosApiService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  getProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.api}/inventory`);
  }

  getActiveShift(terminalId: string): Observable<PosShift | null> {
    return this.http.get<PosShift | null>(`${this.api}/pos/shifts/active`, { params: { terminalId } });
  }

  /** `branchId` omitted: the cashier's default branch, else the headquarters. */
  openShift(terminalId: string, openingBalance: number, branchId?: string | null): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.api}/pos/shifts`, {
      terminalId,
      openingBalance,
      ...(branchId ? { branchId } : {}),
    });
  }

  /** The branches this cashier may open a till in, and their default one. */
  myBranches(): Observable<MyBranches> {
    return this.http.get<MyBranches>(`${this.api}/organizations/branches/mine`);
  }

  closeShift(shiftId: string, closingBalance: number): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.api}/pos/shifts/${shiftId}/close`, { closingBalance });
  }

  /**
   * Ring a sale. `idempotencyKey` identifies THIS sale: a retry of the same cart after a lost
   * response sends the same key, so the server returns the sale it already recorded instead of
   * ringing — and moving the stock of — a second one.
   */
  processSale(payload: ProcessSalePayload, idempotencyKey: string): Observable<{ id: string; total: number }> {
    return this.http.post<{ id: string; total: number }>(`${this.api}/pos/sales`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  /** The tenant's invoicing context (currency + tax rate), reused so the till taxes correctly. */
  invoicingContext(): Observable<{ baseCurrency?: string; taxRates?: number[] }> {
    return this.http.get<{ baseCurrency?: string; taxRates?: number[] }>(`${this.api}/invoices/context`);
  }
}
