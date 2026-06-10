import { Injectable, effect } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { TabStateService } from './tab-state.service';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class TabRouterService {
  private isInternalNavigation = false;

  constructor(private router: Router, private tabState: TabStateService) {
    // Sync Router -> Tabs
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      if (!this.isInternalNavigation) {
        this.tabState.openTab({ route: event.urlAfterRedirects });
      }
      this.isInternalNavigation = false;
    });

    // Sync Tabs -> Router
    effect(() => {
      const activeTab = this.tabState.activeTab();
      if (activeTab) {
        this.isInternalNavigation = true;
        this.router.navigateByUrl(activeTab.route);
      }
    });
  }

  // Helper method to open a tab programmatically
  navigateToTab(route: string): void {
    this.tabState.openTab({ route });
  }
}
