import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Where the tenant is registered to collect tax, and at what rate. */
export interface TaxJurisdiction {
  id: string;
  countryCode: string;
  stateCode: string;
  county?: string | null;
  city?: string | null;
  postalCode?: string | null;
  level: 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL';
  name: string;
  /** As a fraction: `0.0825` is 8.25 %. */
  rate: number;
  isRegistered: boolean;
  sourcing: 'DESTINATION' | 'ORIGIN';
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export type TaxJurisdictionInput = Omit<TaxJurisdiction, 'id'>;

/** A withholding regime the tenant maintains for itself. */
export interface WithholdingRegime {
  id: string;
  code: string;
  label: string;
  kind: 'VAT' | 'INCOME';
  rate: number;
  payers: string[];
  payees: string[];
  scope: 'SERVICES' | 'GOODS' | 'ANY';
  legalBasis: string;
  isActive: boolean;
}

export type WithholdingRegimeInput = Omit<WithholdingRegime, 'id'>;

/** What the product does and does not do in the tenant's market. */
export interface CapabilityCoverage {
  capability: string;
  level: 'implemented' | 'needs-credentials' | 'not-implemented';
  detail?: string;
  requires?: string;
}

export interface MarketCoverage {
  countryCode: string;
  capabilities: CapabilityCoverage[];
}

/** Which of the authority's two worlds the tenant transmits to. */
export type FiscalEnvironment = 'PRODUCTION' | 'CERTIFICATION';

/**
 * The tenant's operational configuration for their market's e-invoicing regime.
 *
 * Every field is optional because the seven regimes need different subsets — asking a Chilean
 * tenant for an IBGE municipality code would be nonsense. Which ones THIS tenant needs is decided
 * by their country, and the adapter names precisely what is missing when it cannot build.
 */
export interface FiscalRegimeSettings {
  environment: FiscalEnvironment;
  establishment?: string | null;
  emissionPoint?: string | null;
  numericCode?: string | null;
  stateCode?: string | null;
  municipalityCode?: string | null;
  resolutionNumber?: string | null;
  activityCode?: string | null;
  originComuna?: string | null;
  originCity?: string | null;
}

/**
 * A range of document numbers the authority authorised.
 *
 * `hasSecret` and never the secret itself: the CAF holds the RSA key that seals the taxpayer's
 * folios and Colombia's ClaveTécnica is what makes a CUFE theirs. Either one read back through an
 * API lets whoever reads it issue fiscal documents in the taxpayer's name, so it goes in and never
 * comes out — replacing it means uploading a new one.
 */
export interface FiscalRange {
  id: string;
  documentType: string;
  series: string;
  startsAt: number;
  endsAt: number;
  currentSequence: number;
  remaining: number;
  isActive: boolean;
  validUntil: string | null;
  authorizationCode: string | null;
  hasSecret: boolean;
  secretKind: string | null;
}

export interface RegisterFiscalRangeInput {
  documentType: string;
  series?: string;
  startsAt: number;
  endsAt: number;
  validUntil?: string;
  authorizationCode?: string;
  secret?: string;
  secretKind?: 'CAF_XML' | 'DIAN_TECHNICAL_KEY';
}

/**
 * The fiscal configuration a tenant maintains, and the coverage statement beside it.
 *
 * These two tables are what make a document priceable in the markets where the product cannot
 * decide the rate on its own: the jurisdictions where the tenant has nexus, and the withholding
 * regimes their authority designated them for. Until they existed the rate came off the request
 * with nothing checking it; until these screens existed they were reachable only by API.
 */
@Injectable({ providedIn: 'root' })
export class FiscalSettingsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/localization`;
  private readonly einvoicing = `${environment.apiUrl}/einvoicing/regime`;

  coverage(): Observable<MarketCoverage> {
    return this.http.get<MarketCoverage>(`${this.base}/fiscal-coverage`);
  }

  jurisdictions(): Observable<TaxJurisdiction[]> {
    return this.http.get<TaxJurisdiction[]>(`${this.base}/tax-jurisdictions`);
  }

  createJurisdiction(input: TaxJurisdictionInput): Observable<TaxJurisdiction> {
    return this.http.post<TaxJurisdiction>(`${this.base}/tax-jurisdictions`, input);
  }

  updateJurisdiction(
    id: string,
    input: Partial<TaxJurisdictionInput>,
  ): Observable<TaxJurisdiction> {
    return this.http.patch<TaxJurisdiction>(`${this.base}/tax-jurisdictions/${id}`, input);
  }

  deleteJurisdiction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/tax-jurisdictions/${id}`);
  }

  withholdingRegimes(): Observable<WithholdingRegime[]> {
    return this.http.get<WithholdingRegime[]>(`${this.base}/withholding-regimes`);
  }

  createWithholdingRegime(input: WithholdingRegimeInput): Observable<WithholdingRegime> {
    return this.http.post<WithholdingRegime>(`${this.base}/withholding-regimes`, input);
  }

  deleteWithholdingRegime(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/withholding-regimes/${id}`);
  }

  // ── E-invoicing regime ────────────────────────────────────────────────────
  //
  // The regime settings and the authorised ranges are what make six markets issuable at all: a
  // Chilean tenant cannot issue without a CAF, an Ecuadorean one without an emission point, a
  // Brazilian one without their IBGE codes. Until this existed the only way to supply any of it
  // was an INSERT, and the product refused to issue — correctly, with no way out.

  regimeSettings(): Observable<FiscalRegimeSettings | null> {
    return this.http.get<FiscalRegimeSettings | null>(`${this.einvoicing}/settings`);
  }

  saveRegimeSettings(input: Partial<FiscalRegimeSettings>): Observable<FiscalRegimeSettings> {
    return this.http.put<FiscalRegimeSettings>(`${this.einvoicing}/settings`, input);
  }

  ranges(): Observable<FiscalRange[]> {
    return this.http.get<FiscalRange[]>(`${this.einvoicing}/ranges`);
  }

  registerRange(input: RegisterFiscalRangeInput): Observable<FiscalRange> {
    return this.http.post<FiscalRange>(`${this.einvoicing}/ranges`, input);
  }

  /** Retires the range; the row stays on file, because past documents were issued under it. */
  deactivateRange(id: string): Observable<void> {
    return this.http.delete<void>(`${this.einvoicing}/ranges/${id}`);
  }
}
