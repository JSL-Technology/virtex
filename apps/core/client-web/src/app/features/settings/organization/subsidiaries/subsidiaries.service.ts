import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';

export interface Subsidiary {
  parentOrganizationId: string;
  subsidiaryOrganizationId: string;
  ownership: number;
  /** When control was obtained; consolidation separates pre-acquisition equity from this date. */
  acquisitionDate: string | null;
  /** What the parent paid, for goodwill. */
  acquisitionCost: number | null;
  /** The PARENT's account holding the investment, eliminated on consolidation. */
  investmentAccountId: string | null;
  /** When control ended (sold, deconsolidated); no longer part of the group from then. */
  controlEndedOn: string | null;
  subsidiary: {
    id: string;
    legalName: string;
    taxId: string;
    country: string;
  };
}

export interface CreateSubsidiaryDto {
  legalName: string;
  taxId: string;
  country: string;
  ownership: number;
}

/** What can be recorded about a subsidiary after creation. `null` clears a value. */
export interface UpdateSubsidiaryDto {
  ownership?: number;
  acquisitionDate?: string | null;
  acquisitionCost?: number | null;
  investmentAccountId?: string | null;
  controlEndedOn?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class SubsidiariesService {
  private apiUrl = `${environment.apiUrl}/organizations/subsidiaries`;

  private http = inject(HttpClient);

  getSubsidiaries(): Observable<Subsidiary[]> {
    return this.http.get<Subsidiary[]>(this.apiUrl);
  }

  createSubsidiary(data: CreateSubsidiaryDto): Observable<Subsidiary> {
    return this.http.post<Subsidiary>(this.apiUrl, data);
  }

  /** Ownership, acquisition and end of control — what consolidation needs. Asks for step-up. */
  updateSubsidiary(subsidiaryId: string, data: UpdateSubsidiaryDto): Observable<Subsidiary> {
    return this.http.patch<Subsidiary>(`${this.apiUrl}/${subsidiaryId}`, data);
  }
}
