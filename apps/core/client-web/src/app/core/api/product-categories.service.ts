import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * A category in the tenant's own catalogue.
 *
 * `parentId` is what makes it a tree: `null` is a top-level category, anything else nests under
 * the category with that id.
 */
export interface ProductCategory {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ProductCategoryInput {
  name: string;
  code?: string | null;
  description?: string | null;
  parentId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * The product-category master.
 *
 * There was none: the product form offered three categories written into its template, and the
 * "Categories" screen was an empty placeholder that said a list would appear here one day.
 */
@Injectable({ providedIn: 'root' })
export class ProductCategoriesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/inventory/categories`;

  /**
   * The catalogue. Active only by default — a deactivated category is one the tenant has stopped
   * offering, and putting it back in the product form's dropdown would undo that decision.
   */
  list(options: { includeInactive?: boolean } = {}): Observable<ProductCategory[]> {
    let params = new HttpParams();
    if (options.includeInactive) params = params.set('includeInactive', 'true');
    return this.http.get<ProductCategory[]>(this.apiUrl, { params });
  }

  get(id: string): Observable<ProductCategory> {
    return this.http.get<ProductCategory>(`${this.apiUrl}/${id}`);
  }

  create(input: ProductCategoryInput): Observable<ProductCategory> {
    return this.http.post<ProductCategory>(this.apiUrl, input);
  }

  update(id: string, input: Partial<ProductCategoryInput>): Observable<ProductCategory> {
    return this.http.patch<ProductCategory>(`${this.apiUrl}/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
