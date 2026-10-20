import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { environment } from '../../../../environments/environment';

/** One tender of a till sale. */
export interface PosPayment {
  method: 'cash' | 'card' | 'transfer' | 'other';
  amount: number;
  reference?: string | null;
}

/** A till sale, as the back office reads it. */
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
  payments?: PosPayment[];
  amountTendered?: number | null;
  changeDue?: number;
  /** The branch of the till; null for a company without branches. */
  branchId?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

/**
 * The till's tickets, read-only, for the back office.
 *
 * Selling happens in the point-of-sale application (`apps/pos`), which is deployed apart from the
 * ERP; the ERP keeps the journal of what was sold — the list, the filters by branch and the export —
 * because reviewing the takings is back-office work.
 */
@Injectable({ providedIn: 'root' })
export class PosSalesService {
  private readonly apiUrl = `${environment.apiUrl}/pos`;
  private readonly http = inject(HttpClient);

  /** Till sales, newest first. `shiftId` narrows to one drawer session. */
  listSales(shiftId?: string, branchId?: string | null): Observable<PosSale[]> {
    const params = BranchesService.params(branchId, shiftId ? new HttpParams().set('shiftId', shiftId) : undefined);
    return this.http.get<PosSale[]>(`${this.apiUrl}/sales`, { params });
  }
}
