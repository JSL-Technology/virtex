import { Injectable, signal, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { TabModel, TabType, OpenTabConfig } from './tab.model';
import { TabRegistryService } from './tab-registry.service';
import { TabPreferencesService } from './tab-preferences.service';
import { DialogService } from '../services/dialog.service';
import { NotificationService } from '../services/notification';
import { TabEventBusService, TabEvent } from './tab-event-bus.service';

/** Handler que una página puede registrar para guardar antes de cerrar (dirty). */
export type TabSaveHandler = () => Promise<boolean> | boolean;

/** Descriptor mínimo de una pestaña cerrada, para reabrirla (Ctrl/Cmd+Shift+T). */
interface ClosedTab {
  route: string;
  queryParams?: Record<string, string>;
  title: string;
  icon: string;
}

/** Ruta de la pestaña fija por defecto (página de inicio del workspace). */
const DEFAULT_TAB_ROUTE = '/overview';

/**
 * WorkspaceStore: única fuente de verdad del conjunto de pestañas abiertas y de
 * la pestaña activa (TAB_ARCHITECTURE §6). Expone API de mutación completa.
 */
@Injectable({ providedIn: 'root' })
export class TabStateService {
  private registry = inject(TabRegistryService);
  private prefs = inject(TabPreferencesService);
  private dialog = inject(DialogService);
  private notify = inject(NotificationService);
  private bus = inject(TabEventBusService);
  private translate = inject(TranslateService);

  private tabsSignal = signal<TabModel[]>([]);
  private activeTabIdSignal = signal<string | null>(null);

  /** Pila de pestañas cerradas recientemente (para reabrir). Cap sencillo. */
  private closedStack: ClosedTab[] = [];
  private static readonly CLOSED_STACK_MAX = 15;

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
      // El registro ya no existe: no tiene sentido ofrecer reabrir la pestaña.
      if (tab) this.removeTabSilently(tab.id, false);
    });
  }

  // ── Apertura / activación ────────────────────────────────────────────────

  openTab(config: OpenTabConfig): void {
    const { definition, params } = this.registry.resolve(config.route);

    // §5.3 / §10: permisos (espejo de permissionsGuard).
    if (!this.registry.canOpen(definition)) {
      this.notify.showWarning('CORE.TABS.TIENES_PERMISO_ABRIR_ESTE_MODULO');
      return;
    }

    const entityKey = definition.entityKeyFn
      ? definition.entityKeyFn(params, config.queryParams)
      : undefined;

    // ¿Abrir como vista previa (efímera y reutilizable)? Explícito si viene en el
    // config; si no, según la preferencia del usuario y qué representa la ventana.
    const asPreview =
      definition.tabType !== TabType.PINNED &&
      (config.preview ??
        (this.prefs.enablePreview() && this.isPreviewable(definition.tabType, params)));

    // Deduplicación de instancias.
    if (entityKey) {
      const existing = this.tabsSignal().find((t) => t.entityKey === entityKey);
      if (existing) {
        // Sincroniza queryParams si cambiaron (filtros/estado de vista).
        if (config.queryParams) this.patch(existing.id, { queryParams: config.queryParams });
        // Reabrir en modo permanente sobre una vista previa existente la fija
        // (doble clic / navegación explícita = «mantener abierta»).
        if (!asPreview && existing.isPreview) this.markPermanent(existing.id);
        if (config.activate !== false) this.activateTab(existing.id);
        return;
      }
    }

    // `definition.title` es una CLAVE de i18n (`PAGE_TITLES.INVOICES`), no texto: hay que
    // traducirla o la pestaña muestra la clave en crudo. `config.title` y `titleFn(...)` ya vienen
    // resueltos (p. ej. «Factura #123»), así que no se tocan. Si i18n aún no cargó, `instant`
    // devuelve la clave y el pipe `translate` de la cabecera la resuelve al terminar de cargar.
    const title = config.title
      ?? (definition.titleFn ? definition.titleFn(params) : undefined)
      ?? (definition.title ? this.translate.instant(definition.title) : undefined)
      ?? this.translate.instant('TABS.NEW_TAB');
    const icon = config.icon || definition.icon || 'File';
    const routeParams = { ...params, ...(config.routeParams ?? {}) };

    // Reutiliza la ÚNICA pestaña de vista previa si ya existe: reemplaza su
    // contenido en el sitio en vez de acumular otra pestaña al lado. Es lo que
    // hace que ir abriendo registros no deje un reguero de pestañas.
    if (asPreview) {
      const preview = this.tabsSignal().find((t) => t.isPreview && t.isCloseable);
      if (preview) {
        this.reusePreview(preview.id, {
          type: definition.tabType,
          title,
          icon,
          route: this.canonicalRoute(config.route),
          routeParams,
          queryParams: config.queryParams,
          entityKey,
        });
        if (config.activate !== false) this.activateTab(preview.id);
        return;
      }
    }

    // §10: respetar el máximo de pestañas.
    if (!this.enforceMaxTabs()) return;

    const now = new Date();
    const newTab: TabModel = {
      id: this.newId(),
      type: definition.tabType,
      title,
      icon,
      route: this.canonicalRoute(config.route),
      routeParams,
      queryParams: config.queryParams,
      isDirty: false,
      isLoading: config.isLoading ?? true,
      isCloseable: definition.isCloseable !== false,
      isPinned: definition.tabType === TabType.PINNED,
      isPreview: asPreview,
      entityKey,
      createdAt: now,
      lastActivatedAt: now,
      order: this.tabsSignal().length,
    };

    this.tabsSignal.update((tabs) => this.sortPinned([...tabs, newTab]));
    if (config.activate !== false) this.activateTab(newTab.id);
  }

  /**
   * ¿Esta apertura es «hojeable» y por tanto candidata a vista previa reutilizable?
   *
   * No basta con el tipo: en este ERP casi todos los detalles de registro son
   * formularios (`DRAFT`→`WIZARD`), y hay dos clases muy distintas:
   *  - **Editar un registro EXISTENTE** (`/clientes/88/edit`, con parámetros de
   *    ruta): es exactamente hojear —abrir uno, mirar, pasar al siguiente—, así que
   *    va en vista previa. En cuanto se toca un campo, se fija (ver el promotor de
   *    edición del `TabWrapper`), de modo que hojear nunca pisa cambios sin guardar.
   *  - **Crear uno NUEVO** (`/clientes/new`, sin parámetros): nunca se reutiliza;
   *    cada uno es una pestaña propia.
   *
   * `RECORD` (documentos) y `REPORT` (análisis) son hojeables siempre. Listas,
   * lienzos, bandejas e inicio son permanentes.
   */
  private isPreviewable(type: TabType, params: Record<string, string>): boolean {
    switch (type) {
      case TabType.RECORD:
      case TabType.REPORT:
        return true;
      case TabType.WIZARD:
        // Solo si apunta a un registro concreto (tiene parámetros); los «nuevos» no.
        return Object.keys(params).length > 0;
      default:
        return false; // PINNED, MODULE_LIST, UTILITY
    }
  }

  /**
   * Reemplaza el contenido de la pestaña de vista previa manteniendo su
   * instancia (mismo `id` y posición). El `TabWrapper`, reactivo por `id`,
   * recarga el componente al detectar el cambio de ruta/entidad.
   */
  private reusePreview(
    tabId: string,
    next: {
      type: TabType;
      title: string;
      icon: string;
      route: string;
      routeParams: Record<string, string>;
      queryParams?: Record<string, string>;
      entityKey?: string;
    }
  ): void {
    this.patch(tabId, {
      ...next,
      isPreview: true,
      isDirty: false,
      isLoading: true,
      viewState: undefined,
      scrollPosition: 0,
      lastActivatedAt: new Date(),
    });
  }

  /** Convierte una vista previa en pestaña permanente (VS Code «Keep open»). */
  markPermanent(tabId: string): void {
    const tab = this.tabsSignal().find((t) => t.id === tabId);
    if (!tab || !tab.isPreview) return;
    this.patch(tabId, { isPreview: false });
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
        message: 'DIALOG.UNSAVED_CHANGES.MESSAGE_IN_TAB',
        messageParams: { tab: tab.title },
        // Sin handler de guardado registrado, no se ofrece «Guardar»: sería un botón que solo sabe
        // decir «guarda desde la vista». Solo Descartar / Cancelar.
        allowSave: this.closeHandlers.has(tabId),
      });
      if (decision === 'cancel') return false;
      if (decision === 'save') {
        const handler = this.closeHandlers.get(tabId);
        if (handler) {
          const ok = await handler();
          if (!ok) return false; // guardar falló → no cerrar
        } else {
          // Sin handler de guardado: avisar y conservar la pestaña.
          this.notify.showInfo('CORE.TABS.GUARDA_CAMBIOS_DESDE_PROPIA_VISTA_ANTES');
          return false;
        }
      }
    }

    this.removeTabSilently(tabId);
    return true;
  }

  /**
   * Elimina la pestaña sin diálogos (uso interno / sincronización con Dockview).
   * `record` decide si se apunta en la pila de «reabrir cerrada»: los cierres que
   * hace el propio sistema (registro borrado, tope de pestañas) no deben ofrecerse
   * para reabrir, pero un cierre del usuario sí.
   */
  removeTabSilently(tabId: string, record = true): void {
    const before = this.tabsSignal();
    const index = before.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    if (record) this.recordClosed(before[index]);
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
    // Editar una vista previa la fija: nadie quiere perder cambios al hojear.
    this.patch(tabId, isDirty ? { isDirty: true, isPreview: false } : { isDirty: false });
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

  /** Reordena según el orden de ids que reporta Dockview (drag & drop de la franja). */
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
      // Una copia es una instancia independiente: sin dedupe, ni pin, ni preview.
      entityKey: undefined,
      isPinned: false,
      isPreview: false,
      isDirty: false,
      title: this.translate.instant('TABS.COPY_OF', { title: tab.title }),
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
      this.notify.showWarning('CORE.TABS.HAS_ALCANZADO_MAXIMO_PESTANAS_CIERRA_ALGUNA', { maxTabs: this.maxTabs });
      return false;
    }
    // Desalojo automático por límite: no se ofrece reabrir (no lo cerró el usuario).
    this.removeTabSilently(candidate.id, false);
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

  // ── Navegación por teclado / reabrir cerrada ────────────────────────────

  /** Activa la pestaña anterior/siguiente (Ctrl+Tab / Ctrl+Shift+Tab). */
  activateRelative(delta: number): void {
    const tabs = this.tabsSignal();
    if (tabs.length === 0) return;
    const activeId = this.activeTabIdSignal();
    const idx = tabs.findIndex((t) => t.id === activeId);
    const base = idx === -1 ? 0 : idx;
    const nextIdx = ((base + delta) % tabs.length + tabs.length) % tabs.length;
    this.activateTab(tabs[nextIdx].id);
  }

  /** Cierra la pestaña activa (Ctrl/Cmd+W). */
  closeActive(): void {
    const id = this.activeTabIdSignal();
    if (id) void this.closeTab(id);
  }

  readonly canReopenClosed = (): boolean => this.closedStack.length > 0;

  /** Reabre la última pestaña cerrada, permanente (Ctrl/Cmd+Shift+T). */
  reopenLastClosed(): void {
    const last = this.closedStack.pop();
    if (!last) return;
    this.openTab({
      route: last.route,
      queryParams: last.queryParams,
      title: last.title,
      icon: last.icon,
      preview: false,
    });
  }

  private recordClosed(tab: TabModel): void {
    // El inicio (PINNED) no se cierra; y una vista previa efímera tampoco vale
    // la pena guardarla: reabrirla sería reproducir un descarte deliberado.
    if (tab.type === TabType.PINNED || tab.isPreview) return;
    this.closedStack.push({
      route: tab.route,
      queryParams: tab.queryParams,
      title: tab.title,
      icon: tab.icon,
    });
    if (this.closedStack.length > TabStateService.CLOSED_STACK_MAX) this.closedStack.shift();
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
