import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ConsolidatedLine {
  accountId: string;
  code: string;
  name: Record<string, string> | string;
  type: string;
  amount: number;
  contributions: { organizationId: string; legalName: string; amount: number }[];
}

export interface Elimination {
  kind: 'INTRAGROUP_BALANCE' | 'INVESTMENT_IN_SUBSIDIARY' | 'INTRAGROUP_TRANSACTION';
  description: string;
  amount: number;
  organizationIds: string[];
  entries: { side: 'DEBIT' | 'CREDIT'; code: string; label: string; amount: number }[];
}

export interface ConsolidatedStatements {
  runId?: string;
  consolidationDate: string;
  period: { startDate: string; endDate: string };
  presentationCurrency: string;
  parentOrganization: { id: string; legalName: string };
  entities: Array<{
    organizationId: string;
    legalName: string;
    role: 'PARENT' | 'SUBSIDIARY';
    functionalCurrency: string;
    ownership: number;
    acquisitionDate: string | null;
    rates: { closing: number; average: number; historical: number };
    presented: { assets: number; liabilities: number; equity: number; netIncome: number };
  }>;
  balanceSheet: {
    assets: ConsolidatedLine[];
    liabilities: ConsolidatedLine[];
    equity: ConsolidatedLine[];
    goodwill: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    equityAttributableToParent: number;
    nonControllingInterests: number;
    accumulatedTranslationAdjustment: number;
    isBalanced: boolean;
    outOfBalanceBy: number;
  };
  incomeStatement: {
    revenue: ConsolidatedLine[];
    expenses: ConsolidatedLine[];
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    attributableToParent: number;
    attributableToNonControlling: number;
  };
  eliminations: Elimination[];
  warnings: { code: string; organizationId: string; detail: string }[];
}

export interface ConsolidationRunSummary {
  id: string;
  startDate: string;
  asOfDate: string;
  presentationCurrency: string;
  isBalanced: boolean;
  totalAssets: number;
  totalEquity: number;
  nonControllingInterests: number;
  goodwill: number;
  translationReserve: number;
  netIncome: number;
  warningCount: number;
  createdAt: string;
}

/** Group consolidation (FINB-33): run, keep and review the group's statements. */
@Injectable({ providedIn: 'root' })
export class ConsolidationApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/consolidation`;

  run(asOfDate: string, startDate: string): Observable<ConsolidatedStatements> {
    return this.http.post<ConsolidatedStatements>(`${this.url}/run`, { asOfDate, startDate });
  }

  runs(limit = 25): Observable<ConsolidationRunSummary[]> {
    return this.http.get<ConsolidationRunSummary[]>(`${this.url}/runs`, { params: new HttpParams().set('limit', limit) });
  }

  run$(id: string): Observable<{ result: ConsolidatedStatements; id: string }> {
    return this.http.get<{ result: ConsolidatedStatements; id: string }>(`${this.url}/runs/${id}`);
  }
}
