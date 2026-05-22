// ../app/core/api/localization.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
// import { environment } from '../environments/environment';
import { FiscalRegion } from '../models/fiscal-region.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class LocalizationApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/localization`;

  getFiscalRegions(): Observable<FiscalRegion[]> {
    return this.http.get<FiscalRegion[]>(`${this.apiUrl}/fiscal-regions`);
  }
}
