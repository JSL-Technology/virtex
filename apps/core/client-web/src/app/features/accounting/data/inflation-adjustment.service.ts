import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import type { InflationAdjustmentPolicy } from '@virtex/shared/types';
import { environment } from '../../../../environments/environment';
import { IdempotencyKeyService } from '../../../core/http/idempotency-key.service';

/** A general price index a market prescribes for restated statements. */
export interface PriceIndexSeries {
  code: string;
  country: string;
  currency: string;
  name: string;
  publisher: string;
  legalBasis: string;
}

/** The value of one month, as the company restates with it. */
export interface PriceIndexValue {
  period: string;
  /** Exact decimal text. */
  value: string;
  revision: number;
  source: 'PLATFORM' | 'COMPANY';
  valueId: string;
  publishedOn: string | null;
  reference: string | null;
  /** The company's own figure when the published one is used instead. */
  companyValue: { value: string; revision: number } | null;
}

export interface RestatementLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  postedAccountId: string;
  postedAccountCode: string;
  dimensions: Record<string, string> | null;
  historical: string;
  restated: string;
  bookBalance: string;
  adjustment: string;
  earliestOrigin: string | null;
}

export interface RestatementBlocker {
  key: string;
  params?: Record<string, unknown>;
}

export interface RestatementRunSummary {
  id: string;
  period: string;
  status: 'POSTED' | 'REVERSED';
  journalEntryId: string | null;
  reversalEntryId: string | null;
  netMonetaryResult: string;
  lineCount: number;
  ranAt: string;
  ranByUserId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  seriesCode: string;
  closingIndex: string;
}

export interface UsedIndexValue {
  value: string;
  revision: number;
  source: 'PLATFORM' | 'COMPANY';
  valueId: string;
}

export interface RestatementPlan {
  period: string;
  entryDate: string;
  ledgerId: string | null;
  ledgerName: string | null;
  currency: string | null;
  policy: InflationAdjustmentPolicy;
  seriesCode: string | null;
  seriesName: string | null;
  closingIndex: PriceIndexValue | null;
  missingIndexMonths: string[];
  lines: RestatementLine[];
  accounts: RestatementLine[];
  netMonetaryResult: string;
  netMonetaryAccountId: string | null;
  indexValues: Record<string, UsedIndexValue>;
  blockers: RestatementBlocker[];
}

export interface RestatementOutlook extends RestatementPlan {
  dueAtClose: boolean;
  run: RestatementRunSummary | null;
  current: boolean | null;
  replacement: RestatementPlan | null;
}

export interface RestatementRunDetail extends RestatementRunSummary {
  lines: RestatementLine[];
  indexValues: Record<string, UsedIndexValue>;
}

export interface PriceIndexEntry {
  period: string;
  value: string;
  publishedOn?: string;
  reference?: string;
}

/**
 * The restatement for inflation (IAS 29; FIN-AC-04) and the price indices it multiplies by.
 *
 * Posting, replacing and undoing a run carry one idempotency key per intention: a double click or a
 * retry after a dropped connection finds the run the first attempt posted.
 */
@Injectable({ providedIn: 'root' })
export class InflationAdjustmentService {
  private readonly http = inject(HttpClient);
  private readonly idempotency = inject(IdempotencyKeyService);
  private readonly base = `${environment.apiUrl}/accounting/inflation-adjustment`;
  private readonly indices = `${environment.apiUrl}/price-indices`;

  outlook(period: string): Observable<RestatementOutlook> {
    return this.http.get<RestatementOutlook>(`${this.base}/outlook`, { params: { period } });
  }

  runs(year?: number): Observable<RestatementRunSummary[]> {
    return this.http.get<RestatementRunSummary[]>(`${this.base}/runs`, { params: year ? { year } : {} });
  }

  run(id: string): Observable<RestatementRunDetail> {
    return this.http.get<RestatementRunDetail>(`${this.base}/runs/${id}`);
  }

  /** Restate the month; with `replace`, the month's run is reversed and the current figure booked. */
  post(period: string, replace: boolean): Observable<{ created: boolean; run: RestatementRunDetail }> {
    const operation = `inflation-adjustment:run:${period}:${replace ? 'replace' : 'new'}`;
    return this.http
      .post<{ created: boolean; run: RestatementRunDetail }>(
        `${this.base}/runs`,
        { period, replace },
        { headers: { 'Idempotency-Key': this.idempotency.keyFor(operation) } },
      )
      .pipe(tap(() => this.idempotency.settle(operation)));
  }

  reverse(id: string, reason: string): Observable<RestatementRunDetail> {
    const operation = `inflation-adjustment:reverse:${id}`;
    return this.http
      .post<RestatementRunDetail>(`${this.base}/runs/${id}/reverse`, { reason }, { headers: { 'Idempotency-Key': this.idempotency.keyFor(operation) } })
      .pipe(tap(() => this.idempotency.settle(operation)));
  }

  series(): Observable<PriceIndexSeries[]> {
    return this.http.get<PriceIndexSeries[]>(this.indices);
  }

  values(code: string, from: string, to: string): Observable<PriceIndexValue[]> {
    return this.http.get<PriceIndexValue[]>(`${this.indices}/${encodeURIComponent(code)}/values`, { params: { from, to } });
  }

  /** Record months for the company: each changed figure is a new revision. */
  record(code: string, values: PriceIndexEntry[]): Observable<{ recorded: number; unchanged: number }> {
    return this.http.post<{ recorded: number; unchanged: number }>(`${this.indices}/${encodeURIComponent(code)}/values`, { values });
  }
}
