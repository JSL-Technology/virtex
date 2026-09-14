import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Subsidiary {
  id: string;
  legalName: string;
  taxId?: string | null;
  countryCode?: string | null;
  city?: string | null;
  addressLine1?: string | null;
  phone?: string | null;
}

/**
 * The branches and subsidiaries that make up the organisation.
 *
 * `/organizations/subsidiaries` answers GET and POST and is what Settings › Company Structure
 * already uses. The "Branches" screen under master data ignored it and listed two invented offices
 * — Oficina Principal on Av. Winston Churchill, Sucursal Santiago on Av. Juan Pablo Duarte — with
 * invented telephone numbers, so the same product showed a structure with two branches in one place
 * and none in another.
 */
@Injectable({ providedIn: 'root' })
export class SubsidiariesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/organizations/subsidiaries`;

  list(): Observable<Subsidiary[]> {
    return this.http.get<Subsidiary[]>(this.apiUrl);
  }
}
