
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface DatasheetBook {
  id?: string;
  name: string;
  description?: string;
  mode: 'live' | 'snapshot';
  sheets: any[];
}

export interface ERPVariable {
  nameEn: string;
  nameEs: string;
  module: string;
  descriptionEn: string;
  descriptionEs: string;
  params?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class DatasheetVariablesService {
  private apiUrl = '/api/datasheets';

  constructor(private http: HttpClient) {}

  getVariables(): Observable<ERPVariable[]> {
    return this.http.get<ERPVariable[]>(`${this.apiUrl}/variables`).pipe(
      catchError(() => of([]))
    );
  }

  resolveVariables(variables: { name: string, params: any[] }[]): Observable<Record<string, any>> {
    return this.http.post<Record<string, any>>(`${this.apiUrl}/resolve-variables`, { variables }).pipe(
      catchError(() => of({}))
    );
  }

  saveBook(book: DatasheetBook): Observable<DatasheetBook> {
    if (book.id && book.id !== 'new') {
      return this.http.patch<DatasheetBook>(`${this.apiUrl}/${book.id}`, book);
    }
    return this.http.post<DatasheetBook>(this.apiUrl, book);
  }

  getBook(id: string): Observable<DatasheetBook> {
    return this.http.get<DatasheetBook>(`${this.apiUrl}/${id}`);
  }
}
