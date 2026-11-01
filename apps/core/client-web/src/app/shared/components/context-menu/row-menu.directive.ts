import { Directive, ElementRef, inject, input } from '@angular/core';
import { ContextMenuService } from './context-menu.service';
import { rowLinkOf, rowNavigationSections } from './row-navigation';
import { screenActionSections } from './row-actions';
import { Share2 } from 'lucide-angular';
import { RELATIONSHIP_MAP_PERMISSION, relationshipMapPath } from '../relationship-map-link/relationship-map-link.component';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly navigation = inject(NavigationActionsService, { optional: true });

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
    // One row: its destinations first, then what can be done to it, then its link to share; the
    // table's own actions last. Several rows: only what applies to all of them (QA R3-B08).
    const link = selection.length === 1 && this.navigation ? rowLinkOf(this.host.nativeElement) : null;
    const navigation = link && this.navigation ? rowNavigationSections(link, this.navigation) : null;
    const mapType = config.relationshipMapType;
    const relationship: MenuSection[] =
      mapType && selection.length === 1 && this.navigation
        ? [
            {
              id: 'relationships',
              items: [
                {
                  id: 'relationship-map',
                  label: 'relationship_map.title',
                  icon: Share2,
                  permission: RELATIONSHIP_MAP_PERMISSION,
                  run: () => this.navigation!.open(relationshipMapPath(mapType, this.rowId()(entity)), 'preview'),
                },
              ],
            },
          ]
        : [];
    const sections = [
      ...(navigation ? [navigation.open] : []),
      ...(config.row ? config.row(ctx) : []),
      ...relationship,
      ...(navigation ? [navigation.share] : []),
      ...(config.table ?? screenActionSections(this.table.host.nativeElement)),
    ] as MenuSection[];
    this.menu.open(event, sections, ctx as MenuContext);
  }
}
