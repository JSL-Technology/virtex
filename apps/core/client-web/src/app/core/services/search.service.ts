import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SearchResult {
  id: string;
  title: string;
  description: string;
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
