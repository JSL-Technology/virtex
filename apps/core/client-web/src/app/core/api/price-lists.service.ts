// app/core/api/price-lists.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PriceList } from '../models/price-list.model';

export type CreatePriceListDto = Omit<PriceList, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'items'> & {
  items: { productId: string; price: number }[];
};
export type UpdatePriceListDto = Partial<CreatePriceListDto>;

@Injectable({ providedIn: 'root' })
export class PriceListsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/price-lists`;

  getPriceLists(): Observable<PriceList[]> {
    return this.http.get<PriceList[]>(this.apiUrl);
  }

  getPriceListById(id: string): Observable<PriceList> {
    return this.http.get<PriceList>(`${this.apiUrl}/${id}`);
  }

  createPriceList(priceList: CreatePriceListDto): Observable<PriceList> {
    return this.http.post<PriceList>(this.apiUrl, priceList);
  }

  updatePriceList(id: string, priceList: UpdatePriceListDto): Observable<PriceList> {
    return this.http.patch<PriceList>(`${this.apiUrl}/${id}`, priceList);
  }

  deletePriceList(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}