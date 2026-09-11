import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
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
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab(); as t) {
      <div
        class="tab-header"
        role="tab"
        [attr.aria-selected]="isActive()"
        [class.is-dirty]="t.isDirty"
        [class.is-pinned]="t.isPinned"
        [class.is-preview]="t.isPreview"
        [title]="t.title"
        (auxclick)="onAuxClick($event)"
        (dblclick)="keepOpen($event)"
      >
        <span class="tab-icon">
          <lucide-icon [img]="icon()" size="15"></lucide-icon>
        </span>

        <!-- El título ya viene resuelto del store (openTab traduce la clave). NO se aplica el pipe
             translate aquí: volvería a traducir un texto ya resuelto y el handler de faltantes lo
             envolvería como [[Inicio]]. -->
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
            [attr.aria-label]="'TABS.CLOSE_TAB' | translate"
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

  /** Para `aria-selected`: la franja de pestañas es un `tablist` y esta es la seleccionada. */
  readonly isActive = computed(() => this.tabState.activeTabId() === this.tabId);

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

  /**
   * Doble clic en la cabecera fija una vista previa (VS Code): la saca del modo
   * efímero para que deje de reutilizarse al abrir el siguiente registro.
   */
  keepOpen(event: Event): void {
    const t = this.tab();
    if (t?.isPreview) {
      event.stopPropagation();
      this.tabState.markPermanent(this.tabId);
    }
  }
}
