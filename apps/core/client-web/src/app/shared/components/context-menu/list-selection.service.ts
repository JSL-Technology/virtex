import { Injectable, computed, signal } from '@angular/core';

/**
 * Selección múltiple de una lista.
 *
 * La provee la PÁGINA que quiere acciones en lote (`providers: [ListSelectionService]`): así una
 * instancia por lista, y las directivas del menú (`appTableMenu`/`appRowMenu`), la columna de
 * selección (`vxSelectAll`/`vxSelect`) y la barra de la selección (`vx-bulk-bar`) la inyectan.
 * Una tabla que no la provee sigue teniendo menú contextual de fila única.
 *
 * Mantiene el ORDEN de las filas visibles para que la selección por rango (Shift+clic) funcione, y
 * descarta al re-listar lo que ya no existe, para no operar en lote sobre filas fantasma. El orden es
 * una señal como la selección: «todas seleccionadas» tiene que cambiar cuando llega una fila nueva
 * sin que cambie lo seleccionado.
 */
@Injectable()
export class ListSelectionService<E = unknown> {
  private readonly ids = signal<ReadonlySet<string>>(new Set());
  private readonly order = signal<readonly string[]>([]);
  private items = new Map<string, E>();
  private anchor: string | null = null;

  readonly count = computed(() => this.ids().size);
  /** Cuántas filas se pueden seleccionar: las que la lista muestra. */
  readonly size = computed(() => this.order().length);
  readonly selected = computed<E[]>(() =>
    [...this.ids()].map((id) => this.items.get(id)).filter((row): row is E => row !== undefined),
  );
  readonly allSelected = computed(() => {
    const order = this.order();
    const ids = this.ids();
    return order.length > 0 && order.every((id) => ids.has(id));
  });

  /** La lista declara las filas que muestra, en orden. Llamar cuando cambian (búsqueda, recarga). */
  setItems(rows: readonly E[], idOf: (row: E) => string): void {
    this.items = new Map(rows.map((row) => [idOf(row), row]));
    this.order.set(rows.map(idOf));
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
    const order = this.order();
    const from = this.anchor ? order.indexOf(this.anchor) : -1;
    const to = order.indexOf(toId);
    if (from < 0 || to < 0) {
      this.selectOnly(toId);
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.ids.set(new Set(order.slice(lo, hi + 1)));
  }

  toggleAll(): void {
    this.ids.set(this.allSelected() ? new Set() : new Set(this.order()));
  }

  clear(): void {
    this.ids.set(new Set());
    this.anchor = null;
  }
}
