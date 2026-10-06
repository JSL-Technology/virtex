import { BranchesService } from '../../../core/tenancy/branches.service';
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface PosShift {
  id: string;
  terminalId: string;
  status: 'OPEN' | 'CLOSED';
  /** The branch the till stands in; every sale on the shift belongs to it. */
  branchId?: string | null;
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

export interface PosSale {
  id: string;
  terminalId: string;
  shiftId: string | null;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string | null;
  customerName: string | null;
  invoiceId: string | null;
  status: string;
  createdAt: string;
  /** The branch of the till; null for a company without branches. */
  branchId?: string | null;
}

/**
 * Client for the POS backend (shifts + till sales). Wires the existing point-of-sale screen to the
 * consolidated `/pos` API so a sale is persisted and stock is moved, instead of only being logged.
 */
@Injectable({ providedIn: 'root' })
export class PosService {
  private readonly apiUrl = `${environment.apiUrl}/pos`;
  private readonly http = inject(HttpClient);

  getActiveShift(terminalId: string): Observable<PosShift | null> {
    return this.http.get<PosShift | null>(`${this.apiUrl}/shifts/active`, {
      params: { terminalId },
    });
  }

  /** `branchId` omitted: the cashier's default branch, else the headquarters. */
  openShift(terminalId: string, openingBalance: number, branchId?: string | null): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.apiUrl}/shifts`, {
      terminalId,
      openingBalance,
      ...(branchId ? { branchId } : {}),
    });
  }

  closeShift(shiftId: string, closingBalance: number): Observable<PosShift> {
    return this.http.post<PosShift>(`${this.apiUrl}/shifts/${shiftId}/close`, { closingBalance });
  }

  processSale(payload: ProcessSalePayload): Observable<PosSale> {
    return this.http.post<PosSale>(`${this.apiUrl}/sales`, payload);
  }

  /** Till sales, newest first. `shiftId` narrows to one drawer session. */
  listSales(shiftId?: string, branchId?: string | null): Observable<PosSale[]> {
    const params = BranchesService.params(branchId, shiftId ? new HttpParams().set('shiftId', shiftId) : undefined);
    return this.http.get<PosSale[]>(`${this.apiUrl}/sales`, { params });
  }
}
