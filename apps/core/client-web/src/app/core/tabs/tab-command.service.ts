import { Injectable, inject } from '@angular/core';
import { TabStateService } from './tab-state.service';
import { TabPreferencesService } from './tab-preferences.service';
import { TabSearchService } from './tab-search.service';
import { ShortcutId } from '../keyboard/keyboard-shortcuts';

/**
 * The layout actions that need Dockview — split, float, pop out, maximise — acting on whatever tab
 * is active. {@link TabContainerComponent} implements this and registers it, because only it holds
 * the Dockview api and the live panels; the keyboard handler must not reach into Dockview itself.
 */
export interface TabLayoutController {
  splitActive(direction: 'right' | 'below'): void;
  floatActive(): void;
  popoutActive(): void;
  toggleMaximizeActive(): void;
}

/**
 * Runs a tab/layout shortcut on the ACTIVE tab.
 *
 * ## Why this exists
 *
 * Every tab-context-menu action now has a keyboard shortcut, and the menu's `run` closures act on
 * the right-clicked panel — no use to a keyboard that has no panel in hand. This service is the
 * keyboard's counterpart: given a {@link ShortcutId} it performs the same action on the active tab.
 * The state actions (close, duplicate, pin…) it does directly through {@link TabStateService}; the
 * layout ones it forwards to the {@link TabLayoutController} the tab container registers, so there
 * is exactly one place that knows how each action is carried out and the handler stays Dockview-free.
 */
@Injectable({ providedIn: 'root' })
export class TabCommandsService {
  private readonly tabState = inject(TabStateService);
  private readonly prefs = inject(TabPreferencesService);
  private readonly tabSearch = inject(TabSearchService);

  private layout: TabLayoutController | null = null;

  /** The tab container registers (and, on teardown, clears) its Dockview-backed layout actions. */
  registerLayout(controller: TabLayoutController | null): void {
    this.layout = controller;
  }

  /**
   * Perform a shortcut on the active tab. Returns true when it was handled — the caller then
   * `preventDefault`s — and false when there was nothing to act on, so the keystroke is left alone.
   */
  run(id: ShortcutId): boolean {
    const activeId = this.tabState.activeTabId();

    switch (id) {
      case 'tabs.close':
        return activeId ? (this.tabState.closeActive(), true) : false;
      case 'tabs.reopen':
        this.tabState.reopenLastClosed();
        return true;
      case 'tabs.next':
        this.tabState.activateRelative(1);
        return true;
      case 'tabs.previous':
        this.tabState.activateRelative(-1);
        return true;
      case 'tabs.close_others':
        return activeId ? (this.tabState.closeOthers(activeId), true) : false;
      case 'tabs.close_right':
        return activeId ? (this.tabState.closeToRight(activeId), true) : false;
      case 'tabs.close_all':
        this.tabState.closeAll();
        return true;
      case 'tabs.duplicate':
        return activeId ? (this.tabState.duplicateTab(activeId), true) : false;
      case 'tabs.pin':
        return activeId ? (this.togglePin(activeId), true) : false;
      case 'tabs.preview_toggle':
        this.prefs.toggleEnablePreview();
        return true;
      case 'tabs.search':
        this.tabSearch.toggle();
        return true;

      case 'layout.split_right':
        return this.withLayout((l) => l.splitActive('right'));
      case 'layout.split_below':
        return this.withLayout((l) => l.splitActive('below'));
      case 'layout.float':
        return this.withLayout((l) => l.floatActive());
      case 'layout.popout':
        return this.withLayout((l) => l.popoutActive());
      case 'layout.maximize':
        return this.withLayout((l) => l.toggleMaximizeActive());

      default:
        return false;
    }
  }

  private togglePin(id: string): void {
    const tab = this.tabState.tabs().find((t) => t.id === id);
    if (tab?.isPinned) this.tabState.unpinTab(id);
    else this.tabState.pinTab(id);
  }

  private withLayout(action: (controller: TabLayoutController) => void): boolean {
    if (!this.layout) return false;
    action(this.layout);
    return true;
  }
}
