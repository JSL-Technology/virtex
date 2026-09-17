import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// Define las interfaces para los DTOs que vienen del backend
export interface WorkingCapitalDto {
  workingCapital: number;
  date: Date;
}

export interface QuickRatioDto {
  quickRatio: number;
  date: Date;
}

export interface CurrentRatioDto {
  currentRatio: number;
  date: Date;
}

export interface RoadDto {
  roa: number;
  date: Date;
}

export interface RoeDto {
  roe: number;
  date: Date;
}

export interface LeverageDto {
  leverage: number;
  date: Date;
}

export interface NetMarginDto {
  netMargin: number;
  date: Date;
}

export interface EbitdaDto {
  ebitda: number;
  date: Date;
}

export interface FcfDto {
  freeCashFlow: number;
  date: Date;
}

/** One month of a trend, keyed by the first day of the month. */
export interface TrendPoint {
  month: string;
  amount: number;
}

export interface BreakdownSlice {
  /** The account's or product's own name, as the tenant keeps it. */
  label: string;
  amount: number;
}

/** The dashboard's headline figures, each against a comparable previous period. */
export interface DashboardSummary {
  salesToday: number;
  salesTodayChange: number | null;
  pendingInvoices: number;
  pendingInvoicesAmount: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  activeCustomers: number;
  activeCustomersChange: number | null;
}

export interface BudgetVsActualPoint {
  month: string;
  budgeted: number;
  actual: number;
}

export interface InvoiceStatusSlice {
  status: string;
  count: number;
  amount: number;
}

export interface LowStockItem {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  reorderLevel: number | null;
}

export interface DashboardAlert {
  id: string;
  severity: 'critical' | 'warning';
  /** i18n key; the sentence is written in the reader's language, not the server's. */
  messageKey: string;
  params: Record<string, string | number>;
  route: string;
}

export interface CashFlowWaterfallDto {
  openingBalance: number;
  operatingIncome: number;
  costOfGoodsSold: number;
  operatingExpenses: number;
  investments: number;
  financing: number;
  endingBalance: number;
}


@Injectable({
  providedIn: 'root'
})
export class DashboardApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/dashboard`; // Asumiendo que el proxy está configurado para /api

  getWorkingCapital(): Observable<WorkingCapitalDto> {
    return this.http.get<WorkingCapitalDto>(`${this.apiUrl}/kpi/working-capital`);
  }

  getQuickRatio(): Observable<QuickRatioDto> {
    return this.http.get<QuickRatioDto>(`${this.apiUrl}/kpi/quick-ratio`);
  }

  getCurrentRatio(): Observable<CurrentRatioDto> {
    return this.http.get<CurrentRatioDto>(`${this.apiUrl}/kpi/current-ratio`);
  }

  getROA(): Observable<RoadDto> {
    return this.http.get<RoadDto>(`${this.apiUrl}/kpi/roa`);
  }

  getROE(): Observable<RoeDto> {
    return this.http.get<RoeDto>(`${this.apiUrl}/kpi/roe`);
  }

  getLeverage(): Observable<LeverageDto> {
    return this.http.get<LeverageDto>(`${this.apiUrl}/kpi/leverage`);
  }

  getNetMargin(): Observable<NetMarginDto> {
    return this.http.get<NetMarginDto>(`${this.apiUrl}/kpi/net-margin`);
  }

  getEBITDA(): Observable<EbitdaDto> {
    return this.http.get<EbitdaDto>(`${this.apiUrl}/kpi/ebitda`);
  }

  getFreeCashFlow(): Observable<FcfDto> {
    return this.http.get<FcfDto>(`${this.apiUrl}/kpi/fcf`);
  }

  getConsolidatedCashFlowWaterfall(): Observable<CashFlowWaterfallDto> {
    return this.http.get<CashFlowWaterfallDto>(`${this.apiUrl}/consolidated-cash-flow-waterfall`);
  }

  // ── Series de los gráficos ─────────────────────────────────────────────────
  //
  // Todas estas eran literales en el bundle: los mismos siete meses de ventas y el mismo desglose
  // de gastos para todos los clientes del producto.

  getSalesTrend(months = 12): Observable<TrendPoint[]> {
    return this.http.get<TrendPoint[]>(`${this.apiUrl}/sales-trend`, {
      params: new HttpParams().set('months', months),
    });
  }

  getExpenseBreakdown(months = 12, limit = 8): Observable<BreakdownSlice[]> {
    return this.http.get<BreakdownSlice[]>(`${this.apiUrl}/expense-breakdown`, {
      params: new HttpParams().set('months', months).set('limit', limit),
    });
  }

  getSummary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>(`${this.apiUrl}/summary`);
  }

  getBudgetVsActual(months = 12): Observable<BudgetVsActualPoint[]> {
    return this.http.get<BudgetVsActualPoint[]>(`${this.apiUrl}/budget-vs-actual`, {
      params: new HttpParams().set('months', months),
    });
  }

  getInvoiceStatusMix(): Observable<InvoiceStatusSlice[]> {
    return this.http.get<InvoiceStatusSlice[]>(`${this.apiUrl}/invoice-status`);
  }

  getTopProducts(months = 12, limit = 5): Observable<BreakdownSlice[]> {
    return this.http.get<BreakdownSlice[]>(`${this.apiUrl}/top-products`, {
      params: new HttpParams().set('months', months).set('limit', limit),
    });
  }

  getLowStock(limit = 10): Observable<LowStockItem[]> {
    return this.http.get<LowStockItem[]>(`${this.apiUrl}/low-stock`, {
      params: new HttpParams().set('limit', limit),
    });
  }

  getAlerts(): Observable<DashboardAlert[]> {
    return this.http.get<DashboardAlert[]>(`${this.apiUrl}/alerts`);
  }
}
