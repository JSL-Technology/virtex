import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { TabStateService } from '../tab-state.service';
import { resolveTabIcon } from './tab-icon';

/**
 * Renderer de pestaña personalizado para Dockview. Muestra icono, título,
 * indicador de cambios sin guardar (●), badge y botón de cierre, con estilos
 * propios coherentes con el tema claro/oscuro (TAB_ARCHITECTURE §7.2, §11).
 *
 * Dockview asigna `params` y `api` como propiedades de la instancia.
 */
@Component({
  selector: 'app-tab-header',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab(); as t) {
      <div
        class="tab-header"
        [class.is-dirty]="t.isDirty"
        [class.is-pinned]="t.isPinned"
        [title]="t.title"
        (auxclick)="onAuxClick($event)"
      >
        <span class="tab-icon">
          <lucide-icon [img]="icon()" size="15"></lucide-icon>
        </span>

        <span class="tab-title">{{ t.title }}</span>

        @if (t.badge && t.badge > 0) {
          <span class="tab-badge">{{ t.badge > 99 ? '99+' : t.badge }}</span>
        }

        @if (t.isDirty) {
          <span class="tab-dirty-dot" aria-hidden="true"></span>
        }

        @if (t.isCloseable) {
          <button
            class="tab-close"
            type="button"
            aria-label="Cerrar pestaña"
            (pointerdown)="$event.stopPropagation()"
            (click)="close($event)"
          >
            <lucide-icon [img]="XIcon" size="14"></lucide-icon>
          </button>
        }
      </div>
    }
  `,
  styleUrls: ['./tab-header.component.scss'],
})
export class TabHeaderComponent {
  private tabState = inject(TabStateService);

  /** Inyectado por Dockview. */
  params: { tabId?: string } = {};
  api: any;

  protected readonly XIcon = X;

  private get tabId(): string {
    return this.params?.tabId ?? this.api?.id ?? '';
  }

  readonly tab = computed(() =>
    this.tabState.tabs().find((t) => t.id === this.tabId) ?? null
  );

  readonly icon = computed(() => resolveTabIcon(this.tab()?.icon));

  close(event: Event): void {
    event.stopPropagation();
    void this.tabState.closeTab(this.tabId);
  }

  onAuxClick(event: MouseEvent): void {
    // Botón central del ratón cierra la pestaña.
    if (event.button === 1) {
      event.preventDefault();
      const t = this.tab();
      if (t?.isCloseable) void this.tabState.closeTab(this.tabId);
    }
  }
}
