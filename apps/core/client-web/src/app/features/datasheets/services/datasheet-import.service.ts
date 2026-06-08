
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface ImportModule {
  id: string;
  nameEn: string;
  nameEs: string;
  sets: string[];
}

@Injectable({
  providedIn: 'root'
})
export class DatasheetImportService {
  private apiUrl = '/api/datasheets/import';

  constructor(private http: HttpClient) {}

  getModules(): Observable<ImportModule[]> {
    return this.http.get<ImportModule[]>(`${this.apiUrl}/modules`).pipe(
      catchError(() => of([]))
    );
  }

  fetchData(module: string, set: string, columns: string[], filters: any): Observable<any[]> {
    return this.http.post<any[]>(`${this.apiUrl}/data`, { module, set, columns, filters }).pipe(
      catchError(() => of([]))
    );
  }
}
