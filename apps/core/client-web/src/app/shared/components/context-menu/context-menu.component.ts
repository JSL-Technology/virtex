import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, ViewChild, computed, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { AuthService } from '../../../core/services/auth';
import { ContextMenuService } from './context-menu.service';
import { ContextMenuItemComponent } from './context-menu-item.component';
import { MenuContext, MenuItem, MenuSection } from './context-menu.types';
import { rowActionSections, screenActionSections } from './row-actions';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';

/**
 * El host único del menú contextual — se monta UNA vez en `app.html`.
 *
 * ## Por qué sobre `@angular/cdk/menu`
 *
 * `CdkContextMenuTrigger` + `CdkMenu` resuelven de fábrica lo difícil y propenso a bugs: apertura
 * en las coordenadas del cursor, navegación por teclado (flechas, type-ahead, Inicio/Fin, Esc),
 * roles ARIA, foco gestionado y devuelto, submenús y cierre al hacer clic fuera. Aquí sólo se
 * renderiza, data-driven, el descriptor que trae el servicio, y se registra el opener.
 *
 * ## Por qué un ancla de tamaño cero
 *
 * El trigger de contexto abre en coordenadas (`open({x, y})`), no en la posición del elemento; el
 * ancla sólo existe para que CDK tenga dónde colgar el overlay.
 */
@Component({
  selector: 'vx-context-menu',
  standalone: true,
  imports: [CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger, ContextMenuItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-menu.component.html',
  styleUrls: ['./context-menu.component.scss'],
})
export class ContextMenuComponent implements OnInit {
  private readonly service = inject(ContextMenuService);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly navigation = inject(NavigationActionsService, { optional: true });

  @ViewChild(CdkContextMenuTrigger, { static: true }) private trigger!: CdkContextMenuTrigger;

  protected readonly context = this.service.context;

  /** Ítems ocultos por permiso o `visible` quitados; secciones que quedan vacías, descartadas. */
  protected readonly visibleSections = computed<MenuSection[]>(() => {
    const ctx = this.service.context();
    if (!ctx) return [];
    return this.service
      .sections()
      .map((section) => ({ ...section, items: section.items.filter((item) => this.isVisible(item, ctx)) }))
      .filter((section) => section.items.length > 0);
  });

  ngOnInit(): void {
    this.service.registerHost({
      openAt: (x, y) => this.trigger.open({ x, y }),
      close: () => this.trigger.close(),
    });
    // Every table in the product has a menu: a row's own actions, the screen's commands on the
    // table's chrome (QA R3-B08). Last in the event's path, so a list that declared its menu
    // (`appRowMenu`, `appTableMenu`) has already answered and marked the event handled.
    const onMenu = (event: Event) => this.openForTable(event as MouseEvent | KeyboardEvent);
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') this.openForTable(event);
    };
    this.document.addEventListener('contextmenu', onMenu);
    this.document.addEventListener('keydown', onKey);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('contextmenu', onMenu);
      this.document.removeEventListener('keydown', onKey);
    });
  }

  private openForTable(event: MouseEvent | KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    // A field keeps the browser's own menu (copy, paste, spelling); the menu itself is not a table.
    if (!target || target.closest('input, textarea, select, [contenteditable], .cdk-overlay-container')) return;
    // A table row, or any item a screen marks as one (an inbox's request, a card).
    const row = target.closest<HTMLElement>('tbody tr, [data-context-item]');
    const table = target.closest<HTMLElement>('table');
    if (!row && !table) return;
    const sections = [
      ...(row ? rowActionSections(row, this.navigation) : []),
      ...(table ? screenActionSections(table) : []),
    ];
    if (sections.length === 0) return;
    this.service.open(event, sections, { kind: row ? 'row' : 'table', selection: [], event });
  }

  protected isVisible(item: MenuItem, ctx: MenuContext): boolean {
    if (item.visible && !item.visible(ctx)) return false;
    if (item.permission) {
      const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
      if (!this.auth.hasPermissions(needed)) return false;
    }
    return true;
  }

  protected isDisabled(item: MenuItem, ctx: MenuContext | null): boolean {
    return !!ctx && !!item.disabled && item.disabled(ctx);
  }

  protected async run(item: MenuItem): Promise<void> {
    const ctx = this.service.context();
    if (ctx && item.run) await item.run(ctx);
  }
}
