import { Injectable, signal, computed, inject } from '@angular/core';
import { TabModel, TabType, OpenTabConfig } from './tab.model';
import { TabRegistryService } from './tab-registry.service';
import { DialogService } from '../services/dialog.service';
import { NotificationService } from '../services/notification';
import { TabEventBusService, TabEvent } from './tab-event-bus.service';

/** Handler que una página puede registrar para guardar antes de cerrar (dirty). */
export type TabSaveHandler = () => Promise<boolean> | boolean;

/** Ruta de la pestaña fija por defecto (página de inicio del workspace). */
const DEFAULT_TAB_ROUTE = '/overview';

/**
 * WorkspaceStore: única fuente de verdad del conjunto de pestañas abiertas y de
 * la pestaña activa (TAB_ARCHITECTURE §6). Expone API de mutación completa.
 */
@Injectable({ providedIn: 'root' })
export class TabStateService {
  private registry = inject(TabRegistryService);
  private dialog = inject(DialogService);
  private notify = inject(NotificationService);
  private bus = inject(TabEventBusService);

  private tabsSignal = signal<TabModel[]>([]);
  private activeTabIdSignal = signal<string | null>(null);

  /** Límite configurable de pestañas (§10). */
  maxTabs = 20;

  readonly tabs = this.tabsSignal.asReadonly();
  readonly activeTabId = this.activeTabIdSignal.asReadonly();
  readonly activeTab = computed(
    () => this.tabsSignal().find((t) => t.id === this.activeTabIdSignal()) || null
  );

  /** Hay al menos una pestaña con cambios sin guardar. */
  readonly hasDirtyTabs = computed(() => this.tabsSignal().some((t) => t.isDirty));

  private closeHandlers = new Map<string, TabSaveHandler>();

  constructor() {
    // §9: al eliminarse un registro en otra pestaña, cerrar su pestaña RECORD.
    this.bus.on(TabEvent.RECORD_DELETED).subscribe((e) => {
      if (!e.id) return;
      const key = `${e.entity}:${e.id}`;
      const tab = this.getTabByEntityKey(key);
      if (tab) this.removeTabSilently(tab.id);
    });
  }

  // ── Apertura / activación ────────────────────────────────────────────────

  openTab(config: OpenTabConfig): void {
    const { definition, params } = this.registry.resolve(config.route);

    // §5.3 / §10: permisos (espejo de permissionsGuard).
    if (!this.registry.canOpen(definition)) {
      this.notify.showWarning('No tienes permiso para abrir este módulo.');
      return;
    }

    const entityKey = definition.entityKeyFn
      ? definition.entityKeyFn(params, config.queryParams)
      : undefined;

    // Deduplicación de instancias.
    if (entityKey) {
      const existing = this.tabsSignal().find((t) => t.entityKey === entityKey);
      if (existing) {
        // Sincroniza queryParams si cambiaron (filtros/estado de vista).
        if (config.queryParams) {
          this.tabsSignal.update((tabs) =>
            tabs.map((t) =>
              t.id === existing.id ? { ...t, queryParams: config.queryParams } : t
            )
          );
        }
        if (config.activate !== false) this.activateTab(existing.id);
        return;
      }
    }

    // §10: respetar el máximo de pestañas.
    if (!this.enforceMaxTabs()) return;

    const title = config.title
      ?? (definition.titleFn ? definition.titleFn(params) : undefined)
      ?? definition.title
      ?? 'Nueva Pestaña';

    const now = new Date();
    const newTab: TabModel = {
      id: this.newId(),
      type: definition.tabType,
      title,
      icon: config.icon || definition.icon || 'File',
      route: this.canonicalRoute(config.route),
      routeParams: { ...params, ...(config.routeParams ?? {}) },
      queryParams: config.queryParams,
      isDirty: false,
      isLoading: config.isLoading ?? true,
      isCloseable: definition.isCloseable !== false,
      isPinned: definition.tabType === TabType.PINNED,
      entityKey,
      createdAt: now,
      lastActivatedAt: now,
      order: this.tabsSignal().length,
    };

    this.tabsSignal.update((tabs) => this.sortPinned([...tabs, newTab]));
    if (config.activate !== false) this.activateTab(newTab.id);
  }

  activateTab(tabId: string): void {
    if (!this.tabsSignal().some((t) => t.id === tabId)) return;
    this.tabsSignal.update((tabs) =>
      tabs.map((t) => (t.id === tabId ? { ...t, lastActivatedAt: new Date() } : t))
    );
    this.activeTabIdSignal.set(tabId);
  }

  // ── Cierre ────────────────────────────────────────────────────────────────

  /** Cierra una pestaña; si está dirty pide confirmación (Guardar/Descartar/Cancelar). */
  async closeTab(tabId: string): Promise<boolean> {
    const tab = this.tabsSignal().find((t) => t.id === tabId);
    if (!tab) return false;
    if (!tab.isCloseable) return false;

    if (tab.isDirty) {
      const decision = await this.dialog.confirmClose({
        message: `Tienes cambios sin guardar en «${tab.title}». ¿Qué deseas hacer?`,
      });
      if (decision === 'cancel') return false;
      if (decision === 'save') {
        const handler = this.closeHandlers.get(tabId);
        if (handler) {
          const ok = await handler();
          if (!ok) return false; // guardar falló → no cerrar
        } else {
          // Sin handler de guardado: avisar y conservar la pestaña.
          this.notify.showInfo('Guarda los cambios desde la propia vista antes de cerrar.');
          return false;
        }
      }
    }

    this.removeTabSilently(tabId);
    return true;
  }

  /** Elimina la pestaña sin diálogos (uso interno / sincronización con Dockview). */
  removeTabSilently(tabId: string): void {
    const before = this.tabsSignal();
    const index = before.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    this.closeHandlers.delete(tabId);
    const after = before.filter((t) => t.id !== tabId);
    this.tabsSignal.set(after);

    if (this.activeTabIdSignal() === tabId) {
      if (after.length > 0) {
        const neighbor = after[Math.min(index, after.length - 1)];
        this.activateTab(neighbor.id);
      } else {
        this.activeTabIdSignal.set(null);
      }
    }
  }

  closeOthers(tabId: string): void {
    const keep = this.tabsSignal().filter(
      (t) => t.id === tabId || t.isPinned || (t.isDirty)
    );
    this.tabsSignal.set(this.sortPinned(keep));
    this.activateTab(tabId);
  }

  /** Cierra las pestañas situadas a la derecha de `tabId` (no fijadas, no dirty). */
  closeToRight(tabId: string): void {
    const tabs = this.tabsSignal();
    const index = tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    const keep = tabs.filter(
      (t, i) => i <= index || t.isPinned || t.isDirty || !t.isCloseable
    );
    this.tabsSignal.set(this.sortPinned(keep));
    if (!keep.some((t) => t.id === this.activeTabIdSignal())) {
      this.activateTab(tabId);
    }
  }

  closeAll(opts: { keepPinned?: boolean } = { keepPinned: true }): void {
    const keepPinned = opts.keepPinned !== false;
    const remaining = this.tabsSignal().filter(
      (t) => (keepPinned && t.isPinned) || t.isDirty
    );
    this.tabsSignal.set(this.sortPinned(remaining));
    const next = this.tabsSignal();
    this.activeTabIdSignal.set(next.length ? next[0].id : null);
  }

  // ── Estado de pestaña ───────────────────────────────────────────────────

  markDirty(tabId: string, isDirty = true): void {
    this.patch(tabId, { isDirty });
  }

  markClean(tabId: string): void {
    this.patch(tabId, { isDirty: false });
  }

  updateTitle(tabId: string, title: string): void {
    this.patch(tabId, { title });
  }

  setBadge(tabId: string, badge: number | undefined): void {
    this.patch(tabId, { badge });
  }

  setLoading(tabId: string, isLoading: boolean): void {
    this.patch(tabId, { isLoading });
  }

  updateViewState(tabId: string, viewState: unknown, scrollPosition?: number): void {
    this.patch(tabId, {
      viewState,
      ...(scrollPosition !== undefined ? { scrollPosition } : {}),
    });
  }

  setScroll(tabId: string, scrollPosition: number): void {
    this.patch(tabId, { scrollPosition });
  }

  registerSaveHandler(tabId: string, handler: TabSaveHandler): void {
    this.closeHandlers.set(tabId, handler);
  }

  // ── Pin / orden / duplicado ─────────────────────────────────────────────

  pinTab(tabId: string): void {
    this.patch(tabId, { isPinned: true });
    this.tabsSignal.update((tabs) => this.sortPinned(tabs));
  }

  unpinTab(tabId: string): void {
    const tab = this.tabsSignal().find((t) => t.id === tabId);
    if (!tab || tab.type === TabType.PINNED) return; // la pestaña de inicio no se desfija
    this.patch(tabId, { isPinned: false });
    this.tabsSignal.update((tabs) => this.sortPinned(tabs));
  }

  /** Reordena por drag & drop (Dockview ya mueve el panel; sincronizamos estado). */
  moveTab(fromIndex: number, toIndex: number): void {
    const tabs = [...this.tabsSignal()];
    if (
      fromIndex < 0 || toIndex < 0 ||
      fromIndex >= tabs.length || toIndex >= tabs.length ||
      fromIndex === toIndex
    ) return;
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    this.tabsSignal.set(tabs.map((t, i) => ({ ...t, order: i })));
  }

  /** Reordena según el orden de ids que reporta Dockview. */
  syncOrder(orderedIds: string[]): void {
    const current = this.tabsSignal();
    if (orderedIds.length !== current.length) return;
    const byId = new Map(current.map((t) => [t.id, t]));
    const reordered: TabModel[] = [];
    for (const id of orderedIds) {
      const t = byId.get(id);
      if (!t) return; // ids no coinciden → ignorar
      reordered.push(t);
    }
    this.tabsSignal.set(reordered.map((t, i) => ({ ...t, order: i })));
  }

  duplicateTab(tabId: string): void {
    const tab = this.tabsSignal().find((t) => t.id === tabId);
    if (!tab) return;
    if (!this.enforceMaxTabs()) return;
    const now = new Date();
    const copy: TabModel = {
      ...tab,
      id: this.newId(),
      // Una copia es una instancia independiente: sin dedupe ni pin.
      entityKey: undefined,
      isPinned: false,
      isDirty: false,
      title: `${tab.title} (copia)`,
      createdAt: now,
      lastActivatedAt: now,
      order: this.tabsSignal().length,
    };
    this.tabsSignal.update((tabs) => this.sortPinned([...tabs, copy]));
    this.activateTab(copy.id);
  }

  // ── Reglas de workspace ─────────────────────────────────────────────────

  /**
   * Garantiza que quepa una pestaña más cerrando la más antigua no-dirty y
   * no-pinned. Devuelve false si no se puede liberar espacio (todas dirty).
   */
  enforceMaxTabs(): boolean {
    const tabs = this.tabsSignal();
    if (tabs.length < this.maxTabs) return true;

    const candidate = [...tabs]
      .filter((t) => !t.isPinned && !t.isDirty && t.isCloseable)
      .sort((a, b) => a.lastActivatedAt.getTime() - b.lastActivatedAt.getTime())[0];

    if (!candidate) {
      this.notify.showWarning(
        `Has alcanzado el máximo de ${this.maxTabs} pestañas. Cierra alguna para continuar.`
      );
      return false;
    }
    this.removeTabSilently(candidate.id);
    return true;
  }

  /** Asegura que la pestaña de inicio (PINNED) exista; la deja al fondo (§8.4). */
  ensureDefaultTab(): void {
    const hasDefault = this.tabsSignal().some((t) => t.type === TabType.PINNED);
    if (!hasDefault) {
      this.openTab({ route: DEFAULT_TAB_ROUTE, activate: this.tabsSignal().length === 0 });
    }
  }

  /** Reinicio total del workspace (cambio de empresa/tenant §10). */
  reset(): void {
    this.closeHandlers.clear();
    this.tabsSignal.set([]);
    this.activeTabIdSignal.set(null);
    this.openTab({ route: DEFAULT_TAB_ROUTE });
  }

  // ── Consultas / restauración ────────────────────────────────────────────

  getTabByEntityKey(key: string): TabModel | null {
    return this.tabsSignal().find((t) => t.entityKey === key) || null;
  }

  setTabs(tabs: TabModel[]): void {
    this.tabsSignal.set(this.sortPinned(tabs));
  }

  // ── helpers privados ────────────────────────────────────────────────────

  private patch(tabId: string, changes: Partial<TabModel>): void {
    this.tabsSignal.update((tabs) =>
      tabs.map((t) => (t.id === tabId ? { ...t, ...changes } : t))
    );
  }

  /** Mantiene las pestañas fijadas al inicio, preservando el orden relativo. */
  private sortPinned(tabs: TabModel[]): TabModel[] {
    const pinned = tabs.filter((t) => t.isPinned);
    const rest = tabs.filter((t) => !t.isPinned);
    return [...pinned, ...rest].map((t, i) => ({ ...t, order: i }));
  }

  private canonicalRoute(route: string): string {
    return route.split('#')[0];
  }

  private newId(): string {
    const uuid =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `tab_${uuid}`;
  }
}
