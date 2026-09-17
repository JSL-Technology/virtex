import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * One search hit.
 *
 * Titles and descriptions arrive as a catalogue KEY and its parameters, not as a sentence. The
 * server used to assemble them with template literals — `Factura #…`, `Cliente: …`, and
 * `RNC: ${taxId}` for every tenant in every market — so results were Spanish for every reader and
 * a Brazilian tenant's CNPJ was labelled with the Dominican term.
 *
 * `title` survives as a plain string for hits whose title IS data — a product's name, a customer's
 * company name — which is not text to translate.
 */
export interface SearchResult {
  id: string;
  /** A name that is data, not prose. Present when there is nothing to translate. */
  title?: string;
  titleKey?: string;
  titleParams?: Record<string, unknown>;
  descriptionKey: string;
  descriptionParams?: Record<string, unknown>;
  /** The catalogue code of the customer's identifier, so its own name can be rendered. */
  documentTypeCode?: string | null;
  documentTypeCountry?: string | null;
  link: string;
}

export interface SearchResultGroup {
  type: 'Invoices' | 'Products' | 'Customers';
  results: SearchResult[];
}

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/search`;

  search(query: string): Observable<SearchResultGroup[]> {
    return this.http.get<SearchResultGroup[]>(this.apiUrl, { params: { q: query } });
  }
}
