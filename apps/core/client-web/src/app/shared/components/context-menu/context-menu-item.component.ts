import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Check, ChevronRight } from 'lucide-angular';
import { VxKbdComponent } from '../kbd';
import { MenuContext, MenuItem } from './context-menu.types';

/**
 * Una fila del menú: columna de marca · icono · etiqueta · atajo · flecha de submenú.
 *
 * Es sólo presentación —no decide nada— y calca la estructura del menú de pestañas de Dockview
 * (`tab-context-menu-item`): columna de check reservada a la izquierda, atajo empujado a la
 * derecha con `vx-kbd`, todo con tokens para que coincida en ambos temas. El botón `cdkMenuItem`
 * que la envuelve (en el host) es quien tiene el rol y el foco.
 */
@Component({
  selector: 'app-context-menu-item',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, VxKbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="vx-ctx-item__check">
      @if (checked()) {
        <lucide-icon [img]="CheckIcon" size="14" aria-hidden="true" />
      }
    </span>
    @if (item().icon; as icon) {
      <lucide-icon class="vx-ctx-item__icon" [img]="icon" size="16" aria-hidden="true" />
    }
    <span class="vx-ctx-item__label">{{ label().key | translate: label().params }}</span>
    @if (item().chord; as chord) {
      <vx-kbd class="vx-ctx-item__kbd" [chord]="chord" />
    }
    @if (hasSubmenu()) {
      <lucide-icon class="vx-ctx-item__chevron" [img]="ChevronIcon" size="14" aria-hidden="true" />
    }
  `,
  styleUrls: ['./context-menu-item.component.scss'],
})
export class ContextMenuItemComponent {
  readonly item = input.required<MenuItem>();
  readonly ctx = input<MenuContext | null>(null);
  readonly hasSubmenu = input(false);

  protected readonly CheckIcon = Check;
  protected readonly ChevronIcon = ChevronRight;

  protected readonly label = computed<{ key: string; params?: Record<string, unknown> }>(() => {
    const raw = this.item().label;
    const value = typeof raw === 'function' ? raw(this.ctx() ?? EMPTY_CONTEXT) : raw;
    return typeof value === 'string' ? { key: value, params: undefined } : value;
  });

  protected readonly checked = computed(() => {
    const ctx = this.ctx();
    const fn = this.item().checked;
    return !!ctx && !!fn && fn(ctx);
  });
}

/** Para resolver un label de función cuando aún no hay contexto (no debería ocurrir en uso real). */
const EMPTY_CONTEXT: MenuContext = { kind: 'empty', selection: [], event: new MouseEvent('contextmenu') };
