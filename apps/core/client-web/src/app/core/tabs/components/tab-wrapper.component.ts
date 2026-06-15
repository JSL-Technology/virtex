import {
  Component, ChangeDetectionStrategy, ViewChild, ViewContainerRef, ElementRef,
  AfterViewInit, OnDestroy, ComponentRef, Injector, Type, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabStateService } from '../tab-state.service';
import { TAB_CONTEXT, TabContext } from '../tab-context';
import { isTabAware } from '../tab.model';

interface WrapperParams {
  tabId: string;
  load: () => Promise<Type<unknown>>;
  inputs: Record<string, unknown>;
  context: TabContext;
}

/**
 * Monta el componente perezoso de una pestaña (§5/§11). Resuelve `load()`,
 * provee `TAB_CONTEXT`, restaura el scroll y reenvía los hooks de activación
 * (`TabAware`) ya que Dockview NO destruye el DOM de las pestañas inactivas.
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
  private parentInjector = inject(Injector);

  @ViewChild('host', { read: ViewContainerRef, static: true }) host!: ViewContainerRef;
  @ViewChild('scroll', { static: true }) scrollRef!: ElementRef<HTMLElement>;

  /** Inyectado por Dockview. */
  params!: WrapperParams;
  api: any;

  readonly loading = signal(true);

  private compRef?: ComponentRef<unknown>;
  private activeSub?: { dispose: () => void };

  async ngAfterViewInit(): Promise<void> {
    const p = this.params;
    if (!p?.load) { this.loading.set(false); return; }

    try {
      const type = await p.load();
      const injector = Injector.create({
        providers: [{ provide: TAB_CONTEXT, useValue: p.context }],
        parent: this.parentInjector,
      });

      this.compRef = this.host.createComponent(type as Type<unknown>, { injector });
      this.applyInputs(type as Type<unknown>, p.inputs ?? {});
      this.compRef.changeDetectorRef.markForCheck();

      this.tabState.setLoading(p.tabId, false);
      this.loading.set(false);

      // Restaura scroll guardado.
      queueMicrotask(() => this.restoreScroll());

      // Reenvía hooks de activación/desactivación.
      if (this.api?.onDidActiveChange) {
        this.activeSub = this.api.onDidActiveChange((e: { isActive: boolean }) => {
          if (e.isActive) {
            this.callHook('onTabActivated');
            this.restoreScroll();
          } else {
            this.saveScroll();
            this.callHook('onTabDeactivated');
          }
        });
      }
    } catch (err) {
      console.error('[tab-wrapper] Error montando el componente de la pestaña', err);
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.saveScroll();
    this.activeSub?.dispose?.();
    this.compRef?.destroy();
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
    const tab = this.tabState.tabs().find((t) => t.id === this.params?.tabId);
    const top = tab?.scrollPosition;
    if (this.scrollRef?.nativeElement && typeof top === 'number') {
      this.scrollRef.nativeElement.scrollTop = top;
    }
  }

  private saveScroll(): void {
    const el = this.scrollRef?.nativeElement;
    if (el && this.params?.tabId) {
      this.tabState.setScroll(this.params.tabId, el.scrollTop);
    }
  }
}
