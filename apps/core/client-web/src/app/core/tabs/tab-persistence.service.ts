import { Injectable, effect } from '@angular/core';
import { TabStateService } from './tab-state.service';
import { TabModel } from './tab.model';

@Injectable({
  providedIn: 'root',
})
export class TabPersistenceService {
  private readonly STORAGE_KEY = 'erp_tab_session';

  constructor(private tabState: TabStateService) {
    // Automatically save state when tabs change
    effect(() => {
      this.saveState(this.tabState.tabs());
    });
  }

  private saveState(tabs: TabModel[]): void {
    try {
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(tabs));
    } catch (e) {
      console.error('Failed to save tab state to sessionStorage', e);
    }
  }

  restoreState(): void {
    try {
      const saved = sessionStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const tabs: TabModel[] = JSON.parse(saved);
        if (Array.isArray(tabs) && tabs.length > 0) {
          // Re-hydrate dates
          const hydratedTabs = tabs.map(t => ({
            ...t,
            createdAt: new Date(t.createdAt),
            lastActivatedAt: new Date(t.lastActivatedAt)
          }));
          this.tabState.setTabs(hydratedTabs);

          // Activate the most recently activated tab
          const mostRecent = [...hydratedTabs].sort((a, b) =>
            b.lastActivatedAt.getTime() - a.lastActivatedAt.getTime()
          )[0];

          this.tabState.activateTab(mostRecent.id);
        }
      }
    } catch (e) {
      console.error('Failed to restore tab state from sessionStorage', e);
    }
  }

  clearState(): void {
    sessionStorage.removeItem(this.STORAGE_KEY);
  }
}
