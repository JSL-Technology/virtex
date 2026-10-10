import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface DimensionValue {
  id?: string;
  /** The code a journal line carries. */
  value: string;
  name: string | null;
  isActive: boolean;
  /** The code of the value it rolls up into. */
  parent: string | null;
  inUse?: boolean;
}

export interface Dimension {
  id: string;
  /** What a journal line is tagged with. */
  name: string;
  description: string | null;
  isActive: boolean;
  inUse: boolean;
  values: DimensionValue[];
}

export interface DimensionInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
  values: Array<Pick<DimensionValue, 'id' | 'value' | 'name' | 'isActive' | 'parent'>>;
}

export interface DimensionRule {
  accountId: string;
  accountCode: string;
  accountName: unknown;
  dimensionId: string;
  dimensionName: string;
  isRequired: boolean;
}

/** The characters a dimension name may carry — the server's `DIMENSION_NAME_PATTERN`. */
export const DIMENSION_NAME_PATTERN = /^[a-zA-Z0-9_ ]+$/;
/** A value's code — the server's `DIMENSION_VALUE_PATTERN`. */
export const DIMENSION_VALUE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

/** `VENTAS · Departamento de ventas`, or the code alone. */
export function valueLabel(value: Pick<DimensionValue, 'value' | 'name'>): string {
  return value.name ? `${value.value} · ${value.name}` : value.value;
}

/**
 * The values of a dimension in tree order — each followed by the ones that roll up into it — with
 * their depth, for an indented list.
 */
export function valueTree<T extends Pick<DimensionValue, 'value' | 'parent'>>(values: readonly T[]): Array<{ value: T; depth: number }> {
  const children = new Map<string | null, T[]>();
  const codes = new Set(values.map((value) => value.value));
  for (const value of values) {
    const parent = value.parent && codes.has(value.parent) ? value.parent : null;
    const bucket = children.get(parent) ?? [];
    bucket.push(value);
    children.set(parent, bucket);
  }
  const ordered: Array<{ value: T; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const value of [...(children.get(parent) ?? [])].sort((a, b) => a.value.localeCompare(b.value))) {
      if (seen.has(value.value)) continue;
      seen.add(value.value);
      ordered.push({ value, depth });
      walk(value.value, depth + 1);
    }
  };
  walk(null, 0);
  // Anything a cycle hid still shows, at the top level.
  for (const value of values) if (!seen.has(value.value)) ordered.push({ value, depth: 0 });
  return ordered;
}

/** Analytic dimensions, their values, and the accounts that require them (audit H-21). */
@Injectable({ providedIn: 'root' })
export class DimensionsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/dimensions`;
  private active$: Observable<Dimension[]> | null = null;

  list(): Observable<Dimension[]> {
    return this.http.get<Dimension[]>(this.base);
  }

  /**
   * The dimensions a line can be tagged with, shared by every journal-entry form open in the
   * session; `invalidate()` after an edit so the next form reads the new list.
   */
  forTagging(): Observable<Dimension[]> {
    this.active$ ??= this.list().pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.active$;
  }

  invalidate(): void {
    this.active$ = null;
  }

  create(input: DimensionInput): Observable<Dimension> {
    return this.http.post<Dimension>(this.base, input);
  }

  update(id: string, input: Partial<DimensionInput>): Observable<Dimension> {
    return this.http.patch<Dimension>(`${this.base}/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  rules(): Observable<DimensionRule[]> {
    return this.http.get<DimensionRule[]>(`${this.base}/rules`);
  }

  rulesForAccount(accountId: string): Observable<Array<{ accountId: string; dimensionId: string; dimension: { name: string } }>> {
    return this.http.get<Array<{ accountId: string; dimensionId: string; dimension: { name: string } }>>(`${this.base}/rules/${accountId}`);
  }

  addRule(accountId: string, dimensionId: string): Observable<unknown> {
    return this.http.post(`${this.base}/rules`, { accountId, dimensionId });
  }

  removeRule(accountId: string, dimensionId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/rules/${accountId}/${dimensionId}`);
  }
}
