import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Mirrors the backend `FlowStatusKind` — the normalised state the node is coloured by. */
export type FlowStatusKind = 'draft' | 'open' | 'closed' | 'cancelled' | 'unknown';

/** One document in the map. Mirrors the backend `FlowNode` contract. */
export interface FlowNode {
  key: string;
  type: string;
  id: string;
  typeKey: string;
  icon: string;
  number: string | null;
  subtypeKey: string | null;
  date: string | null;
  statusKind: FlowStatusKind;
  statusRaw: string | null;
  amount: number | null;
  currencyCode: string | null;
  party: string | null;
  route: string | null;
  root: boolean;
}

/** One link, drawn base → derived. Mirrors the backend `FlowEdge` contract. */
export interface FlowEdge {
  from: string;
  to: string;
  relationKey: string;
}

export interface DocumentFlowMap {
  root: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  truncated: boolean;
}

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
] as const;

/** The relationship map, against `GET /relationship-map/:type/:id`. */
@Injectable({ providedIn: 'root' })
export class RelationshipMapService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/relationship-map`;

  map(type: string, id: string): Observable<DocumentFlowMap> {
    return this.http.get<DocumentFlowMap>(
      `${this.apiUrl}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
  }
}
