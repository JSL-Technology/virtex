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
}
