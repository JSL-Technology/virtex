import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ExtensionSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED';
  description: string | null;
  author: string | null;
  versionCount: number;
}

export interface ExtensionConsent {
  plugin: string;
  pluginId: string;
  grantedCapabilities: string[];
  enabled: boolean;
}

export interface RegisterExtensionRequest {
  name: string;
  version: string;
  code: string;
  description?: string;
  author?: string;
  capabilities?: string[];
  requestedEgress?: string[];
  sbom?: unknown;
}

export interface ExecuteExtensionRequest {
  pluginName?: string;
  version?: string;
  code?: string;
}

export interface ExecuteExtensionResult {
  status: 'success' | 'execution_failed';
  logs: string[];
  error?: string;
  executionTimeMs?: number;
  meteringId?: string;
}

/**
 * Client for the extensions marketplace and sandbox. Talks to the consolidated API's
 * `/extensions` surface — the same capability the standalone plugin-host exposed, now behind the
 * platform's auth.
 */
@Injectable({ providedIn: 'root' })
export class ExtensionsService {
  private readonly apiUrl = `${environment.apiUrl}/extensions`;
  private readonly http = inject(HttpClient);

  /** A minimal, valid CycloneDX SBOM so admission accepts locally-authored extensions. */
  static emptySbom(): unknown {
    return { bomFormat: 'CycloneDX', specVersion: '1.4', components: [] };
  }

  list(): Observable<ExtensionSummary[]> {
    return this.http.get<ExtensionSummary[]>(this.apiUrl);
  }

  consents(): Observable<ExtensionConsent[]> {
    return this.http.get<ExtensionConsent[]>(`${this.apiUrl}/consents`);
  }

  register(req: RegisterExtensionRequest): Observable<{ status: string; id: string; message: string }> {
    return this.http.post<{ status: string; id: string; message: string }>(this.apiUrl, {
      sbom: ExtensionsService.emptySbom(),
      ...req,
    });
  }

  revoke(name: string): Observable<{ status: string; plugin: string }> {
    return this.http.post<{ status: string; plugin: string }>(
      `${this.apiUrl}/${encodeURIComponent(name)}/revoke`,
      {},
    );
  }

  setConsent(
    name: string,
    body: { grantedCapabilities?: string[]; enabled?: boolean },
  ): Observable<ExtensionConsent> {
    return this.http.put<ExtensionConsent>(
      `${this.apiUrl}/${encodeURIComponent(name)}/consent`,
      body,
    );
  }

  execute(req: ExecuteExtensionRequest): Observable<ExecuteExtensionResult> {
    return this.http.post<ExecuteExtensionResult>(`${this.apiUrl}/execute`, req);
  }
}
