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
import { TabPersistenceService } from '../tab-persistence.service';
import { TabPreferencesService } from '../tab-preferences.service';
import { TabModel, TabType } from '../tab.model';
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
  private persistence = inject(TabPersistenceService);
  private prefs = inject(TabPreferencesService);
  private themeService = inject(ThemeService);
  protected readonly windowMode = inject(WindowModeService);
  private translate = inject(TranslateService);

  private dockviewApi: any;
  private panels = new Map<string, IDockviewPanel>();
  private syncing = false;
  private layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;

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
    //  Dividir, flotar y maximizar solo son válidos sobre un grupo de la rejilla principal. Si la
    //  pestaña pertenece a un grupo ya flotante o en pop-out, maximizarlo reventaba con «Invalid grid
    //  element»: en ese caso solo tiene sentido sacarla a otra ventana.
    const inGrid = panel.group?.api?.location?.type === 'grid';
    const t = (key: string) => this.translate.instant(key);

    //  Las acciones de ventana viven SIEMPRE en el menú contextual, sin importar el modo: esconderlas
    //  hasta que se pulse el conmutador de «Taller» hacía que parecieran inexistentes. Dividir y flotar
    //  son, por definición, disponer varias ventanas: al usarlas se entra en Taller (el modo sigue a la
    //  acción del usuario, no la bloquea). Solo dependen de estar en la rejilla —no de un flotante ni un
    //  pop-out—, donde Dockview exige la ubicación de rejilla.
    const gridActions: ContextMenuItem[] = inGrid
      ? [
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
        ]
      : [];

    const windowActions: ContextMenuItem[] = [
      'separator',
      ...gridActions,
      {
        //  Sacar a una ventana del sistema operativo (no una pestaña del navegador): comparar un
        //  documento en un segundo monitor sin ceder ancho ni perder la sesión de la empresa. Se
        //  ofrece en cualquier modo y también desde grupos flotantes/pop-out.
        label: t('TABS.POPOUT'),
        action: () => this.popoutPanel(panel),
      },
      ...(inGrid
        ? [
            {
              label: maximized ? t('TABS.RESTORE') : t('TABS.MAXIMIZE'),
              action: () => (maximized ? api.exitMaximizedGroup() : api.maximizeGroup(panel)),
            } as ContextMenuItem,
          ]
        : []),
    ];

    //  «Mantener abierta» solo aparece sobre una vista previa: es el gesto que la fija sin tener que
    //  editarla ni acordarse del doble clic en la cabecera.
    const keepOpen: ContextMenuItem[] = tab?.isPreview
      ? [
          {
            label: t('TABS.KEEP_OPEN'),
            action: () => this.tabState.markPermanent(panel.id),
          },
          'separator',
        ]
      : [];

    return [
      ...keepOpen,
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
      'separator',
      {
        //  Ajuste global de comportamiento, no de esta pestaña: si el usuario prefiere que cada
        //  apertura sea permanente, lo desactiva desde aquí (equivale a enablePreview de VS Code).
        label: (this.prefs.enablePreview() ? '✓ ' : '') + t('TABS.PREVIEW_ON_OPEN'),
        action: () => this.prefs.toggleEnablePreview(),
      },
      ...windowActions,
    ];
  };

  /**
   * Sacar el panel a una ventana nativa del sistema operativo (popout de Dockview).
   *
   * A diferencia de una pestaña del navegador, esta ventana la controla la misma aplicación: conserva
   * la sesión de la empresa y el estado del área, y Dockview clona los estilos para que se vea igual.
   * `popoutUrl` apunta a un HTML mínimo del propio origen (requisito de same-origin de Dockview).
   */
  private popoutPanel(panel: IDockviewPanel): void {
    try {
      void this.dockviewApi?.addPopoutGroup(panel, {
        popoutUrl: '/popout.html',
        position: { left: 120, top: 80, width: 900, height: 640 },
      });
    } catch (err) {
      //  Bloqueado por el navegador (sin gesto de usuario) o mismo origen no disponible: no rompe el
      //  área; la ventana simplemente no se abre.
      console.warn('[tabs] No se pudo abrir el panel en una ventana nativa', err);
    }
  }

  /**
   * Sacar una ventana a flotante.
   *
   * Es lo que hace falta para leer un asiento mientras se corrige la factura que lo produjo: dos
   * documentos a la vez sin que ninguno ceda la mitad del ancho. Dockview la mantiene dentro del
   * área de trabajo, así que sigue siendo una ventana INTERNA — no una pestaña del navegador, que
   * perdería la sesión de la empresa y el estado del área.
   */
  private floatPanel(panel: IDockviewPanel): void {
    if (!this.isInGrid(panel)) return;
    // Disponer una ventana aparte ES trabajar en Taller: el modo sigue a la acción.
    this.windowMode.set('workshop');
    this.dockviewApi?.addFloatingGroup(panel, {
      position: { top: 80, left: 120 },
      width: 640,
      height: 480,
    });
  }

  /** Aísla un panel en un grupo nuevo adyacente (ventanas lado a lado). */
  private splitPanel(panel: IDockviewPanel, direction: 'right' | 'below'): void {
    if (!this.dockviewApi || !this.isInGrid(panel)) return;
    const group = panel.api.group;
    // Dividir solo aporta si el grupo tiene más de un panel; si no, ya está solo.
    if (group.model.panels.length <= 1) return;
    // Dividir es, por definición, disponer varias ventanas: se entra en Taller.
    this.windowMode.set('workshop');
    const newGroup = this.dockviewApi.addGroup({
      referenceGroup: group,
      direction,
    });
    panel.api.moveTo({ group: newGroup });
  }

  /** ¿El panel vive en un grupo de la rejilla principal (no flotante ni en pop-out)? */
  private isInGrid(panel: IDockviewPanel): boolean {
    return panel.group?.api?.location?.type === 'grid';
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
      this.scheduleLayoutSave();
    });

    this.restoreOrSync();
  }

  /**
   * Al arrancar: si hay un layout guardado (splits/flotantes/popout de una sesión
   * anterior), se restaura y se reconcilia con las pestañas del estado. Si no lo
   * hay o falla, se cae a la disposición plana (todas las pestañas en un grupo).
   */
  private restoreOrSync(): void {
    const tabs = this.tabState.tabs();
    const saved = this.persistence.loadLayout();
    if (saved && this.tryRestoreLayout(saved, tabs)) return;
    this.syncTabs(tabs);
  }

  private tryRestoreLayout(layout: unknown, tabs: TabModel[]): boolean {
    this.syncing = true;
    try {
      this.dockviewApi.fromJSON(layout);
      // Adopta los paneles que Dockview acaba de recrear (mismos ids que las pestañas).
      this.panels.clear();
      (this.dockviewApi.panels as IDockviewPanel[]).forEach((p) => this.panels.set(p.id, p));
      // Reconcilia: añade pestañas que el layout no tuviera y cierra paneles huérfanos.
      this.reconcilePanels(tabs);
      const activeId = this.tabState.activeTabId();
      (activeId ? this.panels.get(activeId) : undefined)?.api.setActive();
      return true;
    } catch (err) {
      console.warn('[tabs] Layout no restaurable; se usa disposición plana', err);
      try { this.dockviewApi.clear(); } catch { /* noop */ }
      this.panels.clear();
      this.persistence.clearLayout();
      return false;
    } finally {
      this.syncing = false;
    }
  }

  private scheduleLayoutSave(): void {
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = setTimeout(() => {
      try {
        if (this.dockviewApi) this.persistence.saveLayout(this.dockviewApi.toJSON());
      } catch (e) {
        console.warn('[tabs] No se pudo serializar el layout', e);
      }
    }, 400);
  }

  private syncTabs(tabs: TabModel[]): void {
    this.syncing = true;
    try {
      this.reconcilePanels(tabs);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Empareja los paneles de Dockview con las pestañas del estado: crea los que
   * faltan y cierra los que sobran. NO gestiona el flag `syncing` (lo hacen quien
   * lo llama), para poder invocarse tanto en sincronización normal como durante la
   * restauración del layout.
   */
  private reconcilePanels(tabs: TabModel[]): void {
    const activeId = this.tabState.activeTabId();

    // Añadir / actualizar paneles.
    tabs.forEach((tab) => {
      const existing = this.panels.get(tab.id);
      if (existing) {
        if (existing.title !== tab.title) existing.setTitle(tab.title);
        return;
      }
      // Por defecto, cada pestaña nueva se añade COMO PESTAÑA al grupo existente
      // (una al lado de la otra). Sin esto, Dockview puede crear un grupo nuevo por
      // panel y apilar las cabeceras una debajo de otra.
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

  /**
   * Los paneles se identifican SOLO por `tabId`: el `TabWrapper` deriva el resto
   * del WorkspaceStore de forma reactiva. Así los `params` son serializables y el
   * layout de Dockview puede persistirse (una función `load` no cabría en JSON).
   */
  private buildParams(tab: TabModel) {
    return { tabId: tab.id };
  }
}
