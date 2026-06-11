import { Component, OnInit, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DockviewAngularComponent, DockviewReadyEvent, IDockviewPanel } from 'dockview-angular';
import { TabStateService } from '../tab-state.service';
import { TabModel } from '../tab.model';
import { TabWrapperComponent } from './tab-wrapper.component';
import { TabRegistryService } from '../tab-registry.service';

@Component({
  selector: 'app-tab-container',
  standalone: true,
  imports: [CommonModule, DockviewAngularComponent],
  template: `
    <div class="dockview-container">
      <dv-dockview
        [components]="components"
        (ready)="onReady($event)"
        class="dockview-theme-abyss"
      >
      </dv-dockview>
    </div>
  `,
  styles: [`
    .dockview-container {
      height: 100%;
      width: 100%;
    }
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `]
})
export class TabContainerComponent implements OnInit {
  private tabState = inject(TabStateService);
  private tabRegistry = inject(TabRegistryService);
  private dockviewApi: any;
  private panels = new Map<string, IDockviewPanel>();

  readonly components = {
    tabWrapper: TabWrapperComponent,
  };

  constructor() {
    effect(() => {
      const tabs = this.tabState.tabs();
      if (this.dockviewApi) {
        this.syncTabs(tabs);
      }
    });

    effect(() => {
      const activeTabId = this.tabState.activeTabId();
      if (this.dockviewApi && activeTabId) {
        const panel = this.panels.get(activeTabId);
        if (panel) {
          panel.setActive();
        }
      }
    });
  }

  ngOnInit(): void {}

  onReady(event: DockviewReadyEvent): void {
    this.dockviewApi = event.api;
    this.syncTabs(this.tabState.tabs());
  }

  private syncTabs(tabs: TabModel[]): void {
    // Add new tabs
    tabs.forEach(tab => {
      if (!this.panels.has(tab.id)) {
        const definition = this.tabRegistry.getDefinitionByRoute(tab.route);
        if (!definition) return;

        const panel = this.dockviewApi.addPanel({
          id: tab.id,
          component: 'tabWrapper',
          title: tab.title,
          params: {
             componentType: definition.component,
             componentInputs: { ...tab.routeParams, ...tab.queryParams }
          }
        });

        this.panels.set(tab.id, panel);

        panel.onDidActiveChange(() => {
          if (panel.isActive) {
            this.tabState.activateTab(tab.id);
          }
        });

        panel.onDidClose(() => {
          this.tabState.closeTab(tab.id);
          this.panels.delete(tab.id);
        });
      } else {
        // Update existing panel if title changed
        const panel = this.panels.get(tab.id);
        if (panel && panel.title !== tab.title) {
          panel.setTitle(tab.title);
        }
      }
    });

    // Remove closed tabs
    this.panels.forEach((panel, id) => {
      if (!tabs.find(t => t.id === id)) {
        panel.close();
        this.panels.delete(id);
      }
    });
  }
}
