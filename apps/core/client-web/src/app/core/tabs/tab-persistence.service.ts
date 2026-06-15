import { Injectable, effect, inject } from '@angular/core';
import { TabStateService } from './tab-state.service';
import { TabModel, TabType } from './tab.model';

/** Versión del esquema de persistencia. Incrementar ante cambios incompatibles. */
const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'erp_tab_session';
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
  entityKey?: string;
  createdAt: string;
  lastActivatedAt: string;
  scrollPosition?: number;
  viewState?: unknown;
  order?: number;
}

interface PersistedWorkspace {
  schemaVersion: number;
  activeTabId: string | null;
  tabs: PersistedTab[];
}

/**
 * Persistencia del workspace (TAB_ARCHITECTURE §8).
 *  - Nivel F5: sessionStorage versionado (sin datos de negocio: solo metadatos
 *    + viewState/scroll serializables).
 *  - Preferencia "recordar pestañas" (por defecto activada).
 *  - Aviso beforeunload si hay pestañas dirty (§7.2 / §10).
 *
 * El nivel backend (cross-session) queda como punto de extensión en
 * `syncToBackend()`.
 */
@Injectable({ providedIn: 'root' })
export class TabPersistenceService {
  private tabState = inject(TabStateService);

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
      this.tabState.ensureDefaultTab();
      return;
    }

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
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
        this.tabState.ensureDefaultTab();
        return;
      }

      this.tabState.setTabs(tabs);
      this.tabState.ensureDefaultTab();

      // Enfoca la última pestaña activa (o la más reciente).
      const target =
        tabs.find((t) => t.id === data.activeTabId) ??
        [...tabs].sort(
          (a, b) => b.lastActivatedAt.getTime() - a.lastActivatedAt.getTime()
        )[0];
      if (target) this.tabState.activateTab(target.id);

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
    sessionStorage.removeItem(STORAGE_KEY);
  }

  rememberEnabled(): boolean {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  }

  setRemember(enabled: boolean): void {
    localStorage.setItem(REMEMBER_KEY, String(enabled));
    if (!enabled) this.clearState();
    else this.scheduleSave(this.tabState.tabs(), this.tabState.activeTabId());
  }

  /** Punto de extensión para persistir en backend (cross-session, §8.2). */
  syncToBackend(): void {
    // Pendiente: PUT /api/me/workspace (debounced) cuando exista el endpoint.
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
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
