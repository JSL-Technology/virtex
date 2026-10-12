import { Component, ChangeDetectionStrategy, ElementRef, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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

        <!--
          Ranura de acción de ancho fijo: el punto de «cambios sin guardar» y el botón de cierre
          viven en el MISMO sitio (superpuestos y centrados). Así la × aparece justo donde estaba
          el punto al pasar el ratón, y —al reservarse siempre— el título se trunca en el mismo
          lugar tenga punto, × o nada.
        -->
        <span class="tab-action">
          @if (t.isDirty) {
            <span class="tab-dirty-dot" aria-hidden="true"></span>
          }
          @if (t.isCloseable) {
            <!-- Pointer target only. The focusable tab is Dockview's element, and a button inside a
                 tab is a control nested in a control (axe «nested-interactive», QA A-04): from the
                 keyboard the tab closes with Supr/Delete or the close-tab shortcut. -->
            <button
              class="tab-close"
              type="button"
              tabindex="-1"
              aria-hidden="true"
              [title]="'tabs.close_tab' | translate"
              (pointerdown)="$event.stopPropagation()"
              (click)="close($event)"
            >
              <lucide-icon [img]="XIcon" size="14"></lucide-icon>
            </button>
          }
        </span>
      </div>
    }
  `,
  styleUrls: ['./tab-header.component.scss'],
})
export class TabHeaderComponent {
  private tabState = inject(TabStateService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private translate = inject(TranslateService);

  constructor() {
    // The tab's semantics belong on the element that takes focus — Dockview's `.dv-tab`, the child
    // of the `tablist` — not on a div inside it. Before, the focusable element had no role and the
    // inner one was a `tab` holding a button, so screen readers announced neither correctly.
    effect(() => {
      const t = this.tab();
      const el = this.host.nativeElement.closest<HTMLElement>('.dv-tab');
      if (!t || !el) return;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(this.isActive()));
      const label = t.isDirty ? this.translate.instant('tabs.unsaved_label', { title: t.title }) : t.title;
      el.setAttribute('aria-label', label);
      if (!el.dataset['vxKeys']) {
        el.dataset['vxKeys'] = '1';
        el.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key !== 'Delete') return;
          event.preventDefault();
          if (this.tab()?.isCloseable) void this.tabState.closeTab(this.tabId);
        });
      }
    });
  }

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
