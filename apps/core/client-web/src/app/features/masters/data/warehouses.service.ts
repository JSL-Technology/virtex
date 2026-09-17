import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface Warehouse {
  id: string;
  name: string;
  code?: string | null;
  isActive: boolean;
  addressLine1?: string | null;
  city?: string | null;
  countryCode?: string | null;
}

export interface WarehouseInput {
  name: string;
  code?: string;
  isActive?: boolean;
  addressLine1?: string;
  city?: string;
  countryCode?: string;
}

/**
 * Where stock is held.
 *
 * `/wms/warehouses` has answered GET, POST, PATCH and DELETE — tenant-scoped, `organization_id`
 * NOT NULL — for as long as the warehouses screen has existed, and the screen called none of it.
 * It rendered three invented sites with invented managers (Carlos Pérez, María Rodríguez, Ana
 * Gómez) while the table held none, so someone configuring the company believed they had three
 * warehouses that did not exist, and the "New warehouse" button did nothing at all.
 */
@Injectable({ providedIn: 'root' })
export class WarehousesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/wms/warehouses`;

  list(): Observable<Warehouse[]> {
    return this.http.get<Warehouse[]>(this.apiUrl);
  }

  create(input: WarehouseInput): Observable<Warehouse> {
    return this.http.post<Warehouse>(this.apiUrl, input);
  }

  update(id: string, input: Partial<WarehouseInput>): Observable<Warehouse> {
    return this.http.patch<Warehouse>(`${this.apiUrl}/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
