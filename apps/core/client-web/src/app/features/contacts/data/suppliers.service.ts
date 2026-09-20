import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Supplier } from '../../../core/models/supplier.model';

export type CreateSupplierDto = Omit<Supplier, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>;
export type UpdateSupplierDto = Partial<CreateSupplierDto>;

@Injectable({ providedIn: 'root' })
export class SuppliersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/suppliers`;

  getSuppliers(): Observable<Supplier[]> {
    return this.http.get<Supplier[]>(this.apiUrl);
  }
  /**
   * Los proveedores que coinciden con `search`, como mucho `limit`.
   *
   * Para los selectores de entidad. `getSuppliers()` de arriba se trae el catálogo entero, que es lo
   * correcto para una pantalla que los LISTA y lo que no escala para un campo que enseña diez a la
   * vez. Un término vacío es una petición real: significa «la primera página», que es lo que el
   * campo muestra al abrirse y antes de que nadie teclee.
   */
  searchSuppliers(search: string, limit: number): Observable<Supplier[]> {
    let params = new HttpParams().set('limit', limit);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Supplier[]>(this.apiUrl, { params });
  }

  getSupplierById(id: string): Observable<Supplier> {
    return this.http.get<Supplier>(`${this.apiUrl}/${id}`);
  }

  createSupplier(supplier: CreateSupplierDto): Observable<Supplier> {
    return this.http.post<Supplier>(this.apiUrl, supplier);
  }

  updateSupplier(id: string, supplier: UpdateSupplierDto): Observable<Supplier> {
    return this.http.patch<Supplier>(`${this.apiUrl}/${id}`, supplier);
  }

  deleteSupplier(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}