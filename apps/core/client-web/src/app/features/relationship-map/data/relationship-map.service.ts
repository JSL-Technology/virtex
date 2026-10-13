import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  DocumentFlowMap,
  FlowDocumentSearchHit,
  FlowDocumentType,
  FlowDocumentTypeInfo,
  FlowMapOptions,
} from './relationship-map.models';

export * from './relationship-map.models';

/**
 * The node and edge labels arrive from the server as whole i18n keys (`typeKey`, `subtypeKey`,
 * `relationKey`), so `verify-catalogues` cannot see them by reading the templates. These prefixes,
 * written as literals ending in a dot, are what tell that tool the families are live — it treats a
 * referenced `prefix.` as covering every `prefix.*` key. Keep in step with `relationship_map.json`.
 */
export const RELATIONSHIP_MAP_KEY_FAMILIES = [
  'relationship_map.doc.',
  'relationship_map.rel.',
  'relationship_map.subtype.',
  'relationship_map.status.',
  'relationship_map.module.',
  'relationship_map.category.',
] as const;

/** The relationship map API: `GET /relationship-map/{types,search,:type/:id}`. */
@Injectable({ providedIn: 'root' })
export class RelationshipMapService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/relationship-map`;

  map(type: string, id: string, options: FlowMapOptions = {}): Observable<DocumentFlowMap> {
    let params = new HttpParams();
    if (options.depth) params = params.set('depth', options.depth);
    if (options.limit) params = params.set('limit', options.limit);
    return this.http.get<DocumentFlowMap>(
      `${this.apiUrl}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { params, withCredentials: true },
    );
  }

  types(): Observable<FlowDocumentTypeInfo[]> {
    return this.http.get<FlowDocumentTypeInfo[]>(`${this.apiUrl}/types`, { withCredentials: true });
  }

  search(q: string, type?: FlowDocumentType | null): Observable<FlowDocumentSearchHit[]> {
    let params = new HttpParams().set('q', q);
    if (type) params = params.set('type', type);
    return this.http.get<FlowDocumentSearchHit[]>(`${this.apiUrl}/search`, { params, withCredentials: true });
  }
}
