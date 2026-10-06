import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface BudgetSummary {
  id: string;
  name: string;
  period: string;
  updatedAt: string;
  lineCount: number;
  total: number;
}

export interface BudgetLine {
  id?: string;
  accountId: string;
  amount: number;
  dimensions?: Record<string, string>;
  account?: { id: string; code: string; name: unknown; type: string };
}

export interface Budget {
  id: string;
  name: string;
  period: string;
  version: number;
  lines: BudgetLine[];
}

export interface SaveBudget {
  name: string;
  period: string;
  lines: Array<{ accountId: string; amount: number; dimensions?: Record<string, string> }>;
}

export interface VarianceLine {
  accountId: string;
  accountCode: string | null;
  accountName: unknown;
  accountType: string | null;
  dimensions: Record<string, string> | null;
  budgetedAmount: number;
  actualAmount: number;
  difference: number;
  consumedRatio: number | null;
  months?: Record<string, number>;
}

export interface VarianceReport {
  period: { startDate: string; endDate: string; fromPeriod?: string; toPeriod?: string };
  ledger: { id: string; name: string; currency: string } | null;
  budgets?: Array<{ id: string; name: string; period: string }>;
  lines: VarianceLine[];
  totals: { budgeted: number; actual: number; difference: number };
}

/** Budgets (audit H-16): the monthly targets, and how actuals measure against them. */
@Injectable({ providedIn: 'root' })
export class BudgetsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/budgets`;

  list(): Observable<BudgetSummary[]> {
    return this.http.get<BudgetSummary[]>(this.url);
  }

  get(id: string): Observable<Budget> {
    return this.http.get<Budget>(`${this.url}/${id}`);
  }

  create(body: SaveBudget): Observable<Budget> {
    return this.http.post<Budget>(this.url, body);
  }

  update(id: string, body: Partial<SaveBudget>): Observable<Budget> {
    return this.http.patch<Budget>(`${this.url}/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  copy(id: string, periods: string[], factor?: number): Observable<BudgetSummary[]> {
    return this.http.post<BudgetSummary[]>(`${this.url}/${id}/copy`, { periods, ...(factor ? { factor } : {}) });
  }

  vsActual(id: string): Observable<VarianceReport> {
    return this.http.get<VarianceReport>(`${this.url}/${id}/vs-actual`);
  }

  variance(fromPeriod: string, toPeriod: string, ledgerId?: string | null): Observable<VarianceReport> {
    let params = new HttpParams().set('fromPeriod', fromPeriod).set('toPeriod', toPeriod);
    if (ledgerId) params = params.set('ledgerId', ledgerId);
    return this.http.get<VarianceReport>(`${this.url}/variance`, { params });
  }
}

/**
 * Whether a difference is good news. Over budget on income is good; on expense it is bad. Read
 * from the account's type, never from its name.
 */
export function isFavourable(line: Pick<VarianceLine, 'accountType' | 'difference'>): boolean {
  const income = line.accountType === 'REVENUE';
  return income ? line.difference <= 0 : line.difference >= 0;
}
