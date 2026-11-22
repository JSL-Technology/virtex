import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { LocalizedName } from '@virtex/shared/types';

export interface Warehouse {
  id: string;
  name: string;
  /** The name in the languages other than the books' — `name` is the record, in the books language. */
  nameTranslations?: LocalizedName;
  code?: string | null;
  isActive: boolean;
  /** Where stock goes when a document names no warehouse. Exactly one per company. */
  isDefault?: boolean;
  addressLine1?: string | null;
  city?: string | null;
  countryCode?: string | null;
  /** The branch it belongs to; null for a central warehouse or a company without branches. */
  branchId?: string | null;
}

export interface WarehouseInput {
  name: string;
  nameTranslations?: LocalizedName;
  code?: string;
  isActive?: boolean;
  isDefault?: boolean;
  addressLine1?: string;
  city?: string;
  countryCode?: string;
  branchId?: string;
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
