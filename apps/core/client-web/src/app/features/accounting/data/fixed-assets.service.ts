import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Page } from '../../../core/api/page';

export type FixedAssetStatus = 'IN_USE' | 'DISPOSED' | 'SOLD';
export type DepreciationMethod = 'STRAIGHT_LINE' | 'DOUBLE_DECLINING_BALANCE' | 'SUM_OF_YEARS_DIGITS';

export const DEPRECIATION_METHODS: readonly DepreciationMethod[] = [
  'STRAIGHT_LINE',
  'DOUBLE_DECLINING_BALANCE',
  'SUM_OF_YEARS_DIGITS',
];

/** One asset of the register, as the server returns it. */
export interface FixedAsset {
  id: string;
  number: string;
  name: string;
  description: string | null;
  branchId: string | null;
  acquisitionDate: string;
  inServiceDate: string;
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  bookValue: number;
  accumulatedDepreciation: number;
  openingAccumulatedDepreciation: number;
  depreciatedThrough: string | null;
  status: FixedAssetStatus;
  assetAccountId: string | null;
  accumulatedDepreciationAccountId: string | null;
  depreciationExpenseAccountId: string | null;
  vendorBillId: string | null;
  disposalDate: string | null;
  disposalProceeds: number | null;
  disposalReason: string | null;
  disposalJournalEntryId: string | null;
  createdAt: string;
}

export interface FixedAssetInput {
  name: string;
  description?: string | null;
  branchId?: string | null;
  acquisitionDate: string;
  inServiceDate?: string;
  cost: number;
  residualValue?: number;
  usefulLifeMonths: number;
  depreciationMethod?: DepreciationMethod;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId?: string | null;
  vendorBillId?: string | null;
  openingAccumulatedDepreciation?: number;
  /** `YYYY-MM`. */
  openingDepreciatedThrough?: string;
}

export interface DisposeAssetInput {
  disposalDate: string;
  salePrice: number;
  disposalReason: string;
  cashAccountId?: string;
  gainOnDisposalAccountId?: string;
  lossOnDisposalAccountId?: string;
}

export interface ScheduledCharge {
  periodEnd: string;
  amount: number;
  accumulatedAfter: number;
  bookValueAfter: number;
}

export interface FixedAssetSchedule {
  posted: Array<ScheduledCharge & { journalEntryId: string }>;
  projected: ScheduledCharge[];
}

export interface DepreciationRunResult {
  periodEnd: string;
  journalEntryId: string | null;
  total: number;
  assets: Array<{ id: string; number: string; name: string; months: number; amount: number }>;
  skipped: Array<{ id: string; number: string; name: string; reason: string }>;
}

export interface FixedAssetQuery {
  status?: FixedAssetStatus | null;
  search?: string | null;
  branchId?: string | null;
  page?: number;
  pageSize?: number;
}

/**
 * Whether a month has been charged here. Once one has, what valued the asset is fixed; see the
 * server's `FixedAssetsService.update`. Every charge is positive and only a run moves the total
 * off its opening balance, so the comparison is exact.
 */
export function hasBeenDepreciated(asset: Pick<FixedAsset, 'accumulatedDepreciation' | 'openingAccumulatedDepreciation'>): boolean {
  return Math.round(asset.accumulatedDepreciation * 100) > Math.round(asset.openingAccumulatedDepreciation * 100);
}

/** The fixed-asset register (audit H-21). */
@Injectable({ providedIn: 'root' })
export class FixedAssetsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/fixed-assets`;

  list(query: FixedAssetQuery = {}): Observable<Page<FixedAsset>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<Page<FixedAsset>>(this.base, { params });
  }

  get(id: string): Observable<FixedAsset> {
    return this.http.get<FixedAsset>(`${this.base}/${id}`);
  }

  schedule(id: string): Observable<FixedAssetSchedule> {
    return this.http.get<FixedAssetSchedule>(`${this.base}/${id}/schedule`);
  }

  create(input: FixedAssetInput): Observable<FixedAsset> {
    return this.http.post<FixedAsset>(this.base, input);
  }

  update(id: string, input: Partial<FixedAssetInput>): Observable<FixedAsset> {
    return this.http.patch<FixedAsset>(`${this.base}/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  dispose(id: string, input: DisposeAssetInput): Observable<FixedAsset> {
    return this.http.post<FixedAsset>(`${this.base}/${id}/dispose`, input);
  }

  /** What a run through the month (`YYYY-MM`) would charge. */
  previewDepreciation(period: string): Observable<DepreciationRunResult> {
    return this.http.get<DepreciationRunResult>(`${this.base}/depreciation-runs/preview`, { params: { period } });
  }

  runDepreciation(period: string): Observable<DepreciationRunResult> {
    return this.http.post<DepreciationRunResult>(`${this.base}/depreciation-runs`, { period });
  }
}
