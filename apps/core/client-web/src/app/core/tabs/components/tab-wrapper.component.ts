import {
  Component, ChangeDetectionStrategy, ViewChild, ViewContainerRef, ElementRef,
  AfterViewInit, OnDestroy, ComponentRef, Injector, Type, EffectRef, inject, effect, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabStateService } from '../tab-state.service';
import { TabRegistryService } from '../tab-registry.service';
import { TabEventBusService } from '../tab-event-bus.service';
import { TAB_CONTEXT, TabContext } from '../tab-context';
import { TabModel, TabType, isTabAware } from '../tab.model';

interface WrapperParams {
  /** Única identidad que necesita: todo lo demás se deriva del WorkspaceStore. */
  tabId: string;
}

/**
 * Monta el componente perezoso de una pestaña (§5/§11).
 *
 * ## Por qué se conduce por `tabId` y no por parámetros congelados
 *
 * Antes recibía `load`, `inputs` y `context` ya resueltos al crear el panel. Eso
 * ataba el contenido al instante de apertura: la vista previa reutilizable —que
 * cambia de ruta SIN cambiar de panel— no tenía forma de recargarse, y el layout
 * de Dockview no se podía serializar (una función `load` no cabe en JSON).
 *
 * Ahora el wrapper solo guarda el `tabId`, lee su pestaña del store de forma
 * reactiva y **recarga el componente en el sitio** cuando cambia la ruta/entidad
 * (reutilización de la vista previa). Resuelve `load` del registro, así que sus
 * `params` son serializables y el layout puede persistirse.
 *
 * Como Dockview NO destruye el DOM de las pestañas inactivas, reenvía además los
 * hooks `TabAware` para pausar/reanudar trabajo costoso, y guarda/restaura scroll.
 */
@Component({
  selector: 'app-tab-wrapper',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tab-scroll" #scroll>
      @if (loading()) {
        <div class="tab-loading">
          <div class="tab-spinner"></div>
        </div>
      }
      <ng-container #host></ng-container>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .tab-scroll { height: 100%; width: 100%; overflow: auto; position: relative; }
    .tab-loading {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; background: var(--bg-primary); z-index: 1;
    }
    .tab-spinner {
      width: 32px; height: 32px; border-radius: 50%;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent-primary);
      animation: tab-spin 0.8s linear infinite;
    }
    @keyframes tab-spin { to { transform: rotate(360deg); } }
  `],
})
export class TabWrapperComponent implements AfterViewInit, OnDestroy {
  private tabState = inject(TabStateService);
  private registry = inject(TabRegistryService);
  private bus = inject(TabEventBusService);
  private parentInjector = inject(Injector);

  @ViewChild('host', { read: ViewContainerRef, static: true }) host!: ViewContainerRef;
  @ViewChild('scroll', { static: true }) scrollRef!: ElementRef<HTMLElement>;

  /** Inyectado por Dockview. */
  params!: WrapperParams;
  api: any;

  readonly loading = signal(true);

  private compRef?: ComponentRef<unknown>;
  private activeSub?: { dispose: () => void };
  private reloadRef?: EffectRef;
  /** Firma del contenido montado, para no recargar ante cambios irrelevantes. */
  private mountedSig = '';

  private get tabId(): string {
    return this.params?.tabId ?? this.api?.id ?? '';
  }

  async ngAfterViewInit(): Promise<void> {
    const tab = this.currentTab();
    if (!tab) { this.loading.set(false); return; }

    await this.mount(tab);
    this.mountedSig = this.signature(tab);

    // Recarga reactiva: al reutilizar la vista previa, la MISMA pestaña cambia de
    // ruta/entidad. Se recarga el componente en su sitio (sin crear otro panel).
    // El trabajo se aplaza a un microtask para no escribir señales dentro del
    // efecto ni bloquear su ejecución síncrona.
    this.reloadRef = effect(() => {
      const t = this.currentTab();
      const sig = t ? this.signature(t) : '';
      if (!t || sig === this.mountedSig) return;
      this.mountedSig = sig;
      const target = t;
      queueMicrotask(() => void this.remount(target));
    }, { injector: this.parentInjector });

    // Promotor de edición (estilo VS Code): en cuanto se ESCRIBE algo dentro de una
    // vista previa, la pestaña se fija. Es lo que hace seguro reutilizar la preview
    // en formularios de edición: hojear reemplaza contenido, pero editar deja de ser
    // efímero antes de que el siguiente clic pueda pisar cambios sin guardar. Vive
    // aquí y no en cada página: 24 formularios no llaman a `markDirty`.
    const scroll = this.scrollRef?.nativeElement;
    if (scroll) {
      for (const ev of TabWrapperComponent.EDIT_EVENTS) {
        scroll.addEventListener(ev, this.promoteOnEdit, true);
      }
    }

    // Reenvía hooks de activación/desactivación y pausa la detección de cambios de las inactivas.
    if (this.api?.onDidActiveChange) {
      this.activeSub = this.api.onDidActiveChange((e: { isActive: boolean }) => {
        if (e.isActive) {
          this.reattachCd();
          this.callHook('onTabActivated');
          this.restoreScroll();
        } else {
          this.saveScroll();
          this.callHook('onTabDeactivated');
          this.detachCd();
        }
      });
    }

    // Una pestaña abierta en segundo plano nace inactiva: su DOM existe pero no debe consumir
    // ciclos de render hasta que se mire.
    if (this.api && this.api.isActive === false) this.detachCd();
  }

  /**
   * Suelta la vista de la detección de cambios global mientras la pestaña está oculta.
   *
   * Dockview NO destruye el DOM de las pestañas inactivas, así que sin esto Angular seguía
   * comprobando 20 páginas en cada tic por una sola visible. Los timers, sockets y suscripciones
   * de la página siguen vivos —para eso está `TabAware`—; lo que se pausa es solo el repintado de
   * algo que nadie ve. Al reactivar se re-vincula y se fuerza un refresco.
   */
  private detachCd(): void {
    try { this.compRef?.changeDetectorRef.detach(); } catch { /* noop */ }
  }

  private reattachCd(): void {
    const cdr = this.compRef?.changeDetectorRef;
    if (!cdr) return;
    try {
      cdr.reattach();
      cdr.markForCheck();
    } catch { /* noop */ }
  }

  ngOnDestroy(): void {
    this.saveScroll();
    const scroll = this.scrollRef?.nativeElement;
    if (scroll) {
      for (const ev of TabWrapperComponent.EDIT_EVENTS) {
        scroll.removeEventListener(ev, this.promoteOnEdit, true);
      }
    }
    this.reloadRef?.destroy();
    this.activeSub?.dispose?.();
    this.compRef?.destroy();
  }

  /** Eventos que delatan una edición real (no un simple clic o desplazamiento). */
  private static readonly EDIT_EVENTS = ['beforeinput', 'change', 'paste'] as const;

  /**
   * Reacciona al primer signo de edición dentro del contenido de la pestaña.
   *
   * En un registro o un formulario (`RECORD` / `WIZARD`) editar significa «cambios sin guardar»:
   * se marca sucia —lo que además fija una vista previa—, así el aviso de cierre y el `beforeunload`
   * dejan de ser promesas vacías incluso para las 24 páginas que nunca llamaron a `markDirty`. En
   * una lista o un informe no hay nada que guardar (escribir en un filtro no es un cambio pendiente),
   * así que ahí una interacción solo FIJA la vista previa, sin ensuciarla.
   *
   * Una página que gestione su propio estado sucio con `TAB_CONTEXT.markDirty/markClean` sigue
   * mandando: esto solo actúa como red de seguridad y nunca vuelve a ensuciar tras un `markClean`
   * mientras el usuario no edite de nuevo.
   */
  private readonly promoteOnEdit = (): void => {
    const tab = this.currentTab();
    if (!tab) return;
    if (tab.type === TabType.RECORD || tab.type === TabType.WIZARD) {
      if (!tab.isDirty) this.tabState.markDirty(this.tabId);
    } else if (tab.isPreview) {
      this.tabState.markPermanent(this.tabId);
    }
  };

  // ── montaje ────────────────────────────────────────────────────────────

  private currentTab(): TabModel | undefined {
    return this.tabState.tabs().find((t) => t.id === this.tabId);
  }

  /** Ruta + entidad + query: lo que define «qué se muestra» dentro del panel. */
  private signature(t: TabModel): string {
    return `${t.route}|${t.entityKey ?? ''}|${JSON.stringify(t.queryParams ?? {})}`;
  }

  private async mount(tab: TabModel): Promise<void> {
    this.loading.set(true);
    const { definition } = this.registry.resolve(tab.route);
    try {
      const type = (await definition.load()) as Type<unknown>;
      const tabId = tab.id;
      const context: TabContext = {
        tabId,
        type: tab.type,
        route: tab.route,
        title: tab.title,
        icon: tab.icon,
        params: tab.routeParams ?? {},
        query: tab.queryParams ?? {},
        // Acciones ligadas a ESTA pestaña: la página no necesita el `tabId` ni el store.
        markDirty: (isDirty = true) => this.tabState.markDirty(tabId, isDirty),
        markClean: () => this.tabState.markClean(tabId),
        registerSaveHandler: (handler) => this.tabState.registerSaveHandler(tabId, handler),
        emit: (event) => this.bus.emit(event),
      };
      const injector = Injector.create({
        providers: [{ provide: TAB_CONTEXT, useValue: context }],
        parent: this.parentInjector,
      });

      this.compRef = this.host.createComponent(type, { injector });
      this.applyInputs(type, { ...(tab.routeParams ?? {}), ...(tab.queryParams ?? {}) });
      this.compRef.changeDetectorRef.markForCheck();

      this.tabState.setLoading(tab.id, false);
      this.loading.set(false);
      queueMicrotask(() => this.restoreScroll());
    } catch (err) {
      console.error('[tab-wrapper] Error montando el componente de la pestaña', err);
      this.loading.set(false);
    }
  }

  /** Sustituye el componente montado por el de la nueva ruta (misma pestaña). */
  private async remount(tab: TabModel): Promise<void> {
    this.compRef?.destroy();
    this.compRef = undefined;
    this.host.clear();
    await this.mount(tab);
  }

  private applyInputs(type: Type<unknown>, inputs: Record<string, unknown>): void {
    if (!this.compRef) return;
    const declared = (type as any)?.ɵcmp?.inputs as Record<string, unknown> | undefined;
    const allowed = declared ? new Set(Object.keys(declared)) : null;
    for (const [key, value] of Object.entries(inputs)) {
      if (value === undefined) continue;
      if (allowed && !allowed.has(key)) continue;
      try {
        this.compRef.setInput(key, value);
      } catch {
        /* input no declarado: se ignora de forma segura */
      }
    }
  }

  private callHook(hook: 'onTabActivated' | 'onTabDeactivated'): void {
    const instance = this.compRef?.instance;
    if (isTabAware(instance)) instance[hook]?.();
  }

  private restoreScroll(): void {
    const top = this.currentTab()?.scrollPosition;
    if (this.scrollRef?.nativeElement && typeof top === 'number') {
      this.scrollRef.nativeElement.scrollTop = top;
    }
  }

  private saveScroll(): void {
    const el = this.scrollRef?.nativeElement;
    if (el && this.tabId) {
      this.tabState.setScroll(this.tabId, el.scrollTop);
    }
  }
}
