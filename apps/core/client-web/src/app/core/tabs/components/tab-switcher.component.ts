import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Layers, X } from 'lucide-angular';
import { TabStateService } from '../tab-state.service';
import { WindowModeService } from '../../windows/window-mode.service';
import { ClickOutsideDirective } from '../../../shared/directives/click-outside.directive';
import { resolveTabIcon } from './tab-icon';

/**
 * Selector de pestañas para el modo compacto.
 *
 * ## Por qué existe
 *
 * En pantalla estrecha la franja de pestañas se esconde —una fila que en 600 px no sobra—, pero sin
 * un sustituto eso convertía las pestañas en una trampa: abrías un registro y el anterior desaparecía
 * sin ninguna forma de volver a él (no hay franja, y los atajos de teclado no existen en táctil). Este
 * desplegable devuelve el acceso a todas las pestañas abiertas: cambiar de una a otra y cerrarlas.
 *
 * Solo se muestra en compacto; en enfocado y taller la franja ya hace este trabajo.
 */
@Component({
  selector: 'app-tab-switcher',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, ClickOutsideDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowMode.mode() === 'compact') {
      <div class="tab-switcher" appClickOutside (clickOutside)="dismiss()">
        <button
          type="button"
          class="icon-button ts-trigger"
          [attr.aria-label]="'TABS.OPEN_TABS_ARIA' | translate"
          [attr.aria-expanded]="open()"
          aria-haspopup="true"
          (click)="toggle()"
        >
          <lucide-icon [img]="LayersIcon" size="20" aria-hidden="true"></lucide-icon>
          @if (tabState.tabs().length > 0) {
            <span class="ts-count">{{ tabState.tabs().length }}</span>
          }
        </button>

        @if (open()) {
          <div class="ts-dropdown" role="menu">
            <div class="ts-header">{{ 'TABS.OPEN_TABS' | translate }}</div>
            <ul class="ts-list">
              @for (tab of tabState.tabs(); track tab.id) {
                <li class="ts-item" [class.is-active]="tab.id === tabState.activeTabId()">
                  <button type="button" class="ts-item__main" role="menuitem" (click)="choose(tab.id)">
                    <lucide-icon [img]="icon(tab.icon)" size="16" class="ts-item__icon" aria-hidden="true"></lucide-icon>
                    <span class="ts-item__title" [class.is-preview]="tab.isPreview">{{ tab.title }}</span>
                    @if (tab.isDirty) {
                      <span class="ts-item__dot" aria-hidden="true"></span>
                    }
                  </button>
                  @if (tab.isCloseable) {
                    <button
                      type="button"
                      class="ts-item__close"
                      [attr.aria-label]="'TABS.CLOSE_TAB' | translate"
                      (click)="close(tab.id)"
                    >
                      <lucide-icon [img]="XIcon" size="14" aria-hidden="true"></lucide-icon>
                    </button>
                  }
                </li>
              } @empty {
                <li class="ts-empty">{{ 'TABS.NO_OPEN_TABS' | translate }}</li>
              }
            </ul>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .tab-switcher { position: relative; display: inline-block; }

    .ts-count {
      position: absolute;
      top: 2px;
      right: 2px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: var(--text-2xs);
      font-weight: var(--font-bold);
      line-height: 1;
      color: var(--content-inverse);
      background: var(--accent-primary);
      border-radius: var(--radius-full);
      pointer-events: none;
    }

    .ts-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: min(84vw, 320px);
      max-height: 70vh;
      overflow-y: auto;
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      background: var(--surface-overlay);
      border: 1px solid var(--border-default);
      z-index: var(--z-dropdown);
    }

    .ts-header {
      padding: 0.6rem 0.85rem;
      font-size: var(--text-2xs);
      font-weight: var(--font-bold);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-tertiary);
      border-bottom: 1px solid var(--border-subtle);
    }

    .ts-list { list-style: none; margin: 0; padding: var(--space-1); }

    .ts-item {
      display: flex;
      align-items: center;
      border-radius: var(--radius-md);
    }
    .ts-item.is-active { background: var(--primary-light); }

    .ts-item__main {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      color: var(--text-secondary);
    }
    .ts-item.is-active .ts-item__main { color: var(--accent-primary); }
    .ts-item__main:hover { color: var(--text-primary); }

    .ts-item__icon { flex-shrink: 0; color: var(--text-tertiary); }
    .ts-item.is-active .ts-item__icon { color: var(--accent-primary); }

    .ts-item__title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--text-sm);
      font-weight: var(--font-medium);
    }
    .ts-item__title.is-preview { font-style: italic; font-weight: var(--font-normal); }

    .ts-item__dot {
      flex-shrink: 0;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent-primary);
    }

    .ts-item__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      margin-right: var(--space-1);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-tertiary);
      cursor: pointer;
    }
    .ts-item__close:hover { background: var(--bg-hover); color: var(--text-primary); }

    .ts-empty {
      padding: var(--space-4);
      text-align: center;
      font-size: var(--text-sm);
      color: var(--text-tertiary);
    }
  `],
})
export class TabSwitcherComponent {
  protected readonly tabState = inject(TabStateService);
  protected readonly windowMode = inject(WindowModeService);

  protected readonly open = signal(false);

  protected readonly LayersIcon = Layers;
  protected readonly XIcon = X;

  protected icon(name: string): unknown {
    return resolveTabIcon(name);
  }

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected dismiss(): void {
    this.open.set(false);
  }

  protected choose(tabId: string): void {
    this.tabState.activateTab(tabId);
    this.open.set(false);
  }

  protected close(tabId: string): void {
    void this.tabState.closeTab(tabId);
  }
}
