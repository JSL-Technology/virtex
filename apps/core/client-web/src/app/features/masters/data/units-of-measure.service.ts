import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface UnitOfMeasure {
  id: string;
  symbol: string;
  category: string;
  /** Catalogue key for a shared unit's name. */
  nameKey?: string;
  /** A company unit's name, in the company's own words (QA M-18). */
  name?: string;
  /** `platform`: the shared catalogue. `company`: defined by this company, which may delete it. */
  scope?: 'platform' | 'company';
}

/** The categories units are grouped by, in the order the screen lists them. */
export const UNIT_CATEGORIES = ['Units', 'Weight', 'Length', 'Area', 'Volume', 'Time'] as const;

export interface CompanyUnitInput {
  symbol: string;
  name: string;
  category: (typeof UNIT_CATEGORIES)[number];
}

export interface UnitOfMeasureInput {
  symbol: string;
  category: string;
  nameKey: string;
}

/**
 * The units products are counted, weighed and measured in.
 *
 * `/units-of-measure` answers GET and POST, both permissioned, and the screen called neither: it
 * listed six invented units — kilogram, gram, piece, unit, litre, metre — while the table held
 * none, and "New" did nothing. A product could therefore not be given a unit that the screen
 * claimed existed.
 */
@Injectable({ providedIn: 'root' })
export class UnitsOfMeasureService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/units-of-measure`;

  list(): Observable<UnitOfMeasure[]> {
    return this.http.get<UnitOfMeasure[]>(this.apiUrl);
  }

  create(input: UnitOfMeasureInput): Observable<UnitOfMeasure> {
    return this.http.post<UnitOfMeasure>(this.apiUrl, input);
  }

  /** A unit of the company's own — «saco de 50 kg», «bulto» (QA M-18). */
  createForCompany(input: CompanyUnitInput): Observable<UnitOfMeasure> {
    return this.http.post<UnitOfMeasure>(`${this.apiUrl}/company`, input);
  }

  /** Refused by the server while any product is counted in it. */
  removeForCompany(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/company/${id}`);
  }
}
