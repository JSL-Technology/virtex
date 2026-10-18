import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface CashflowRun {
  id: string;
  kind: 'CASHFLOW' | 'SCENARIO';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface CashflowDriver {
  kind: 'RECEIVABLE' | 'PAYABLE';
  documentId: string;
  partyName: string;
  amount: number;
  dueDate: string;
  pBy30: number;
  doubtful: boolean;
}

export interface CashflowMetrics {
  openingCash: number;
  threshold: number;
  horizonDays: number;
  endP10: number;
  endP50: number;
  endP90: number;
  lowestP50: number;
  lowestP50Date: string;
  lowestP10: number;
  shortfallProbability: number;
  firstLikelyShortfallDate: string | null;
  expectedInflow: number;
  expectedOutflow: number;
  byComponent: Record<string, number>;
  drivers: CashflowDriver[];
  documents?: { receivables: number; payables: number };
  history?: { receipts: number; payments: number };
  scenario?: CashflowScenarioInput;
}

export interface CashflowDay {
  day: string;
  p10: number;
  p50: number;
  p90: number;
  inflow: number;
  outflow: number;
  components: Record<string, number>;
}

export interface CashflowProjection {
  runId: string;
  createdAt: string;
  finishedAt: string | null;
  baseCurrency: string | null;
  asOfDate: string | null;
  metrics: CashflowMetrics;
  days: CashflowDay[];
}

export interface CashflowOverview {
  latest: CashflowRun | null;
  projection: CashflowProjection | null;
}

export interface CashflowDocument {
  id: string;
  kind: 'RECEIVABLE' | 'PAYABLE';
  documentId: string;
  partyName: string;
  number: string | null;
  dueDate: string;
  amount: number;
  expectedDate: string | null;
  pBy7: number;
  pBy30: number;
  pInHorizon: number;
  doubtful: boolean;
}

export interface CashflowScenarioInput {
  salesChange?: number;
  collectionDelayDays?: number;
  extraMonthlyExpense?: number;
  oneOffAmount?: number;
  oneOffDay?: number;
}

export interface CashflowScenarioResult {
  run: CashflowRun;
  scenario: CashflowProjection | null;
  baseline: CashflowProjection | null;
}

export interface AiReport {
  id: string;
  kind: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  content: {
    title: string;
    summary: string;
    sections: Array<{ heading: string; body: string }>;
    recommendations: Array<{ action: string; why: string }>;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class CashflowService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai/cashflow`;

  overview(): Observable<CashflowOverview> {
    return this.http.get<CashflowOverview>(this.url);
  }

  refresh(threshold = 0): Observable<CashflowRun> {
    return this.http.post<CashflowRun>(`${this.url}/runs`, { threshold });
  }

  documents(kind: 'RECEIVABLE' | 'PAYABLE', sort: 'amount' | 'risk' | 'expected', limit = 25, offset = 0): Observable<{ total: number; items: CashflowDocument[] }> {
    const params = new HttpParams().set('kind', kind).set('sort', sort).set('limit', limit).set('offset', offset);
    return this.http.get<{ total: number; items: CashflowDocument[] }>(`${this.url}/documents`, { params });
  }

  runScenario(input: CashflowScenarioInput, threshold = 0): Observable<CashflowRun> {
    return this.http.post<CashflowRun>(`${this.url}/scenarios`, { ...input, threshold });
  }

  /** Have the scenario explained against the projection (written in the background). */
  requestScenarioNarrative(id: string): Observable<AiReport> {
    return this.http.post<AiReport>(`${this.url}/scenarios/${id}/narrative`, {});
  }

  scenarioNarrative(id: string): Observable<AiReport | null> {
    return this.http.get<AiReport | null>(`${this.url}/scenarios/${id}/narrative`);
  }

  scenario(id: string): Observable<CashflowScenarioResult> {
    return this.http.get<CashflowScenarioResult>(`${this.url}/scenarios/${id}`);
  }

  requestPlan(): Observable<AiReport> {
    return this.http.post<AiReport>(`${this.url}/plan`, {});
  }

  plan(): Observable<AiReport | null> {
    return this.http.get<AiReport | null>(`${this.url}/plan`);
  }
}
