import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface McpConsentInfo {
  clientName: string;
  redirectHost: string;
  scopes: Array<'erp:read' | 'erp:draft'>;
}

export interface McpGrant {
  id: string;
  client: string;
  scope: string;
  since: string;
  lastUsedAt: string | null;
}

/** External AI agents connected over MCP: the consent, and the person's list of connected agents. */
@Injectable({ providedIn: 'root' })
export class McpService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/mcp/oauth`;

  /** The address an agent is configured with. */
  readonly endpoint = `${environment.apiUrl}/mcp`;

  consentInfo(params: Record<string, string>): Observable<McpConsentInfo> {
    return this.http.get<McpConsentInfo>(`${this.url}/consent`, { params: new HttpParams({ fromObject: params }) });
  }

  consent(params: Record<string, string>, approve: boolean): Observable<{ redirect: string }> {
    return this.http.post<{ redirect: string }>(`${this.url}/consent`, { ...params, approve });
  }

  grants(): Observable<McpGrant[]> {
    return this.http.get<McpGrant[]>(`${this.url}/grants`);
  }

  revoke(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/grants/${id}`);
  }
}
