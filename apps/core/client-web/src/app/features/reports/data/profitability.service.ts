import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** One product or one customer, with what it sold and what it cost. */
export interface ProfitabilityRow {
  id: string;
  /** SKU for a product, the recorded name for a customer. Absent for an ad-hoc line. */
  code: string | null;
  name: string;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  /** Percentage of revenue, or null when nothing was sold. */
  grossMargin: number | null;
}

export interface ProfitabilityReport {
  period: { startDate: string; endDate: string };
  /** The books' currency. Every figure is stated in it. */
  currency: string;
  rows: ProfitabilityRow[];
  totals: {
    unitsSold: number;
    totalRevenue: number;
    totalCost: number;
    grossProfit: number;
    grossMargin: number | null;
  };
  /** Lines that earned revenue at no recorded cost, so their margin overstates the truth. */
  linesWithoutCost: number;
}

/**
 * Gross margin by product and by customer.
 *
 * These two screens had no service to call: each held three invented rows — a laptop, a mouse, a
 * monitor — written into the component as a signal, and made no request at all. A tenant opening
 * either saw an imaginary company's figures presented as its own, and margin is the number a
 * business acts on.
 */
/** The period, and optionally one branch; omitted, every branch the reader may see. */
export interface ProfitabilityRange {
  startDate: string;
  endDate: string;
  branchId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProfitabilityApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/reports/profitability`;

  byProduct(range: ProfitabilityRange): Observable<ProfitabilityReport> {
    return this.http.get<ProfitabilityReport>(`${this.apiUrl}/by-product`, {
      params: this.params(range),
    });
  }

  byCustomer(range: ProfitabilityRange): Observable<ProfitabilityReport> {
    return this.http.get<ProfitabilityReport>(`${this.apiUrl}/by-customer`, {
      params: this.params(range),
    });
  }

  private params(range: ProfitabilityRange): HttpParams {
    const params = new HttpParams().set('startDate', range.startDate).set('endDate', range.endDate);
    return range.branchId ? params.set('branchId', range.branchId) : params;
  }
}
