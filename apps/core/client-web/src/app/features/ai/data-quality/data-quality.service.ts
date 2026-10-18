import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type DuplicateEntityType = 'CUSTOMER' | 'SUPPLIER' | 'PRODUCT';
export type DuplicateStatus = 'OPEN' | 'SAME' | 'NOT_DUPLICATE' | 'STALE';
export type DuplicateReason = 'same_tax_id' | 'same_barcode' | 'same_email' | 'same_phone' | 'same_code' | 'similar_name' | 'different_tax_id';

export interface DuplicateSuggestion {
  id: string;
  entityType: DuplicateEntityType;
  recordAId: string;
  recordBId: string;
  labelA: string;
  labelB: string;
  linkA: string | null;
  linkB: string | null;
  score: number;
  reasons: DuplicateReason[];
  status: DuplicateStatus;
  decidedAt: string | null;
}

export interface DuplicateList {
  total: number;
  /** Open pairs per type this person may read. */
  counts: Partial<Record<DuplicateEntityType, number>>;
  items: DuplicateSuggestion[];
}

@Injectable({ providedIn: 'root' })
export class DataQualityApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai/data-quality/duplicates`;

  list(query: { type?: DuplicateEntityType | null; status?: DuplicateStatus; limit?: number; offset?: number }): Observable<DuplicateList> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params = params.set(key, String(value));
    return this.http.get<DuplicateList>(this.url, { params });
  }

  scan(): Observable<Record<string, { found: number; added: number; stale: number }>> {
    return this.http.post<Record<string, { found: number; added: number; stale: number }>>(`${this.url}/scan`, {});
  }

  decide(id: string, decision: 'SAME' | 'NOT_DUPLICATE' | 'OPEN'): Observable<DuplicateSuggestion> {
    return this.http.post<DuplicateSuggestion>(`${this.url}/${id}/decision`, { decision });
  }
}
