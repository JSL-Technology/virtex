import { Signal, computed, signal } from '@angular/core';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K | null;
  direction: SortDirection;
}

/** How a column reads its value from a row. What is compared is what the reader sees. */
export type SortAccessors<T, K extends string> = Record<K, (row: T) => unknown>;

const NUMERIC = /^-?\d+(?:\.\d+)?$/;
const collators = new Map<string, Intl.Collator>();

function collator(): Intl.Collator {
  const lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'es';
  let found = collators.get(lang);
  if (!found) {
    // `numeric`: «FAC-10» after «FAC-9». `base`: «Árbol» next to «arbol», not after «Zeta».
    found = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
    collators.set(lang, found);
  }
  return found;
}

function normalise(value: unknown): number | string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  // Money arrives from the API as decimal strings («1234.50»): compared as text, «900» sorts
  // after «1000». A string that is a number is a number.
  if (NUMERIC.test(text)) return Number(text);
  return text;
}

/**
 * Compares two cell values the way a reader expects: numbers as numbers, text by the reader's
 * language, dates in order. An empty cell goes last in both directions: «sin fecha» is not the
 * oldest date.
 */
export function compareCells(a: unknown, b: unknown, direction: SortDirection = 'asc'): number {
  const left = normalise(a);
  const right = normalise(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  let result: number;
  if (typeof left === 'number' && typeof right === 'number') result = left - right;
  else result = collator().compare(String(left), String(right));
  return direction === 'asc' ? result : -result;
}

/**
 * The sort of one table (QA B-01: no table header sorted anything).
 *
 * A click on a header sorts by that column ascending, a second click descending, a third returns
 * to the order the list arrived in — which is the order the server chose for a reason (newest
 * first, by code). The sort is stable, so equal values keep that order too.
 *
 * Client-side lists apply it with `apply()`/`sorted()`. A list the server pages reads `state()`
 * and sends it with the request instead, because sorting one page is sorting the wrong rows.
 */
export class TableSort<T, K extends string = string> {
  readonly state = signal<SortState<K>>({ key: null, direction: 'asc' });

  constructor(
    private readonly accessors: Partial<SortAccessors<T, K>> = {},
    initial?: SortState<K>,
    /** For columns not known in advance (an aging bucket per range): reads by key. */
    private readonly fallback?: (row: T, key: K) => unknown,
  ) {
    if (initial) this.state.set(initial);
  }

  toggle(key: K): void {
    this.state.update(({ key: current, direction }) => {
      if (current !== key) return { key, direction: 'asc' };
      if (direction === 'asc') return { key, direction: 'desc' };
      return { key: null, direction: 'asc' };
    });
  }

  /** `aria-sort` for a header: what a screen reader announces. */
  ariaSort(key: K): 'ascending' | 'descending' | 'none' {
    const { key: current, direction } = this.state();
    if (current !== key) return 'none';
    return direction === 'asc' ? 'ascending' : 'descending';
  }

  apply(rows: readonly T[]): T[] {
    const { key, direction } = this.state();
    if (!key) return [...rows];
    const read =
      this.accessors[key] ??
      (this.fallback ? (row: T) => this.fallback!(row, key) : (row: T) => (row as Record<string, unknown>)[key]);
    return rows
      .map((row, index) => ({ row, index, value: read(row) }))
      .sort((a, b) => compareCells(a.value, b.value, direction) || a.index - b.index)
      .map(({ row }) => row);
  }

  /** The rows, sorted whenever either changes. */
  sorted(rows: () => readonly T[]): Signal<T[]> {
    return computed(() => this.apply(rows()));
  }
}

/**
 * A sortable view of a list: `readonly table = sortable(() => this.taxes(), { type: (t) => … })`,
 * then `<table [appSort]="table.sort">` and `@for (tax of table.rows(); …)`.
 *
 * The rows are read lazily, so the list may be declared after this field. A column without an
 * accessor sorts by the row property of the same name.
 */
export function sortable<T, K extends string = string>(
  rows: () => readonly T[] | null | undefined,
  accessors: Partial<SortAccessors<T, K>> = {},
  initial?: SortState<K>,
  fallback?: (row: T, key: K) => unknown,
): { sort: TableSort<T, K>; rows: Signal<T[]> } {
  const sort = new TableSort<T, K>(accessors, initial, fallback);
  return { sort, rows: sort.sorted(() => rows() ?? []) };
}
