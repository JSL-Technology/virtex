import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Page } from '../../../core/api/page';
import type { DepreciationConvention, LocalizedName } from '@virtex/shared/types';

export type FixedAssetStatus = 'IN_USE' | 'DISPOSED' | 'SOLD';
export type DepreciationMethod = 'STRAIGHT_LINE' | 'DOUBLE_DECLINING_BALANCE' | 'SUM_OF_YEARS_DIGITS' | 'DECLINING_BALANCE';

export const DEPRECIATION_METHODS: readonly DepreciationMethod[] = [
  'STRAIGHT_LINE',
  'DOUBLE_DECLINING_BALANCE',
  'SUM_OF_YEARS_DIGITS',
  // A yearly rate on what is left at the start of each fiscal year, as tax laws state it.
  'DECLINING_BALANCE',
];

/** How a tax book depreciates: what tax laws state (FINB-16). */
export type TaxDepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE';
export const TAX_DEPRECIATION_METHODS: readonly TaxDepreciationMethod[] = ['STRAIGHT_LINE', 'DECLINING_BALANCE'];

/** An asset's tax book, as the register shows it: kept beside the accounting book, posted nowhere. */
export interface TaxBookSummary {
  id: string;
  /** The authority's category: `DO-2`. */
  taxCategoryCode: string | null;
  method: TaxDepreciationMethod;
  /** The yearly rate, as a fraction: 0.25 for 25 %. */
  annualRate: number;
  convention: DepreciationConvention;
  /** The basis it depreciates. */
  cost: number;
  openingAccumulated: number;
  /** `YYYY-MM`, the last month the opening balance covers. */
  openingThrough: string | null;
  accumulatedDepreciation: number;
  taxValue: number;
  depreciatedThrough: string | null;
  closedOn: string | null;
  /** Once it has charged a month, its basis, opening and convention are fixed. */
  chargedMonths: number;
}

/** The terms a tax book is opened or edited with; what is left out comes from the category. */
export interface TaxBookInput {
  taxCategoryCode?: string | null;
  method?: TaxDepreciationMethod;
  annualRate?: number;
  convention?: DepreciationConvention;
  cost?: number;
  openingAccumulated?: number;
  /** `YYYY-MM`. */
  openingThrough?: string | null;
}

/** A category of assets and what an asset of it starts with (FINB-16). */
export interface FixedAssetCategory {
  id: string;
  code: string;
  name: string;
  nameTranslations: LocalizedName;
  description: string | null;
  usefulLifeMonths: number | null;
  depreciationMethod: DepreciationMethod | null;
  decliningAnnualRate: number | null;
  depreciationConvention: DepreciationConvention | null;
  /** The share of the cost left at the end, as a fraction. */
  residualRate: number;
  assetAccountId: string | null;
  accumulatedDepreciationAccountId: string | null;
  depreciationExpenseAccountId: string | null;
  gainOnDisposalAccountId: string | null;
  lossOnDisposalAccountId: string | null;
  taxCategoryCode: string | null;
  taxMethod: TaxDepreciationMethod | null;
  taxAnnualRate: number | null;
  isActive: boolean;
}

export type FixedAssetCategoryInput = Partial<Omit<FixedAssetCategory, 'id'>>;

/** The tax categories the company's market fixes, at the authority's rates. */
export interface TaxCategoryCatalogue {
  authority: string;
  caveatKey: string;
  categories: Array<{ code: string; nameKey: string; method: TaxDepreciationMethod; annualRate: number; legalBasis: string }>;
}

/** One asset in a period's tax depreciation. */
export interface TaxDepreciationRow {
  assetId: string;
  number: string;
  name: string;
  categoryCode: string | null;
  categoryName: string | null;
  categoryNameTranslations: LocalizedName | null;
  taxCategoryCode: string | null;
  method: TaxDepreciationMethod;
  annualRate: number;
  inServiceDate: string;
  disposalDate: string | null;
  basis: number;
  openingAccumulated: number;
  deduction: number;
  closingAccumulated: number;
  taxValue: number;
  accountingDepreciation: number;
  accountingCarrying: number | null;
  /** The carrying amount less the tax value (IAS 12); null for an asset that left. */
  difference: number | null;
}

export interface TaxDepreciationTotals {
  basis: number;
  openingAccumulated: number;
  deduction: number;
  closingAccumulated: number;
  taxValue: number;
  accountingDepreciation: number;
  accountingCarrying: number;
  difference: number;
}

export interface TaxDepreciationReport {
  period: { from: string; to: string };
  totals: TaxDepreciationTotals & { assets: number };
  byTaxCategory: Array<TaxDepreciationTotals & { taxCategoryCode: string | null; method: TaxDepreciationMethod; annualRate: number; assets: number }>;
  assets: Page<TaxDepreciationRow>;
}

export interface TaxDepreciationQuery {
  /** `YYYY-MM` through `YYYY-MM`. */
  from: string;
  to: string;
  taxCategoryCode?: string | null;
  page?: number;
  pageSize?: number;
}

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
  /** The yearly rate of a `DECLINING_BALANCE` method, as a fraction. */
  decliningAnnualRate: number | null;
  /** How the month it entered service, and the month it leaves, are charged (FINB-12). */
  depreciationConvention: DepreciationConvention;
  categoryId: string | null;
  /** Present on one asset; the list carries it too. */
  category?: { id: string; code: string; name: string; nameTranslations: LocalizedName } | null;
  /** Present on one asset read on its own; null when it keeps none. */
  taxBook?: TaxBookSummary | null;
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
  categoryId?: string | null;
  acquisitionDate: string;
  inServiceDate?: string;
  cost: number;
  residualValue?: number;
  usefulLifeMonths?: number;
  depreciationMethod?: DepreciationMethod;
  decliningAnnualRate?: number | null;
  /** Left out, the company's convention. */
  depreciationConvention?: DepreciationConvention;
  assetAccountId?: string;
  accumulatedDepreciationAccountId?: string;
  depreciationExpenseAccountId?: string | null;
  vendorBillId?: string | null;
  openingAccumulatedDepreciation?: number;
  /** `YYYY-MM`. */
  openingDepreciatedThrough?: string;
  /** Left out, the category's terms; null keeps no tax book (or removes one that has charged nothing). */
  taxBook?: TaxBookInput | null;
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
  posted: Array<ScheduledCharge & { journalEntryId: string; runId: string | null }>;
  projected: ScheduledCharge[];
  /** The tax book's months and the rest of its schedule; null when the asset keeps none. */
  taxBook: {
    book: TaxBookSummary;
    /** The month (1–12) the company's fiscal year starts in. */
    fiscalYearStartMonth: number;
    posted: Array<ScheduledCharge & { runId: string | null }>;
    projected: ScheduledCharge[];
  } | null;
}

export interface DepreciationRunResult {
  periodEnd: string;
  /** The run's record, or null when nothing was due (and for a preview). */
  runId: string | null;
  journalEntryId: string | null;
  total: number;
  assets: Array<{ id: string; number: string; name: string; months: number; amount: number }>;
  skipped: Array<{ id: string; number: string; name: string; reason: string }>;
  /** What it charges in the tax books: recorded, posted nowhere (FINB-16). */
  tax: { total: number; assets: Array<{ id: string; number: string; name: string; months: number; amount: number }> };
  /**
   * Whether the run can be posted: a month that has not ended yet in the company's calendar can be
   * previewed, not posted — the reason comes as a message key with its values.
   */
  postable: boolean;
  notPostable: { key: string; params: Record<string, unknown> } | null;
}

/** What set a depreciation run going. */
export type DepreciationRunTrigger = 'SCHEDULE' | 'PERIOD_CLOSE' | 'MANUAL' | 'DISPOSAL';

/** A run that charged something: when, why, who, through which month, and how much. */
export interface DepreciationRunSummary {
  id: string;
  periodEnd: string;
  trigger: DepreciationRunTrigger;
  fixedAsset: { id: string; number: string; name: string } | null;
  ranByUserId: string | null;
  ranByName: string | null;
  assetCount: number;
  chargeCount: number;
  total: number;
  /** The tax book's months it charged, and their total. */
  taxChargeCount: number;
  taxTotal: number;
  createdAt: string;
}

export interface DepreciationRunDetail extends DepreciationRunSummary {
  charges: Array<{
    fixedAssetId: string;
    number: string;
    name: string;
    periodEnd: string;
    amount: number;
    accumulatedAfter: number;
    bookValueAfter: number;
    journalEntryId: string;
  }>;
  entries: Array<{ id: string; entryNumber: string | null; date: string; total: number }>;
  taxCharges: Array<{
    fixedAssetId: string;
    number: string;
    name: string;
    periodEnd: string;
    amount: number;
    accumulatedAfter: number;
    bookValueAfter: number;
  }>;
}

export interface DepreciationRunQuery {
  trigger?: DepreciationRunTrigger | null;
  fixedAssetId?: string | null;
  page?: number;
  pageSize?: number;
}

export interface FixedAssetQuery {
  status?: FixedAssetStatus | null;
  search?: string | null;
  branchId?: string | null;
  categoryId?: string | null;
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

  listRuns(query: DepreciationRunQuery = {}): Observable<Page<DepreciationRunSummary>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<Page<DepreciationRunSummary>>(`${this.base}/depreciation-runs`, { params });
  }

  getRun(id: string): Observable<DepreciationRunDetail> {
    return this.http.get<DepreciationRunDetail>(`${this.base}/depreciation-runs/${id}`);
  }

  // ── Categories and the tax book (FINB-16) ────────────────────────────────────────────────

  listCategories(includeInactive = false): Observable<FixedAssetCategory[]> {
    const params = includeInactive ? new HttpParams().set('includeInactive', 'true') : undefined;
    return this.http.get<FixedAssetCategory[]>(`${this.base}/categories`, { params });
  }

  getCategory(id: string): Observable<FixedAssetCategory> {
    return this.http.get<FixedAssetCategory>(`${this.base}/categories/${id}`);
  }

  createCategory(input: FixedAssetCategoryInput): Observable<FixedAssetCategory> {
    return this.http.post<FixedAssetCategory>(`${this.base}/categories`, input);
  }

  updateCategory(id: string, input: FixedAssetCategoryInput): Observable<FixedAssetCategory> {
    return this.http.patch<FixedAssetCategory>(`${this.base}/categories/${id}`, input);
  }

  removeCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/categories/${id}`);
  }

  /** The tax categories the company's market fixes; null where it fixes none. */
  taxCategories(): Observable<TaxCategoryCatalogue | null> {
    return this.http.get<TaxCategoryCatalogue | null>(`${this.base}/tax-categories`);
  }

  /** The tax depreciation of a period, asset by asset and by tax category. */
  taxDepreciation(query: TaxDepreciationQuery): Observable<TaxDepreciationReport> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<TaxDepreciationReport>(`${this.base}/tax-depreciation`, { params });
  }
}

/** A rate kept as a fraction, as the form reads it: 0.25 → 25. */
export function asPercent(rate: number | null | undefined): number | null {
  return rate === null || rate === undefined ? null : Math.round(rate * 1_000_000) / 10_000;
}

/** A percentage typed in the form, as a rate kept: 25 → 0.25 (six decimals). */
export function asRate(percent: number | string | null | undefined): number | null {
  if (percent === null || percent === undefined || percent === '') return null;
  const value = Number(percent);
  return Number.isFinite(value) ? Math.round(value * 10_000) / 1_000_000 : null;
}
