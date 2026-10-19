
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface OrganizationProfile {
  id: string;
  legalName: string;
  taxId?: string | null;
  address?: string | null;
  city?: string | null;
  /** First-level division: a code (`TX`, `CMX`) where the country publishes a catalogue. */
  state?: string | null;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  companySize?: string | null;
  taxpayerKind?: string | null;
  logoUrl?: string | null;
  /** The country is fixed once the tenant is provisioned (its fiscal pack depends on it). */
  countryLocked?: boolean;
}

export interface OrganizationMembership {
  id: string;
  legalName: string;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class OrganizationService {
  private apiUrl = `${environment.apiUrl}/organizations`;

  private http = inject(HttpClient);
getProfile(): Observable<OrganizationProfile> {
    return this.http.get<OrganizationProfile>(`${this.apiUrl}/profile`);
  }

  updateProfile(data: Partial<OrganizationProfile>): Observable<OrganizationProfile> {
    return this.http.patch<OrganizationProfile>(`${this.apiUrl}/profile`, data);
  }

  /**
   * The tenants the signed-in person can act in.
   *
   * `user_organizations` has backed multi-tenancy in the database since long before there was any
   * way to use it: nothing wrote the table and nothing let a user move between the rows it held.
   * A person working with two customers had to keep two accounts, with two passwords and two sets
   * of MFA factors.
   */
  getMemberships(): Observable<OrganizationMembership[]> {
    return this.http.get<OrganizationMembership[]>(`${this.apiUrl}/memberships`);
  }

  /**
   * Switch the active tenant.
   *
   * The tenant is a claim in the access token, so this re-issues the session rather than setting a
   * client-side preference — a preference would leave the server enforcing the old tenant. The new
   * cookies arrive on the response; the caller reloads so every resolver re-runs against the new
   * tenant instead of leaving stale data on screen.
   */
  switchOrganization(organizationId: string): Observable<{ user: unknown }> {
    return this.http.post<{ user: unknown }>(`${this.apiUrl}/switch`, { organizationId });
  }
}
