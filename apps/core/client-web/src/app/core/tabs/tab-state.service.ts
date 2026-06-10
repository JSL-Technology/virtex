import { Injectable, signal, computed } from '@angular/core';
import { TabModel, TabType, OpenTabConfig } from './tab.model';
import { TabRegistryService } from './tab-registry.service';

@Injectable({
  providedIn: 'root',
})
export class TabStateService {
  private tabsSignal = signal<TabModel[]>([]);
  private activeTabIdSignal = signal<string | null>(null);

  readonly tabs = this.tabsSignal.asReadonly();
  readonly activeTabId = this.activeTabIdSignal.asReadonly();
  readonly activeTab = computed(() =>
    this.tabsSignal().find(t => t.id === this.activeTabIdSignal()) || null
  );

  constructor(private tabRegistry: TabRegistryService) {}

  openTab(config: OpenTabConfig): void {
    const definition = this.tabRegistry.getDefinitionByRoute(config.route);
    if (!definition) {
      console.warn(`No tab definition found for route: ${config.route}`);
      return;
    }

    const routeParams = this.tabRegistry.getRouteParams(definition.pattern, config.route);
    const entityKey = definition.entityKeyFn ? definition.entityKeyFn(routeParams) : undefined;

    // Check if tab already exists
    if (entityKey) {
      const existingTab = this.tabsSignal().find(t => t.entityKey === entityKey);
      if (existingTab) {
        this.activateTab(existingTab.id);
        return;
      }
    }

    const newTab: TabModel = {
      id: `tab_${Math.random().toString(36).substr(2, 9)}`,
      type: definition.tabType,
      title: config.title || definition.title || 'Nueva Pestaña',
      icon: config.icon || definition.icon || 'File',
      route: config.route,
      routeParams,
      queryParams: config.queryParams,
      isDirty: false,
      isLoading: false,
      isCloseable: definition.isCloseable !== false,
      isPinned: definition.tabType === TabType.PINNED,
      entityKey,
      createdAt: new Date(),
      lastActivatedAt: new Date(),
    };

    this.tabsSignal.update(tabs => [...tabs, newTab]);
    this.activateTab(newTab.id);
  }

  activateTab(tabId: string): void {
    this.tabsSignal.update(tabs => tabs.map(t =>
      t.id === tabId ? { ...t, lastActivatedAt: new Date() } : t
    ));
    this.activeTabIdSignal.set(tabId);
  }

  closeTab(tabId: string): void {
    const tab = this.tabsSignal().find(t => t.id === tabId);
    if (!tab) return;

    if (tab.isDirty) {
      // In a real app, show a dialog. For now, just logic.
      if (!confirm(`Tienes cambios sin guardar en ${tab.title}. ¿Cerrar de todos modos?`)) {
        return;
      }
    }

    this.tabsSignal.update(tabs => tabs.filter(t => t.id !== tabId));

    if (this.activeTabIdSignal() === tabId) {
      const remainingTabs = this.tabsSignal();
      if (remainingTabs.length > 0) {
        this.activateTab(remainingTabs[remainingTabs.length - 1].id);
      } else {
        this.activeTabIdSignal.set(null);
      }
    }
  }

  markDirty(tabId: string, isDirty: boolean = true): void {
    this.tabsSignal.update(tabs => tabs.map(t =>
      t.id === tabId ? { ...t, isDirty } : t
    ));
  }

  updateTitle(tabId: string, title: string): void {
    this.tabsSignal.update(tabs => tabs.map(t =>
      t.id === tabId ? { ...t, title } : t
    ));
  }

  getTabByEntityKey(key: string): TabModel | null {
    return this.tabsSignal().find(t => t.entityKey === key) || null;
  }

  setTabs(tabs: TabModel[]): void {
    this.tabsSignal.set(tabs);
  }
}
