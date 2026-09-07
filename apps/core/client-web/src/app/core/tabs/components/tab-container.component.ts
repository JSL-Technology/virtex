import {
  Component, inject, effect, ChangeDetectionStrategy, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import {
  DockviewAngularComponent, DockviewReadyEvent, IDockviewPanel,
  themeLight, themeDark,
} from 'dockview-angular';
import type {
  ContextMenuItem, GetTabContextMenuItemsParams,
} from 'dockview-angular';
import { TabStateService } from '../tab-state.service';
import { TabRegistryService } from '../tab-registry.service';
import { TabModel, TabType } from '../tab.model';
import { TabContext } from '../tab-context';
import { TabWrapperComponent } from './tab-wrapper.component';
import { TabHeaderComponent } from './tab-header.component';
import { GroupControlsComponent } from './group-controls.component';
import { ThemeService } from '../../services/theme';
import { WindowModeService } from '../../windows/window-mode.service';

/**
 * Hospeda Dockview y mapea el signal `tabs` ↔ paneles (TAB_ARCHITECTURE §11).
 * Usa renderers Angular personalizados para el contenido (lazy) y para la
 * pestaña (themed), y mantiene el panel activo y el orden sincronizados.
 */
@Component({
  selector: 'app-tab-container',
  standalone: true,
  imports: [CommonModule, DockviewAngularComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      El modo se refleja en una clase del contenedor: en compacto la franja de pestañas desaparece
      —ocupa una fila que en 600 px no sobra— y la ventana activa ocupa todo. En taller no se
      esconde nada.
    -->
    <div class="dockview-container" [class]="'dockview-container--' + windowMode.mode()">
      <dv-dockview
        class="dockview-theme-virtex"
        [components]="components"
        [tabComponents]="tabComponents"
        [rightHeaderActionsComponent]="rightHeaderActions"
        [getTabContextMenuItems]="tabContextMenuItems"
        [theme]="dvTheme()"
        [singleTabMode]="'default'"
        [scrollbars]="'custom'"
        (ready)="onReady($event)"
      ></dv-dockview>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .dockview-container { height: 100%; width: 100%; }

    /*
      Modo compacto: sin franja de pestañas. Se navega con el riel y el panel, que en esta anchura
      ya son un cajón deslizante; una fila de pestañas encima sería una tercera navegación en la
      pantalla donde menos sitio hay.
    */
    .dockview-container--compact ::ng-deep .dv-tabs-and-actions-container { display: none; }
  `],
})
export class TabContainerComponent {
  private tabState = inject(TabStateService);
  private registry = inject(TabRegistryService);
  private themeService = inject(ThemeService);
  protected readonly windowMode = inject(WindowModeService);
  private translate = inject(TranslateService);

  private dockviewApi: any;
  private panels = new Map<string, IDockviewPanel>();
  private syncing = false;

  readonly components = { tabWrapper: TabWrapperComponent };
  readonly tabComponents = { default: TabHeaderComponent };
  readonly rightHeaderActions = GroupControlsComponent;

  readonly dvTheme = computed(() =>
    this.themeService.appliedTheme() === 'dark' ? themeDark : themeLight
  );

  /**
   * Menú contextual de pestañas (clic derecho). Sistema de ventanas avanzado:
   * cerrar/cerrar otras/derecha/todas, duplicar, fijar y — clave para el layout
   * pedido — dividir el panel a un lado (una ventana al lado de la otra) y
   * maximizar/restaurar (TAB_ARCHITECTURE §6, §11).
   */
  readonly tabContextMenuItems = (
    params: GetTabContextMenuItemsParams
  ): ContextMenuItem[] => {
    const { panel, api } = params;
    const tab = this.tabState.tabs().find((t) => t.id === panel.id);
    const isPinnedType = tab?.type === TabType.PINNED;
    const maximized = api.hasMaximizedGroup();
    const t = (key: string) => this.translate.instant(key);

    //  Dividir, sacar a flotante y maximizar solo aparecen en el taller. En modo enfocado no es que
    //  estén deshabilitados: es que no forman parte de esa manera de trabajar, y un menú que
    //  ofrece la mitad de sus opciones en gris enseña a no leerlo.
    const workshop: ContextMenuItem[] = this.windowMode.canTile()
      ? [
          'separator',
          {
            label: t('TABS.SPLIT_RIGHT'),
            action: () => this.splitPanel(panel, 'right'),
          },
          {
            label: t('TABS.SPLIT_BELOW'),
            action: () => this.splitPanel(panel, 'below'),
          },
          {
            label: t('TABS.FLOAT'),
            action: () => this.floatPanel(panel),
          },
          {
            label: maximized ? t('TABS.RESTORE') : t('TABS.MAXIMIZE'),
            action: () => (maximized ? api.exitMaximizedGroup() : api.maximizeGroup(panel)),
          },
        ]
      : [];

    return [
      //  Los rótulos estaban escritos en español dentro del componente, así que el menú
      //  contextual del área de trabajo salía en español en las tres lenguas del producto.
      {
        label: t('TABS.CLOSE'),
        disabled: tab?.isCloseable === false,
        action: () => void this.tabState.closeTab(panel.id),
      },
      {
        label: t('TABS.CLOSE_OTHERS'),
        action: () => this.tabState.closeOthers(panel.id),
      },
      {
        label: t('TABS.CLOSE_RIGHT'),
        action: () => this.tabState.closeToRight(panel.id),
      },
      {
        label: t('TABS.CLOSE_ALL'),
        action: () => this.tabState.closeAll(),
      },
      'separator',
      {
        label: t('TABS.DUPLICATE'),
        action: () => this.tabState.duplicateTab(panel.id),
      },
      {
        label: tab?.isPinned ? t('TABS.UNPIN') : t('TABS.PIN'),
        disabled: isPinnedType,
        action: () =>
          tab?.isPinned
            ? this.tabState.unpinTab(panel.id)
            : this.tabState.pinTab(panel.id),
      },
      ...workshop,
    ];
  };

  /**
   * Sacar una ventana a flotante.
   *
   * Es lo que hace falta para leer un asiento mientras se corrige la factura que lo produjo: dos
   * documentos a la vez sin que ninguno ceda la mitad del ancho. Dockview la mantiene dentro del
   * área de trabajo, así que sigue siendo una ventana INTERNA — no una pestaña del navegador, que
   * perdería la sesión de la empresa y el estado del área.
   */
  private floatPanel(panel: IDockviewPanel): void {
    this.dockviewApi?.addFloatingGroup(panel, {
      position: { top: 80, left: 120 },
      width: 640,
      height: 480,
    });
  }

  /** Aísla un panel en un grupo nuevo adyacente (ventanas lado a lado). */
  private splitPanel(panel: IDockviewPanel, direction: 'right' | 'below'): void {
    if (!this.dockviewApi) return;
    const group = panel.api.group;
    // Dividir solo aporta si el grupo tiene más de un panel; si no, ya está solo.
    if (group.model.panels.length <= 1) return;
    const newGroup = this.dockviewApi.addGroup({
      referenceGroup: group,
      direction,
    });
    panel.api.moveTo({ group: newGroup });
  }

  constructor() {
    effect(() => {
      const tabs = this.tabState.tabs();
      if (this.dockviewApi) this.syncTabs(tabs);
    });

    effect(() => {
      const activeId = this.tabState.activeTabId();
      if (!this.dockviewApi || !activeId) return;
      const panel = this.panels.get(activeId);
      if (panel && !panel.api.isActive) panel.api.setActive();
    });
  }

  onReady(event: DockviewReadyEvent): void {
    this.dockviewApi = event.api;

    this.dockviewApi.onDidActivePanelChange((panel: IDockviewPanel | undefined) => {
      if (panel && !this.syncing) this.tabState.activateTab(panel.id);
    });

    this.dockviewApi.onDidRemovePanel((panel: IDockviewPanel) => {
      this.panels.delete(panel.id);
      if (!this.syncing) this.tabState.removeTabSilently(panel.id);
    });

    this.dockviewApi.onDidLayoutChange(() => {
      if (this.syncing) return;
      const orderedIds = (this.dockviewApi.panels as IDockviewPanel[]).map((p) => p.id);
      this.tabState.syncOrder(orderedIds);
    });

    this.syncTabs(this.tabState.tabs());
  }

  private syncTabs(tabs: TabModel[]): void {
    this.syncing = true;
    try {
      const activeId = this.tabState.activeTabId();

      // Añadir / actualizar paneles.
      tabs.forEach((tab) => {
        const existing = this.panels.get(tab.id);
        if (existing) {
          if (existing.title !== tab.title) existing.setTitle(tab.title);
          return;
        }
        // Por defecto, cada pestaña nueva se añade COMO PESTAÑA al grupo
        // existente (una al lado de la otra). Sin esto, Dockview puede crear un
        // grupo nuevo por panel y apilar las cabeceras una debajo de otra.
        const referenceId = this.referencePanelId();
        const panel = this.dockviewApi.addPanel({
          id: tab.id,
          component: 'tabWrapper',
          tabComponent: 'default',
          title: tab.title,
          inactive: tab.id !== activeId,
          params: this.buildParams(tab),
          ...(referenceId
            ? { position: { referencePanel: referenceId, direction: 'within' } }
            : {}),
        });
        this.panels.set(tab.id, panel);
      });

      // Eliminar paneles que ya no existen en el estado.
      const liveIds = new Set(tabs.map((t) => t.id));
      this.panels.forEach((panel, id) => {
        if (!liveIds.has(id)) {
          this.panels.delete(id);
          panel.api.close();
        }
      });
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Devuelve el id de un panel existente al que anclar las pestañas nuevas
   * (mismo grupo, en la misma franja de pestañas). Prefiere el panel activo; si
   * no, el primero registrado. Si no hay ninguno, se crea el primer grupo.
   */
  private referencePanelId(): string | undefined {
    const activeId = this.tabState.activeTabId();
    if (activeId && this.panels.has(activeId)) return activeId;
    const first = this.panels.keys().next();
    return first.done ? undefined : first.value;
  }

  private buildParams(tab: TabModel) {
    const { definition } = this.registry.resolve(tab.route);
    const context: TabContext = {
      tabId: tab.id,
      type: tab.type,
      route: tab.route,
      title: tab.title,
      icon: tab.icon,
      params: tab.routeParams ?? {},
      query: tab.queryParams ?? {},
    };
    return {
      tabId: tab.id,
      load: definition.load,
      inputs: { ...(tab.routeParams ?? {}), ...(tab.queryParams ?? {}) },
      context,
    };
  }
}
