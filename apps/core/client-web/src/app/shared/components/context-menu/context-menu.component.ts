import { ChangeDetectionStrategy, Component, OnInit, ViewChild, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { AuthService } from '../../../core/services/auth';
import { ContextMenuService } from './context-menu.service';
import { ContextMenuItemComponent } from './context-menu-item.component';
import { MenuContext, MenuItem, MenuSection } from './context-menu.types';

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
  imports: [NgTemplateOutlet, CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger, ContextMenuItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-menu.component.html',
  styleUrls: ['./context-menu.component.scss'],
})
export class ContextMenuComponent implements OnInit {
  private readonly service = inject(ContextMenuService);
  private readonly auth = inject(AuthService);

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
