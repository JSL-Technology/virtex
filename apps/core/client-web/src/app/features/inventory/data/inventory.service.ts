import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Product } from './product.model';

export type CreateProductDto = Omit<Product, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>;
export type UpdateProductDto = Partial<CreateProductDto>;

/**
 * Inventory HTTP client — canonical location is `features/inventory/data/`.
 * `core/api/inventory.service.ts` re-exports everything here for backward compatibility.
 */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory`;

  getProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(this.apiUrl);
  }
  /**
   * Los productos que coinciden con `search`, como mucho `limit`.
   *
   * Para los selectores de entidad. `getProducts()` de arriba se trae el catálogo entero, que es lo
   * correcto para una pantalla que los LISTA y lo que no escala para un campo que enseña diez a la
   * vez. Un término vacío es una petición real: significa «la primera página», que es lo que el
   * campo muestra al abrirse y antes de que nadie teclee.
   */
  searchProducts(search: string, limit: number): Observable<Product[]> {
    let params = new HttpParams().set('limit', limit);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Product[]>(this.apiUrl, { params });
  }

  getProductById(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`);
  }

  createProduct(product: CreateProductDto): Observable<Product> {
    return this.http.post<Product>(this.apiUrl, product);
  }

  updateProduct(id: string, product: UpdateProductDto): Observable<Product> {
    return this.http.patch<Product>(`${this.apiUrl}/${id}`, product);
  }

  deleteProduct(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
