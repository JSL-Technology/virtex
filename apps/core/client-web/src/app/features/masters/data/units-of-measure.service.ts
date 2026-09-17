import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface UnitOfMeasure {
  id: string;
  symbol: string;
  category: string;
  /** Catalogue key for the unit's name; the missing-key handler humanises anything unseeded. */
  nameKey: string;
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
}
