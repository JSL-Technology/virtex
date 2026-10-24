import { Directive, inject, input } from '@angular/core';
import { ContextMenuService } from './context-menu.service';
import { ListSelectionService } from './list-selection.service';
import { ListMenuConfig, MenuContext, MenuSection } from './context-menu.types';

/**
 * Da menú contextual a una `<table>` (y, por el inyector de elemento, a sus filas).
 *
 * Vive en el MISMO template que la tabla y sus `<tr>`, así que su instancia y el
 * `ListSelectionService` que la rodea son inyectables por `appRowMenu` — lo que no sería posible si
 * esto viviera en `vx-list-shell`, porque la tabla se proyecta y el contenido proyectado se inyecta
 * desde donde se DECLARA (la página), no desde el armazón.
 *
 * Aquí sólo se responde el clic en el cromo/vacío de la tabla; una fila responde el suyo (y hace
 * `stopPropagation`), igual que en el navegador el menú de un enlace gana al de la página.
 */
@Directive({
  selector: 'table[appTableMenu], [appTableMenu]',
  standalone: true,
  exportAs: 'appTableMenu',
  host: { '(contextmenu)': 'onContextMenu($event)' },
})
export class TableMenuDirective<E = unknown> {
  readonly config = input.required<ListMenuConfig<E>>({ alias: 'appTableMenu' });

  /** Opcional: presente sólo si la página la provee para acciones en lote. */
  readonly selection = inject<ListSelectionService<E> | null>(ListSelectionService, { optional: true });
  private readonly menu = inject(ContextMenuService);

  onContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('tbody tr')) return;
    this.open(event);
  }

  /** También lo usa el botón ⋮ de la cabecera. */
  open(event: MouseEvent): void {
    const sections = (this.config().table ?? []) as MenuSection[];
    this.menu.open(event, sections, this.context(event));
  }

  context(event: MouseEvent | KeyboardEvent): MenuContext<E> {
    return { kind: 'table', selection: this.selection?.selected() ?? [], event };
  }
}
