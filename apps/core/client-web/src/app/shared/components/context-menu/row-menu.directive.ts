import { Directive, inject, input } from '@angular/core';
import { ContextMenuService } from './context-menu.service';
import { ListSelectionService } from './list-selection.service';
import { TableMenuDirective } from './table-menu.directive';
import { MenuContext, MenuSection } from './context-menu.types';

/**
 * Da menú contextual a una fila `<tr appRowMenu="producto">`. Compañera de `appRowLink`.
 *
 * Toma la config y la selección de su `appTableMenu` ancestro (por el inyector de elemento) y, al
 * abrir, construye el contexto de fila: la entidad y la selección vigente. Si la fila no está en la
 * selección múltiple, al abrir se selecciona sólo ella —como Finder o el Explorador—, de modo que
 * una acción de lote nunca se ejecuta sobre algo que el usuario no ve marcado.
 *
 * Abre con clic derecho, con `Shift+F10` / tecla Menú, y a petición del botón ⋮ (`open`).
 */
@Directive({
  selector: 'tr[appRowMenu], [appRowMenu]',
  standalone: true,
  exportAs: 'appRowMenu',
  host: {
    '(contextmenu)': 'onPointer($event)',
    '(keydown.shift.F10)': 'onKeyboard($event)',
    '(keydown.ContextMenu)': 'onKeyboard($event)',
  },
})
export class RowMenuDirective<E = unknown> {
  readonly entity = input.required<E>({ alias: 'appRowMenu' });
  /** Cómo leer un id estable de la entidad (para la selección). Por defecto, `.id`. */
  readonly rowId = input<(entity: E) => string>((entity) => String((entity as { id: unknown }).id));

  private readonly table = inject<TableMenuDirective<E>>(TableMenuDirective);
  private readonly selection = inject<ListSelectionService<E> | null>(ListSelectionService, { optional: true });
  private readonly menu = inject(ContextMenuService);

  onPointer(event: MouseEvent): void {
    event.stopPropagation();
    this.open(event);
  }

  onKeyboard(event: KeyboardEvent): void {
    event.stopPropagation();
    this.open(event);
  }

  open(event: MouseEvent | KeyboardEvent): void {
    const entity = this.entity();
    if (this.selection) {
      const id = this.rowId()(entity);
      if (!this.selection.isSelected(id)) this.selection.selectOnly(id);
    }
    const selection = this.selection && this.selection.count() > 0 ? this.selection.selected() : [entity];
    const ctx: MenuContext<E> = { kind: 'row', entity, selection, event };
    const config = this.table.config();
    const sections = [...(config.row ? config.row(ctx) : []), ...(config.table ?? [])] as MenuSection[];
    this.menu.open(event, sections, ctx as MenuContext);
  }
}
