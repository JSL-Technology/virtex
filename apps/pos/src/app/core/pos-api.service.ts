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
}

export interface PosShift {
  id: string;
  terminalId: string;
  status: 'OPEN' | 'CLOSED';
  openingBalance: number;
  salesTotal: number;
  salesCount: number;
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

  openShift(terminalId: string, openingBalance: number): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.api}/pos/shifts`, { terminalId, openingBalance });
  }

  closeShift(shiftId: string, closingBalance: number): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.api}/pos/shifts/${shiftId}/close`, { closingBalance });
  }

  processSale(payload: ProcessSalePayload): Observable<{ id: string; total: number }> {
    return this.http.post<{ id: string; total: number }>(`${this.api}/pos/sales`, payload);
  }

  /** The tenant's invoicing context (currency + tax rate), reused so the till taxes correctly. */
  invoicingContext(): Observable<{ baseCurrency?: string; taxRates?: number[] }> {
    return this.http.get<{ baseCurrency?: string; taxRates?: number[] }>(`${this.api}/invoices/context`);
  }
}
