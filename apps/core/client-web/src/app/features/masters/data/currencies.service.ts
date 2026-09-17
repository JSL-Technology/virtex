import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
}

export interface CurrencyInput {
  code: string;
  name: string;
  symbol: string;
}

/**
 * The currencies a tenant transacts in.
 *
 * The endpoint has answered GET, POST, PATCH and DELETE since before the currencies screen was
 * written, and the screen used none of them: it rendered three hard-coded rows — Dominican peso,
 * US dollar, euro — with no request at all, while the tenant's real list held twenty-three. What
 * was on screen was not a stale view of the data; it was unrelated to it, and the "New currency"
 * button did nothing, so the real list could not be reached or changed from the product.
 */
@Injectable({ providedIn: 'root' })
export class CurrenciesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/currencies`;

  getCurrencies(): Observable<Currency[]> {
    return this.http.get<Currency[]>(this.apiUrl);
  }

  create(input: CurrencyInput): Observable<Currency> {
    return this.http.post<Currency>(this.apiUrl, input);
  }

  update(id: string, input: Partial<CurrencyInput>): Observable<Currency> {
    return this.http.patch<Currency>(`${this.apiUrl}/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
