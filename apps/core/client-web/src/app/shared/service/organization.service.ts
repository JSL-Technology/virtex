
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface OrganizationProfile {
  id: string;
  legalName: string;
  taxId?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  website?: string;
  industry?: string;
  logoUrl?: string;
}

@Injectable({
  providedIn: 'root'
})
export class OrganizationService {
  private apiUrl = `${environment.apiUrl}/organizations`;

  constructor(private http: HttpClient) {}

  getProfile(): Observable<OrganizationProfile> {
    return this.http.get<OrganizationProfile>(`${this.apiUrl}/profile`);
  }

  updateProfile(data: Partial<OrganizationProfile>): Observable<OrganizationProfile> {
    return this.http.patch<OrganizationProfile>(`${this.apiUrl}/profile`, data);
  }
}
