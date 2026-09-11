import { Injectable, effect, inject } from '@angular/core';
import { TabRouterService } from './tab-router.service';
import { TabStateService } from './tab-state.service';
import { TabModel, TabType } from './tab.model';

/** Versión del esquema de persistencia. Incrementar ante cambios incompatibles. */
const SCHEMA_VERSION = 3;
const STORAGE_KEY = 'erp_tab_session';
const LAYOUT_KEY = 'erp_tab_layout';
const REMEMBER_KEY = 'erp_remember_tabs';

interface PersistedTab {
  id: string;
  type: TabType;
  title: string;
  icon: string;
  badge?: number;
  route: string;
  routeParams: Record<string, string>;
  queryParams?: Record<string, string>;
  isDirty: boolean;
  isCloseable: boolean;
  isPinned: boolean;
  isPreview?: boolean;
  entityKey?: string;
  createdAt: string;
  lastActivatedAt: string;
  scrollPosition?: number;
  viewState?: unknown;
  order?: number;
}

interface PersistedLayout {
  schemaVersion: number;
  layout: unknown; // Salida de dockviewApi.toJSON() (grupos, splits, flotantes, popout).
}

interface PersistedWorkspace {
  schemaVersion: number;
  activeTabId: string | null;
  tabs: PersistedTab[];
}

/**
 * Persistencia del workspace (TAB_ARCHITECTURE §8).
 *  - `localStorage` versionado (sin datos de negocio: solo metadatos + viewState/scroll
 *    serializables). Se eligió sobre `sessionStorage` para que «recordar pestañas» y la disposición
 *    de ventanas sobrevivan al CIERRE del navegador, no solo a un F5: la promesa de «layout
 *    persistente» era falsa mientras el estado moría con la sesión de la pestaña. El precio es que
 *    dos pestañas del navegador comparten un único snapshot (gana la última en guardar), aceptable
 *    para una disposición que no es dato crítico.
 *  - Preferencia "recordar pestañas" (por defecto activada).
 *  - Aviso beforeunload si hay pestañas dirty (§7.2 / §10).
 */
@Injectable({ providedIn: 'root' })
export class TabPersistenceService {
  private tabState = inject(TabStateService);
  private tabRouter = inject(TabRouterService);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;

  constructor() {
    // Guardado debounced ante cualquier cambio de pestañas / pestaña activa.
    effect(() => {
      const tabs = this.tabState.tabs();
      const activeId = this.tabState.activeTabId();
      if (!this.restored) return; // no sobreescribir antes de restaurar
      this.scheduleSave(tabs, activeId);
    });

    this.registerBeforeUnload();
  }

  // ── API pública ──────────────────────────────────────────────────────────

  restoreState(): void {
    this.restored = true;
    if (!this.rememberEnabled()) {
      this.clearLayout();
      this.tabState.ensureDefaultTab();
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // Sin sesión de pestañas que emparejar, un layout suelto solo dejaría
        // paneles huérfanos: se descarta.
        this.clearLayout();
        this.tabState.ensureDefaultTab();
        return;
      }

      const data = JSON.parse(raw) as Partial<PersistedWorkspace>;
      if (data?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.tabs)) {
        // Esquema antiguo/incompatible → descartar para no romper la sesión.
        this.clearState();
        this.tabState.ensureDefaultTab();
        return;
      }

      const tabs = data.tabs.map((t) => this.deserialize(t));
      if (tabs.length === 0) {
        this.clearLayout();
        this.tabState.ensureDefaultTab();
        return;
      }

      //  La URL con la que arrancó el navegador es intención explícita —alguien la escribió,
      //  la guardó en marcadores o pulsó F5 sobre la página que estaba mirando— y gana sobre la
      //  pestaña que estuviera activa cuando se guardó el espacio.
      //
      //  Hay que leerla ANTES de `setTabs`: el puente Router↔Workspace ya abrió su pestaña al
      //  terminar la navegación inicial, `setTabs` reemplaza la lista entera y se la lleva por
      //  delante. Sin esto, recargar en /accounting/chart-of-accounts devolvía al usuario a la
      //  pestaña anterior y reescribía la barra de direcciones, así que ninguna página del
      //  producto se podía enlazar ni recargar.
      const boot = this.tabRouter.bootRoute();

      this.tabState.setTabs(tabs);
      this.tabState.ensureDefaultTab();

      if (boot) {
        this.tabState.openTab({ route: boot.path, queryParams: boot.query });
      } else {
        // Enfoca la última pestaña activa (o la más reciente).
        const target =
          tabs.find((t) => t.id === data.activeTabId) ??
          [...tabs].sort(
            (a, b) => b.lastActivatedAt.getTime() - a.lastActivatedAt.getTime()
          )[0];
        if (target) this.tabState.activateTab(target.id);
      }

      if (tabs.some((t) => t.isDirty)) {
        // Aviso diferido para no competir con el render inicial.
        queueMicrotask(() =>
          console.info('[workspace] Se restauraron pestañas con cambios sin guardar.')
        );
      }
    } catch (e) {
      console.error('Failed to restore tab state', e);
      this.clearState();
      this.tabState.ensureDefaultTab();
    }
  }

  clearState(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.clearLayout();
  }

  // ── Layout de Dockview (splits / flotantes / popout) ─────────────────────

  /**
   * Guarda la disposición de ventanas de Dockview (no solo la lista de pestañas):
   * qué está dividido, flotando o sacado a otra ventana. Debounced y solo si el
   * usuario tiene activado «recordar pestañas». La invoca el contenedor cuando el
   * layout cambia.
   */
  saveLayout(layout: unknown): void {
    if (!this.restored || !this.rememberEnabled()) return;
    try {
      const payload: PersistedLayout = { schemaVersion: SCHEMA_VERSION, layout };
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('Failed to save dockview layout', e);
    }
  }

  /** Devuelve el layout guardado si es del esquema actual; si no, null. */
  loadLayout(): unknown | null {
    if (!this.rememberEnabled()) return null;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as Partial<PersistedLayout>;
      if (data?.schemaVersion !== SCHEMA_VERSION || data.layout == null) {
        localStorage.removeItem(LAYOUT_KEY);
        return null;
      }
      return data.layout;
    } catch {
      return null;
    }
  }

  clearLayout(): void {
    localStorage.removeItem(LAYOUT_KEY);
  }

  rememberEnabled(): boolean {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  }

  setRemember(enabled: boolean): void {
    localStorage.setItem(REMEMBER_KEY, String(enabled));
    if (!enabled) this.clearState();
    else this.scheduleSave(this.tabState.tabs(), this.tabState.activeTabId());
  }

  // ── interno ────────────────────────────────────────────────────────────

  private scheduleSave(tabs: TabModel[], activeId: string | null): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveState(tabs, activeId), 300);
  }

  private saveState(tabs: TabModel[], activeId: string | null): void {
    try {
      // Si el usuario desactivó "recordar", solo persiste el Dashboard (§8.3).
      const toPersist = this.rememberEnabled()
        ? tabs
        : tabs.filter((t) => t.type === TabType.PINNED);

      const payload: PersistedWorkspace = {
        schemaVersion: SCHEMA_VERSION,
        activeTabId: activeId,
        tabs: toPersist.map((t) => this.serialize(t)),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('Failed to save tab state', e);
    }
  }

  private serialize(t: TabModel): PersistedTab {
    return {
      id: t.id,
      type: t.type,
      title: t.title,
      icon: t.icon,
      badge: t.badge,
      route: t.route,
      routeParams: t.routeParams,
      queryParams: t.queryParams,
      isDirty: t.isDirty,
      isCloseable: t.isCloseable,
      isPinned: t.isPinned,
      isPreview: t.isPreview,
      entityKey: t.entityKey,
      createdAt: t.createdAt.toISOString(),
      lastActivatedAt: t.lastActivatedAt.toISOString(),
      scrollPosition: t.scrollPosition,
      viewState: this.safeViewState(t.viewState),
      order: t.order,
    };
  }

  private deserialize(t: PersistedTab): TabModel {
    return {
      id: t.id,
      type: t.type,
      title: t.title,
      icon: t.icon,
      badge: t.badge,
      route: t.route,
      routeParams: t.routeParams ?? {},
      queryParams: t.queryParams,
      isDirty: !!t.isDirty,
      isLoading: true, // §8.1: se rehidrata sin datos; se cargan al activar
      isCloseable: t.isCloseable !== false,
      isPinned: !!t.isPinned,
      isPreview: !!t.isPreview,
      entityKey: t.entityKey,
      createdAt: new Date(t.createdAt),
      lastActivatedAt: new Date(t.lastActivatedAt),
      scrollPosition: t.scrollPosition,
      viewState: t.viewState,
      order: t.order,
    };
  }

  /** Garantiza que viewState sea serializable; descarta lo que no lo sea. */
  private safeViewState(viewState: unknown): unknown {
    if (viewState === undefined || viewState === null) return undefined;
    try {
      return JSON.parse(JSON.stringify(viewState));
    } catch {
      return undefined;
    }
  }

  private registerBeforeUnload(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeunload', (event: BeforeUnloadEvent) => {
      if (this.tabState.hasDirtyTabs()) {
        event.preventDefault();
        // Navegadores modernos ignoran el texto pero requieren returnValue.
        event.returnValue = '';
        return '';
      }
      return undefined;
    });
  }
}
