import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../tokens/api-url.token';

export interface SsoDnsRecord {
  host: string;
  type: string;
  value: string;
}

export interface SsoDomain {
  id: string;
  domain: string;
  verified: boolean;
  verifiedAt?: string | null;
  dnsRecord: SsoDnsRecord;
}

export interface SsoIdentityProvider {
  id: string;
  name: string;
  type: string;
  issuerUrl: string;
  clientId: string;
  scopes: string[];
  defaultRoleId: string | null;
  enabled: boolean;
  redirectUri: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdpPayload {
  name: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  defaultRoleId?: string;
}

export type UpdateIdpPayload = Partial<CreateIdpPayload> & { enabled?: boolean };

/**
 * Client for the per-organization enterprise SSO admin API. All calls are authenticated via
 * the httpOnly session cookie and CSRF header handled by the global interceptors.
 */
@Injectable({ providedIn: 'root' })
export class SsoAdminService {
  private http = inject(HttpClient);
  private readonly baseUrl = `${inject(API_URL)}/auth/sso/admin`;

  // Identity providers
  listProviders(): Observable<SsoIdentityProvider[]> {
    return this.http.get<SsoIdentityProvider[]>(`${this.baseUrl}/providers`);
  }

  createProvider(payload: CreateIdpPayload): Observable<SsoIdentityProvider> {
    return this.http.post<SsoIdentityProvider>(`${this.baseUrl}/providers`, payload);
  }

  updateProvider(id: string, payload: UpdateIdpPayload): Observable<SsoIdentityProvider> {
    return this.http.patch<SsoIdentityProvider>(`${this.baseUrl}/providers/${id}`, payload);
  }

  deleteProvider(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/providers/${id}`);
  }

  // Domains
  listDomains(): Observable<SsoDomain[]> {
    return this.http.get<SsoDomain[]>(`${this.baseUrl}/domains`);
  }

  addDomain(domain: string): Observable<SsoDomain> {
    return this.http.post<SsoDomain>(`${this.baseUrl}/domains`, { domain });
  }

  verifyDomain(id: string): Observable<{ verified: boolean }> {
    return this.http.post<{ verified: boolean }>(`${this.baseUrl}/domains/${id}/verify`, {});
  }

  deleteDomain(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/domains/${id}`);
  }
}
