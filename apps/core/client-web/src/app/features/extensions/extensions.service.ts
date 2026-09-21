import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * One version, as the CATALOGUE describes it.
 *
 * Deliberately carries no `code`, no `uiEntry` and no `signature`. The API used to return the
 * entity straight from the repository, so any tenant with `extensions:view` could read every
 * vendor's server-side and client-side source, plus the platform's attestation over it. The
 * source travels to the isolate and to the sandboxed iframe, and nowhere else.
 */
export interface ExtensionVersionSummary {
  id: string;
  version: string;
  channel: string;
  createdAt: string;
  capabilities: string[] | null;
  contributes?: unknown;
  /** Whether it ships a UI — without shipping the UI. */
  hasUi: boolean;
  /** Whether the platform has an attestation on file — without publishing it. */
  signed: boolean;
}

export interface ExtensionSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED';
  description: string | null;
  author: string | null;
  /**
   * Who published it. The publisher's organization id is deliberately not exposed — it would
   * enumerate tenant ids across the platform.
   */
  publisher: 'platform' | 'organization' | 'third_party';
  versionCount: number;
  /** Present on the detail response only. */
  versions?: ExtensionVersionSummary[];
}

export interface ExtensionConsent {
  plugin: string;
  pluginId: string;
  grantedCapabilities: string[];
  enabled: boolean;
  /**
   * The version this tenant runs, and the one waiting for its decision.
   *
   * Consent used to be to a NAME, and execution resolved "the newest version", so a version
   * published later inherited it automatically — along with the capabilities granted to the
   * version that was actually reviewed. Pinning turns a release into a proposal.
   */
  consentedVersionId: string | null;
  pendingVersionId: string | null;
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
  /** Client-side UI (JavaScript) run in the sandboxed extension host. */
  uiEntry?: string;
  contributes?: unknown;
}

export interface RuntimeExtension {
  name: string;
  version: string;
  uiEntry: string;
  contributes?: unknown;
  grantedCapabilities: string[];
}

export interface ExecuteExtensionRequest {
  pluginName?: string;
  version?: string;
  /**
   * Arbitrary code, run in the isolate.
   *
   * Requires `platform:extensions:run_arbitrary_code`, which no tenant role can carry. It is a
   * development and incident-response tool; an ordinary tenant executes an INSTALLED extension by
   * name.
   */
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

  /** The tenant's enabled UI extensions — what the client-side host mounts. */
  runtime(): Observable<RuntimeExtension[]> {
    return this.http.get<RuntimeExtension[]>(`${this.apiUrl}/runtime`);
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

  /**
   * Install an extension, or accept a new version of one.
   *
   * `versionId` is what the tenant is agreeing to RUN. Omitted on a first consent, the server
   * pins whatever is current at that moment; omitted later, it keeps the existing pin — silence
   * is not acceptance of a pending upgrade.
   */
  setConsent(
    name: string,
    body: { grantedCapabilities?: string[]; enabled?: boolean; versionId?: string },
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
