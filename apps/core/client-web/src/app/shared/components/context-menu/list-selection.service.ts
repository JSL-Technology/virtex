import { Injectable, computed, signal } from '@angular/core';

/**
 * Selección múltiple de una lista.
 *
 * La provee la PÁGINA que quiere acciones en lote (`providers: [ListSelectionService]`): así una
 * instancia por lista, y las directivas del menú (`appTableMenu`/`appRowMenu`) la inyectan de forma
 * opcional. Una tabla que no la provee sigue teniendo menú contextual de fila única.
 *
 * Mantiene el ORDEN de las filas visibles para que la selección por rango (Shift+clic) funcione, y
 * descarta al re-listar lo que ya no existe, para no operar en lote sobre filas fantasma.
 */
@Injectable()
export class ListSelectionService<E = unknown> {
  private readonly ids = signal<ReadonlySet<string>>(new Set());
  private items = new Map<string, E>();
  private order: string[] = [];
  private anchor: string | null = null;

  readonly count = computed(() => this.ids().size);
  readonly selected = computed<E[]>(() =>
    [...this.ids()].map((id) => this.items.get(id)).filter((row): row is E => row !== undefined),
  );

  /** La lista declara las filas que muestra, en orden. Llamar cuando cambian (búsqueda, recarga). */
  setItems(rows: readonly E[], idOf: (row: E) => string): void {
    this.items = new Map(rows.map((row) => [idOf(row), row]));
    this.order = rows.map(idOf);
    const kept = new Set([...this.ids()].filter((id) => this.items.has(id)));
    if (kept.size !== this.ids().size) this.ids.set(kept);
  }

  isSelected(id: string): boolean {
    return this.ids().has(id);
  }

  toggle(id: string): void {
    const next = new Set(this.ids());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.ids.set(next);
    this.anchor = id;
  }

  selectOnly(id: string): void {
    this.ids.set(new Set([id]));
    this.anchor = id;
  }

  selectRange(toId: string): void {
    const from = this.anchor ? this.order.indexOf(this.anchor) : -1;
    const to = this.order.indexOf(toId);
    if (from < 0 || to < 0) {
      this.selectOnly(toId);
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.ids.set(new Set(this.order.slice(lo, hi + 1)));
  }

  allSelected(): boolean {
    return this.order.length > 0 && this.order.every((id) => this.ids().has(id));
  }

  toggleAll(): void {
    this.ids.set(this.allSelected() ? new Set() : new Set(this.order));
  }

  clear(): void {
    this.ids.set(new Set());
    this.anchor = null;
  }
}
