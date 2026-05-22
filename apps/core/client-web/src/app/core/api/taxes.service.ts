import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Tax } from '../models/tax.model';

export type CreateTaxDto = Omit<Tax, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>;
export type UpdateTaxDto = Partial<CreateTaxDto>;

@Injectable({ providedIn: 'root' })
export class TaxesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/taxes`;

  getTaxes(): Observable<Tax[]> {
    return this.http.get<Tax[]>(this.apiUrl);
  }

  getTaxById(id: string): Observable<Tax> {
    return this.http.get<Tax>(`${this.apiUrl}/${id}`);
  }

  createTax(tax: CreateTaxDto): Observable<Tax> {
    return this.http.post<Tax>(this.apiUrl, tax);
  }

  updateTax(id: string, tax: UpdateTaxDto): Observable<Tax> {
    return this.http.patch<Tax>(`${this.apiUrl}/${id}`, tax);
  }

  deleteTax(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}