import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Which AI features the tenant's plan includes and the server can serve right now. */
export interface AiStatus {
  vision: { enabledByPlan: boolean; available: boolean };
  forecasting: { enabledByPlan: boolean; available: boolean };
  anomalies: { enabledByPlan: boolean; available: boolean; explanations: boolean };
  duplicateImageSearch: boolean;
}

/** One feature's use this month, by outcome. */
export interface AiUsageRow {
  feature: string;
  status: 'SUCCEEDED' | 'REFUSED' | 'FAILED';
  calls: number;
  credits: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiRunSummary {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  trigger: 'SCHEDULED' | 'MANUAL' | 'EVENT';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  engineVersion: string | null;
  series: number | null;
  medianWape: number | null;
  findings: number | null;
}

/** What the administrator's AI screen shows. */
export interface AiOverview {
  status: AiStatus;
  credits: { used: number; limit: number | null; unlimited: boolean; period: string } | null;
  usage: AiUsageRow[];
  runs: Record<'forecast' | 'anomaly', { latest: AiRunSummary | null; lastSucceeded: AiRunSummary | null }>;
  pending: { seriousAnomalies: number; openAnomalies: number; stockoutRisks: number };
}

/** A supplier's measured lead time over the last year. */
export interface SupplierLeadTime {
  supplierId: string;
  supplierName: string;
  receipts: number;
  medianDays: number;
  p90Days: number;
  minDays: number;
  maxDays: number;
  /** Share of receipts that arrived by the promised date; null when no order promised one. */
  onTimeRate: number | null;
  lastReceivedAt: string;
}

/** A proposed field and how sure the model was of it, 0–1. */
export interface Suggested<T> {
  value: T;
  confidence: number;
}

export interface ProductMatch {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  imageUrl: string | null;
  reason: 'barcode' | 'name' | 'image';
  similarity: number;
}

/** What the server proposes from a photo. Nothing has been created yet. */
export interface ProductSuggestion {
  imageId: string;
  isProductPhoto: boolean;
  name: Suggested<string>;
  description: Suggested<string>;
  brand: Suggested<string | null>;
  manufacturer: Suggested<string | null>;
  categoryId: Suggested<string | null>;
  unitOfMeasure: Suggested<string>;
  barcode: Suggested<string | null> & { check: 'valid' | 'invalid' | 'unchecked' };
  kind: Suggested<'GOOD' | 'SERVICE'>;
  taxTreatment: Suggested<'TAXED' | 'ZERO_RATED' | 'EXEMPT'>;
  taxRate: number;
  attributes: Record<string, string>;
  notes: string;
  possibleDuplicates: ProductMatch[];
  pricing: { typicalMarkup: number | null; sampleSize: number };
  reference: ExternalProductReference | null;
  model: string;
  requestId: string;
}

/** What a public product database says about a barcode. A reference to check, never saved as-is. */
export interface ExternalProductReference {
  source: 'open_food_facts';
  name: string | null;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  url: string;
}

export interface BarcodeLookup {
  code: string;
  check: 'valid' | 'invalid' | 'unchecked';
  existing: ProductMatch[];
  reference: ExternalProductReference | null;
}

export type InventoryStatus = 'STOCKOUT_RISK' | 'REORDER' | 'OVERSTOCK' | 'DEAD_STOCK' | 'OK';

export interface InventoryInsight {
  productId: string;
  productName: string;
  sku: string | null;
  warehouseId: string;
  warehouseName: string;
  branchId: string | null;
  branchName: string | null;
  onHand: number;
  avgDailyDemand: number;
  forecast30d: number;
  forecast30dP90: number;
  daysOfCover: number | null;
  stockoutDate: string | null;
  leadTimeDays: number | null;
  safetyStock: number;
  reorderPoint: number;
  suggestedOrderQty: number;
  serviceLevel: number;
  status: InventoryStatus;
  branchRank: number | null;
  model: string;
  accuracyWape: number | null;
  censoredDays: number;
}

export interface EngineRun {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  createdAt: string;
  finishedAt?: string | null;
  metrics?: Record<string, unknown> | null;
  error?: string | null;
}

export interface ForecastSummary {
  byStatus: Partial<Record<InventoryStatus, number>>;
  lastRun: EngineRun | null;
  lastSuccess: { id: string; finishedAt: string; metrics: Record<string, unknown> | null; engineVersion: string | null } | null;
}

export interface TopSeller {
  branchId: string | null;
  branchName: string;
  productId: string;
  productName: string;
  sku: string | null;
  forecast30d: number;
  onHand: number;
  rank: number;
}

export interface ForecastSeries {
  history: Array<{ date: string; quantity: number }>;
  forecast: Array<{ date: string; p10: number; p50: number; p90: number; model: string }>;
}

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalyStatus = 'OPEN' | 'CONFIRMED' | 'DISMISSED';

export interface Anomaly {
  id: string;
  detector: string;
  category: 'sales' | 'purchases' | 'inventory' | 'cash';
  severity: AnomalySeverity;
  score: number;
  entityType: string;
  entityId: string | null;
  branchId: string | null;
  occurredOn: string;
  evidence: Record<string, unknown>;
  explanation: string | null;
  status: AnomalyStatus;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Page<T> {
  total: number;
  items: T[];
}

/** The AI platform's HTTP client. The server decides what is allowed; this only asks. */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai`;

  status(): Observable<AiStatus> {
    return this.http.get<AiStatus>(`${this.url}/status`);
  }

  overview(): Observable<AiOverview> {
    return this.http.get<AiOverview>(`${this.url}/overview`);
  }

  suggestProductFromImage(file: File): Observable<ProductSuggestion> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<ProductSuggestion>(`${this.url}/products/from-image`, body);
  }

  /** The tenant's products carrying this barcode and, if enabled, a public reference. No credit spent. */
  lookupBarcode(code: string): Observable<BarcodeLookup> {
    return this.http.get<BarcodeLookup>(`${this.url}/products/barcode/${encodeURIComponent(code)}`);
  }

  forecastSummary(): Observable<ForecastSummary> {
    return this.http.get<ForecastSummary>(`${this.url}/forecasts/summary`);
  }

  insights(query: {
    branchId?: string;
    warehouseId?: string;
    status?: InventoryStatus | '';
    search?: string;
    sort?: 'risk' | 'top_sellers';
    limit?: number;
    offset?: number;
  }): Observable<Page<InventoryInsight>> {
    return this.http.get<Page<InventoryInsight>>(`${this.url}/forecasts/insights`, { params: toParams(query) });
  }

  supplierLeadTimes(): Observable<SupplierLeadTime[]> {
    return this.http.get<SupplierLeadTime[]>(`${this.url}/forecasts/supplier-lead-times`);
  }

  topByBranch(perBranch = 10): Observable<TopSeller[]> {
    return this.http.get<TopSeller[]>(`${this.url}/forecasts/top-by-branch`, { params: toParams({ perBranch }) });
  }

  series(productId: string, warehouseId: string, historyDays = 120): Observable<ForecastSeries> {
    return this.http.get<ForecastSeries>(`${this.url}/forecasts/series`, {
      params: toParams({ productId, warehouseId, historyDays }),
    });
  }

  runForecast(): Observable<EngineRun> {
    return this.http.post<EngineRun>(`${this.url}/forecasts/runs`, {});
  }

  anomalies(query: {
    status?: AnomalyStatus | '';
    severity?: AnomalySeverity | '';
    category?: string;
    limit?: number;
    offset?: number;
  }): Observable<Page<Anomaly> & { byStatus: Partial<Record<AnomalyStatus, number>> }> {
    return this.http.get<Page<Anomaly> & { byStatus: Partial<Record<AnomalyStatus, number>> }>(`${this.url}/anomalies`, {
      params: toParams(query),
    });
  }

  lastAnomalyRun(): Observable<EngineRun | null> {
    return this.http.get<EngineRun | null>(`${this.url}/anomalies/last-run`);
  }

  runAnomalies(): Observable<EngineRun> {
    return this.http.post<EngineRun>(`${this.url}/anomalies/runs`, {});
  }

  feedback(id: string, verdict: 'USEFUL' | 'FALSE_POSITIVE', comment?: string): Observable<Anomaly> {
    return this.http.post<Anomaly>(`${this.url}/anomalies/${id}/feedback`, { verdict, comment });
  }

  reopen(id: string): Observable<Anomaly> {
    return this.http.post<Anomaly>(`${this.url}/anomalies/${id}/reopen`, {});
  }

  explain(id: string): Observable<Anomaly> {
    return this.http.post<Anomaly>(`${this.url}/anomalies/${id}/explain`, {});
  }
}

function toParams(query: Record<string, string | number | undefined | null>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
  }
  return params;
}
