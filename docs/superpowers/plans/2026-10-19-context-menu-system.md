# Sistema de menús contextuales — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a la app un menú contextual al estilo del navegador (clic derecho) cuyo contenido depende de dónde se hace clic (fila, tabla, selección múltiple), reutilizable y cableado en Inventario como vitrina.

**Architecture:** Motor data-driven sobre `@angular/cdk/menu` (`CdkContextMenuTrigger` + `CdkMenu`), con un `ContextMenuService` que abre un host único (`<vx-context-menu>`, montado una vez en `app.html`) en las coordenadas del cursor. La integración por tabla se hace con dos directivas co-locadas en el mismo template de la página —`[appTableMenu]` sobre `<table>` (menú de tabla/vacío + proveedor de selección y config) y `[appRowMenu]` sobre `<tr>` (menú de fila + selección)— que se comunican por el inyector de elemento. La selección múltiple vive en un `ListSelectionService` opcional que la página provee cuando quiere acciones en lote.

**Tech Stack:** Angular 20 (standalone, signals, OnPush), `@angular/cdk/menu` (ya instalado), `lucide-angular`, i18n por catálogo (`libs/shared/locales/src/base`).

---

## Estructura de archivos

```
apps/core/client-web/src/app/shared/components/context-menu/
  context-menu.types.ts           → MenuContext, MenuItem, MenuSection, ListMenuConfig
  list-selection.service.ts       → ListSelectionService (opcional, por página)
  context-menu.service.ts         → ContextMenuService (host único + open/close)
  context-menu-item.component.ts   → app-context-menu-item (presentacional)
  context-menu-item.component.scss
  context-menu.component.ts        → vx-context-menu (host del overlay, cdkMenu data-driven)
  context-menu.component.html
  context-menu.component.scss
  table-menu.directive.ts          → [appTableMenu] (config + selección + menú de tabla)
  row-menu.directive.ts            → [appRowMenu] (menú de fila + selección)
  index.ts                         → barril + VX_CONTEXT_MENU
  context-menu.spec.ts             → servicio, directivas, selección
```

Modificados:
- `app.ts` / `app.html` — montar `<vx-context-menu />` una vez.
- `shared/components/index.ts` — reexportar `./context-menu`.
- `libs/shared/locales/src/base/actions.json` — claves genéricas.
- `features/inventory/products/products.page.{ts,html,scss}` — vitrina.
- `shared/components/overlay-styles.spec.ts` — ya cubre componentes de overlay (verifica el gotcha automáticamente).

---

### Task 1: Modelo de datos

**Files:** Create `shared/components/context-menu/context-menu.types.ts`

- [ ] **Step 1: Escribir el tipo**

```ts
import type { LucideIconData } from 'lucide-angular';
import type { KeyChord } from '../../../core/keyboard/keyboard-shortcuts';

export type MenuContextKind = 'row' | 'table' | 'cell' | 'empty';

export interface MenuContext<E = unknown> {
  readonly kind: MenuContextKind;
  readonly entity?: E;
  readonly selection: readonly E[];
  readonly event: MouseEvent | KeyboardEvent;
}

export interface MenuLabel {
  key: string;
  params?: Record<string, unknown>;
}

export interface MenuItem<C extends MenuContext = MenuContext> {
  id: string;
  /** Clave i18n, o función para un label dinámico (p.ej. «Eliminar {{n}}»). */
  label: string | ((ctx: C) => MenuLabel | string);
  icon?: LucideIconData;
  chord?: KeyChord;
  permission?: string | string[];
  danger?: boolean;
  checked?: (ctx: C) => boolean;
  visible?: (ctx: C) => boolean;
  disabled?: (ctx: C) => boolean;
  submenu?: MenuItem<C>[];
  run?: (ctx: C) => void | Promise<void>;
}

export interface MenuSection<C extends MenuContext = MenuContext> {
  id: string;
  items: MenuItem<C>[];
}

export interface ListMenuConfig<E = unknown> {
  resource: string;
  table?: MenuSection<MenuContext<E>>[];
  row?: (ctx: MenuContext<E>) => MenuSection<MenuContext<E>>[];
}
```

- [ ] **Step 2: Compilar** `npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json` (no errores en el archivo nuevo). **Commit.**

---

### Task 2: ListSelectionService

**Files:** Create `shared/components/context-menu/list-selection.service.ts`, Test `context-menu.spec.ts`

- [ ] **Step 1: Test (selección básica + rango + select-all)**

```ts
import { ListSelectionService } from './list-selection.service';

interface Row { id: string; }
const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('ListSelectionService', () => {
  let svc: ListSelectionService<Row>;
  beforeEach(() => { svc = new ListSelectionService<Row>(); svc.setItems(rows, (r) => r.id); });

  it('toggles one id', () => {
    svc.toggle('b');
    expect(svc.isSelected('b')).toBe(true);
    expect(svc.count()).toBe(1);
  });

  it('selects a range from the last anchor', () => {
    svc.toggle('a');
    svc.selectRange('c');
    expect([...svc.selected()].map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('select-all toggles every row', () => {
    svc.toggleAll();
    expect(svc.count()).toBe(4);
    svc.toggleAll();
    expect(svc.count()).toBe(0);
  });

  it('drops selection that no longer exists after setItems', () => {
    svc.toggle('d');
    svc.setItems([{ id: 'a' }], (r) => r.id);
    expect(svc.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Implementación**

```ts
import { Injectable, computed, signal } from '@angular/core';

/**
 * Selección múltiple de una lista. La provee la PÁGINA que quiere acciones en lote
 * (`providers: [ListSelectionService]`); las directivas del menú la inyectan opcionalmente.
 */
@Injectable()
export class ListSelectionService<E = unknown> {
  private readonly ids = signal<ReadonlySet<string>>(new Set());
  private items = new Map<string, E>();
  private order: string[] = [];
  private anchor: string | null = null;

  readonly count = computed(() => this.ids().size);
  readonly selected = computed<E[]>(() =>
    [...this.ids()].map((id) => this.items.get(id)).filter((r): r is E => r !== undefined),
  );

  setItems(rows: readonly E[], idOf: (row: E) => string): void {
    this.items = new Map(rows.map((r) => [idOf(r), r]));
    this.order = rows.map(idOf);
    const kept = new Set([...this.ids()].filter((id) => this.items.has(id)));
    if (kept.size !== this.ids().size) this.ids.set(kept);
  }

  isSelected(id: string): boolean { return this.ids().has(id); }

  toggle(id: string): void {
    const next = new Set(this.ids());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.ids.set(next);
    this.anchor = id;
  }

  selectOnly(id: string): void { this.ids.set(new Set([id])); this.anchor = id; }

  selectRange(toId: string): void {
    const from = this.anchor ? this.order.indexOf(this.anchor) : -1;
    const to = this.order.indexOf(toId);
    if (from < 0 || to < 0) { this.selectOnly(toId); return; }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.ids.set(new Set(this.order.slice(lo, hi + 1)));
  }

  allSelected(): boolean { return this.order.length > 0 && this.order.every((id) => this.ids().has(id)); }
  toggleAll(): void { this.ids.set(this.allSelected() ? new Set() : new Set(this.order)); }
  clear(): void { this.ids.set(new Set()); this.anchor = null; }
}
```

- [ ] **Step 3: Run** `npx jest context-menu --silent` → PASS. **Commit.**

---

### Task 3: ContextMenuService

**Files:** Create `context-menu.service.ts`, extend `context-menu.spec.ts`

- [ ] **Step 1: Test (no abre sin host ni secciones; abre con host)**

```ts
import { ContextMenuService } from './context-menu.service';

describe('ContextMenuService', () => {
  it('no abre si no hay host registrado', () => {
    const svc = new ContextMenuService();
    const ev = new MouseEvent('contextmenu', { clientX: 10, clientY: 20 });
    expect(() => svc.open(ev, [{ id: 's', items: [{ id: 'i', label: 'x' }] }], { kind: 'row', selection: [], event: ev })).not.toThrow();
  });

  it('abre en las coordenadas del ratón', () => {
    const svc = new ContextMenuService();
    const calls: Array<{ x: number; y: number }> = [];
    svc.registerHost({ openAt: (x, y) => calls.push({ x, y }), close: () => {} });
    const ev = new MouseEvent('contextmenu', { clientX: 42, clientY: 7 });
    svc.open(ev, [{ id: 's', items: [{ id: 'i', label: 'x' }] }], { kind: 'row', selection: [], event: ev });
    expect(calls).toEqual([{ x: 42, y: 7 }]);
    expect(svc.sections().length).toBe(1);
  });
});
```

- [ ] **Step 2: Implementación**

```ts
import { Injectable, signal } from '@angular/core';
import { MenuContext, MenuSection } from './context-menu.types';

export interface ContextMenuHost {
  openAt(x: number, y: number): void;
  close(): void;
}

@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  private host: ContextMenuHost | null = null;
  readonly sections = signal<MenuSection[]>([]);
  readonly context = signal<MenuContext | null>(null);

  registerHost(host: ContextMenuHost): void { this.host = host; }

  open(event: MouseEvent | KeyboardEvent, sections: MenuSection[], context: MenuContext): void {
    if (!this.host || sections.length === 0) return;
    event.preventDefault();
    this.sections.set(sections);
    this.context.set(context);
    const { x, y } = coordsOf(event);
    this.host.openAt(x, y);
  }

  close(): void { this.host?.close(); }
}

function coordsOf(event: MouseEvent | KeyboardEvent): { x: number; y: number } {
  if (event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = (event.target as HTMLElement | null)?.getBoundingClientRect();
  return rect ? { x: rect.left + 8, y: rect.bottom - 4 } : { x: 0, y: 0 };
}
```

- [ ] **Step 3: Run** `npx jest context-menu --silent` → PASS. **Commit.**

---

### Task 4: Fila presentacional (`app-context-menu-item`)

**Files:** Create `context-menu-item.component.ts` + `.scss`

- [ ] **Step 1: Implementación** (presentacional; sin lógica de menú)

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Check, ChevronRight } from 'lucide-angular';
import { VxKbdComponent } from '../kbd';
import { MenuContext, MenuItem } from './context-menu.types';

@Component({
  selector: 'app-context-menu-item',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, VxKbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="vx-ctx-item__check">
      @if (checked()) { <lucide-icon [img]="CheckIcon" size="14" aria-hidden="true" /> }
    </span>
    @if (item().icon; as icon) {
      <lucide-icon class="vx-ctx-item__icon" [img]="icon" size="16" aria-hidden="true" />
    }
    <span class="vx-ctx-item__label">{{ label().key | translate: label().params }}</span>
    @if (item().chord; as chord) { <vx-kbd class="vx-ctx-item__kbd" [chord]="chord" /> }
    @if (hasSubmenu()) {
      <lucide-icon class="vx-ctx-item__chevron" [img]="ChevronIcon" size="14" aria-hidden="true" />
    }
  `,
  styleUrls: ['./context-menu-item.component.scss'],
})
export class ContextMenuItemComponent {
  readonly item = input.required<MenuItem>();
  readonly ctx = input<MenuContext | null>(null);
  readonly hasSubmenu = input(false);

  protected readonly CheckIcon = Check;
  protected readonly ChevronIcon = ChevronRight;

  protected readonly label = computed(() => {
    const raw = this.item().label;
    const value = typeof raw === 'function' ? raw(this.ctx() ?? EMPTY) : raw;
    return typeof value === 'string' ? { key: value, params: undefined } : value;
  });

  protected readonly checked = computed(() => {
    const ctx = this.ctx();
    const fn = this.item().checked;
    return !!ctx && !!fn && fn(ctx);
  });
}

const EMPTY: MenuContext = { kind: 'empty', selection: [], event: new MouseEvent('contextmenu') };
```

- [ ] **Step 2: Estilo** `context-menu-item.component.scss` (calca `tab-context-menu-item.component.scss`, usa tokens)

```scss
:host {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}
.vx-ctx-item__check,
.vx-ctx-item__chevron { display: inline-flex; width: 1rem; flex: none; justify-content: center; }
.vx-ctx-item__icon { flex: none; color: var(--content-secondary); }
.vx-ctx-item__label { flex: 1 1 auto; white-space: nowrap; }
.vx-ctx-item__kbd { margin-left: var(--space-4); }
.vx-ctx-item__chevron { margin-left: auto; color: var(--content-tertiary); }
```

- [ ] **Step 3: Compilar.** **Commit.**

---

### Task 5: Host `vx-context-menu`

**Files:** Create `context-menu.component.ts` + `.html` + `.scss`

- [ ] **Step 1: Componente**

```ts
import { ChangeDetectionStrategy, Component, ViewChild, computed, inject, OnInit } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger, CdkContextMenuTrigger } from '@angular/cdk/menu';
import { AuthService } from '../../../core/services/auth';
import { ContextMenuService } from './context-menu.service';
import { ContextMenuItemComponent } from './context-menu-item.component';
import { MenuContext, MenuItem, MenuSection } from './context-menu.types';

@Component({
  selector: 'vx-context-menu',
  standalone: true,
  imports: [NgTemplateOutlet, CdkMenu, CdkMenuItem, CdkMenuTrigger, CdkContextMenuTrigger, ContextMenuItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-menu.component.html',
  styleUrls: ['./context-menu.component.scss'],
})
export class ContextMenuComponent implements OnInit {
  private readonly service = inject(ContextMenuService);
  private readonly auth = inject(AuthService);

  @ViewChild(CdkContextMenuTrigger, { static: true }) private trigger!: CdkContextMenuTrigger;

  protected readonly context = this.service.context;

  protected readonly visibleSections = computed<MenuSection[]>(() => {
    const ctx = this.service.context();
    if (!ctx) return [];
    return this.service.sections()
      .map((s) => ({ ...s, items: s.items.filter((i) => this.isVisible(i, ctx)) }))
      .filter((s) => s.items.length > 0);
  });

  ngOnInit(): void {
    this.service.registerHost({
      openAt: (x, y) => this.trigger.open({ x, y }),
      close: () => this.trigger.close(),
    });
  }

  protected isVisible(item: MenuItem, ctx: MenuContext): boolean {
    if (item.visible && !item.visible(ctx)) return false;
    if (item.permission && !this.auth.hasPermissions(Array.isArray(item.permission) ? item.permission : [item.permission])) return false;
    return true;
  }

  protected isDisabled(item: MenuItem, ctx: MenuContext | null): boolean {
    return !!ctx && !!item.disabled && item.disabled(ctx);
  }

  protected async run(item: MenuItem): Promise<void> {
    const ctx = this.service.context();
    if (ctx && item.run) await item.run(ctx);
  }
}
```

- [ ] **Step 2: Template** `context-menu.component.html`

```html
<!-- Ancla de tamaño cero: el menú abre en las coordenadas del cursor, no aquí. -->
<span class="vx-ctx-anchor" [cdkContextMenuTriggerFor]="panel" aria-hidden="true"></span>

<ng-template #panel>
  <div cdkMenu class="vx-ctx-panel">
    @for (section of visibleSections(); track section.id; let lastSection = $last) {
      @for (item of section.items; track item.id) {
        <ng-container [ngTemplateOutlet]="itemTpl" [ngTemplateOutletContext]="{ $implicit: item }" />
      }
      @if (!lastSection) { <div class="vx-ctx-sep" role="separator"></div> }
    }
  </div>
</ng-template>

<ng-template #itemTpl let-item>
  @if (item.submenu && item.submenu.length) {
    <button cdkMenuItem [cdkMenuTriggerFor]="submenu" class="vx-ctx-trigger" [class.vx-ctx-trigger--danger]="item.danger">
      <app-context-menu-item [item]="item" [ctx]="context()" [hasSubmenu]="true" />
    </button>
    <ng-template #submenu>
      <div cdkMenu class="vx-ctx-panel">
        @for (sub of item.submenu; track sub.id) {
          @if (isVisible(sub, context()!)) {
            <ng-container [ngTemplateOutlet]="itemTpl" [ngTemplateOutletContext]="{ $implicit: sub }" />
          }
        }
      </div>
    </ng-template>
  } @else {
    <button cdkMenuItem class="vx-ctx-trigger" [class.vx-ctx-trigger--danger]="item.danger"
      [cdkMenuItemDisabled]="isDisabled(item, context())" (cdkMenuItemTriggered)="run(item)">
      <app-context-menu-item [item]="item" [ctx]="context()" />
    </button>
  }
</ng-template>
```

- [ ] **Step 3: Estilo** `context-menu.component.scss` (estiliza el PANEL del overlay directamente, no `:host` — gotcha)

```scss
.vx-ctx-anchor { position: fixed; width: 0; height: 0; }

// El panel vive en el overlay (fuera del :host). Se estiliza por su clase global.
::ng-deep .vx-ctx-panel {
  min-width: 13rem;
  padding: var(--space-1);
  background: var(--surface-overlay, var(--surface-raised));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
::ng-deep .vx-ctx-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--content-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  &:hover, &:focus-visible { background: var(--accent-surface); color: var(--content-primary); outline: none; }
  &.cdk-menu-item-disabled { color: var(--content-disabled); cursor: default; pointer-events: none; }
  &--danger { color: var(--danger-content, var(--danger)); }
  &--danger:hover, &--danger:focus-visible { background: var(--danger-surface, var(--accent-surface)); color: var(--danger-content, var(--danger)); }
}
::ng-deep .vx-ctx-sep { height: 1px; margin: var(--space-1) 0; background: var(--border-subtle); }
```

- [ ] **Step 4: Compilar.** **Commit.**

---

### Task 6: Directiva `[appTableMenu]`

**Files:** Create `table-menu.directive.ts`

- [ ] **Step 1: Implementación**

```ts
import { Directive, ElementRef, inject, input } from '@angular/core';
import { ContextMenuService } from './context-menu.service';
import { ListSelectionService } from './list-selection.service';
import { ListMenuConfig, MenuContext, MenuSection } from './context-menu.types';

@Directive({
  selector: 'table[appTableMenu], [appTableMenu]',
  standalone: true,
  exportAs: 'appTableMenu',
  host: { '(contextmenu)': 'onContextMenu($event)' },
})
export class TableMenuDirective<E = unknown> {
  readonly config = input.required<ListMenuConfig<E>>({ alias: 'appTableMenu' });
  readonly selection = inject(ListSelectionService, { optional: true }) as ListSelectionService<E> | null;
  private readonly menu = inject(ContextMenuService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  onContextMenu(event: MouseEvent): void {
    // Una fila responde su propio menú (y hace stopPropagation); aquí sólo el cromo/vacío de la tabla.
    if ((event.target as HTMLElement | null)?.closest('tbody tr')) return;
    const sections = (this.config().table ?? []) as MenuSection[];
    this.menu.open(event, sections, this.context(event));
  }

  /** Para el botón ⋮ de la cabecera. */
  open(event: MouseEvent): void {
    const sections = (this.config().table ?? []) as MenuSection[];
    this.menu.open(event, sections, this.context(event));
  }

  context(event: MouseEvent | KeyboardEvent): MenuContext<E> {
    return { kind: 'table', selection: this.selection?.selected() ?? [], event };
  }
}
```

- [ ] **Step 2: Compilar.** **Commit.**

---

### Task 7: Directiva `[appRowMenu]`

**Files:** Create `row-menu.directive.ts`, extend `context-menu.spec.ts`

- [ ] **Step 1: Test de integración (abre en contextmenu con contexto de fila)**

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ContextMenuService } from './context-menu.service';
import { TableMenuDirective } from './table-menu.directive';
import { RowMenuDirective } from './row-menu.directive';
import { ListMenuConfig } from './context-menu.types';
import { provideZonelessChangeDetection } from '@angular/core';
import { AuthService } from '../../../core/services/auth';

@Component({
  standalone: true,
  imports: [TableMenuDirective, RowMenuDirective],
  template: `<table [appTableMenu]="menu"><tbody><tr [appRowMenu]="row"><td>x</td></tr></tbody></table>`,
})
class Host {
  row = { id: 'p1', name: 'Prod' };
  menu: ListMenuConfig = { resource: 'x', row: (ctx) => [{ id: 'r', items: [{ id: 'edit', label: 'edit', run: () => {} }] }] };
}

describe('appRowMenu', () => {
  it('abre el menú con el contexto de la fila', () => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection(), { provide: AuthService, useValue: { hasPermissions: () => true } }],
    });
    const svc = TestBed.inject(ContextMenuService);
    const opened: unknown[] = [];
    svc.registerHost({ openAt: () => opened.push(svc.context()), close: () => {} });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const tr = fixture.nativeElement.querySelector('tr') as HTMLElement;
    tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    expect(svc.context()?.kind).toBe('row');
    expect((svc.context()?.entity as { id: string }).id).toBe('p1');
    expect(svc.sections().length).toBe(1);
  });
});
```

- [ ] **Step 2: Implementación**

```ts
import { Directive, inject, input } from '@angular/core';
import { ContextMenuService } from './context-menu.service';
import { ListSelectionService } from './list-selection.service';
import { TableMenuDirective } from './table-menu.directive';
import { MenuContext, MenuSection } from './context-menu.types';

@Directive({
  selector: 'tr[appRowMenu], [appRowMenu]',
  standalone: true,
  exportAs: 'appRowMenu',
  host: {
    '(contextmenu)': 'onPointer($event)',
    '(keydown.shift.F10)': 'onKeyboard($event)',
    '(keydown.ContextMenu)': 'onKeyboard($event)',
  },
})
export class RowMenuDirective<E = unknown> {
  readonly entity = input.required<E>({ alias: 'appRowMenu' });
  readonly rowId = input<(e: E) => string>((e) => String((e as { id: unknown }).id));

  private readonly table = inject(TableMenuDirective) as TableMenuDirective<E>;
  private readonly selection = inject(ListSelectionService, { optional: true }) as ListSelectionService<E> | null;
  private readonly menu = inject(ContextMenuService);

  onPointer(event: MouseEvent): void { event.stopPropagation(); this.open(event); }
  onKeyboard(event: KeyboardEvent): void { event.stopPropagation(); this.open(event); }

  open(event: MouseEvent | KeyboardEvent): void {
    const entity = this.entity();
    const id = this.rowId()(entity);
    if (this.selection && !this.selection.isSelected(id)) this.selection.selectOnly(id);
    const selection = this.selection && this.selection.count() > 0 ? this.selection.selected() : [entity];
    const ctx: MenuContext<E> = { kind: 'row', entity, selection, event };
    const config = this.table.config();
    const sections = [...(config.row ? config.row(ctx) : []), ...(config.table ?? [])] as MenuSection[];
    this.menu.open(event, sections, ctx as MenuContext);
  }
}
```

- [ ] **Step 3: Run** `npx jest context-menu --silent` → PASS. **Commit.**

---

### Task 8: Barril + montaje en app + reexport

**Files:** Create `context-menu/index.ts`; Modify `app.ts`, `app.html`, `shared/components/index.ts`

- [ ] **Step 1: `context-menu/index.ts`**

```ts
export * from './context-menu.types';
export * from './context-menu.service';
export * from './list-selection.service';
export * from './context-menu-item.component';
export * from './context-menu.component';
export * from './table-menu.directive';
export * from './row-menu.directive';

import { TableMenuDirective } from './table-menu.directive';
import { RowMenuDirective } from './row-menu.directive';

/** Añadir a los `imports` de una página con tabla para darle menú contextual. */
export const VX_CONTEXT_MENU = [TableMenuDirective, RowMenuDirective] as const;
```

- [ ] **Step 2: Reexportar desde `shared/components/index.ts`** — añadir `export * from './context-menu';` tras la última línea de `export *`.

- [ ] **Step 3: Montar el host en `app.ts`** — importar `ContextMenuComponent` desde `./shared/components/context-menu` y añadirlo al array `imports`.

- [ ] **Step 4: `app.html`** — añadir al final: `<vx-context-menu />`

- [ ] **Step 5: Compilar.** **Commit.**

---

### Task 9: i18n — claves genéricas

**Files:** Modify `libs/shared/locales/src/base/actions.json`

- [ ] **Step 1: Añadir claves** (es/en/pt), respetando orden alfabético por clave:

```json
"actions.archive": { "es": "Archivar", "en": "Archive", "pt": "Arquivar" },
"actions.archive_n": { "es": "Archivar {{n}}", "en": "Archive {{n}}", "pt": "Arquivar {{n}}" },
"actions.delete_n": { "es": "Eliminar {{n}}", "en": "Delete {{n}}", "pt": "Excluir {{n}}" },
"actions.duplicate": { "es": "Duplicar", "en": "Duplicate", "pt": "Duplicar" },
"actions.export": { "es": "Exportar", "en": "Export", "pt": "Exportar" },
"actions.export_n": { "es": "Exportar {{n}}", "en": "Export {{n}}", "pt": "Exportar {{n}}" },
"actions.refresh": { "es": "Refrescar", "en": "Refresh", "pt": "Atualizar" },
"actions.row_actions": { "es": "Acciones de la fila", "en": "Row actions", "pt": "Ações da linha" }
```

(Reutiliza `inventory.products.edit`, `.delete`, `.new_product` existentes para fila/tabla.)

- [ ] **Step 2: Generar catálogos** `npm run i18n:build` (o `node tools/i18n/build-catalogues.mjs`).
- [ ] **Step 3: Verificar** `node tools/i18n/verify-catalogues.mjs` → sin huérfanos/stale/parity. **Commit.**

---

### Task 10: Vitrina en Inventario / Productos

**Files:** Modify `features/inventory/products/products.page.{ts,html,scss}`

- [ ] **Step 1: `products.page.ts`** — añadir imports, `providers: [ListSelectionService]`, iconos, `effect` que sincroniza la selección, `productsMenu`, y métodos de acción.

```ts
// imports nuevos
import { Router } from '@angular/router';
import { effect } from '@angular/core';
import { Archive, Copy, Download, RotateCw } from 'lucide-angular';
import { VX_CONTEXT_MENU, ListSelectionService, ListMenuConfig } from '../../../shared/components/context-menu';
import { DatasetExportService } from '../../../core/export/dataset-export';
import { forkJoin } from 'rxjs';

// en @Component: añadir ...VX_CONTEXT_MENU a imports, y providers: [ListSelectionService]

// en la clase:
readonly selection = inject(ListSelectionService) as ListSelectionService<Product>;
private readonly router = inject(Router);
private readonly datasetExport = inject(DatasetExportService);
protected readonly ArchiveIcon = Archive;
protected readonly CopyIcon = Copy;
protected readonly DownloadIcon = Download;
protected readonly RefreshIcon = RotateCw;

constructor() {
  effect(() => this.selection.setItems(this.filteredProducts(), (p) => p.id));
}

readonly productsMenu: ListMenuConfig<Product> = {
  resource: 'products',
  table: [{ id: 'crud', items: [
    { id: 'new', label: 'inventory.products.new_product', icon: PlusCircle, permission: 'products:create', chord: { mod: true, key: 'N' }, run: () => this.newProduct() },
    { id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.loadProducts() },
    { id: 'export', label: 'actions.export', icon: Download, run: () => this.datasetExport.export('products') },
  ]}],
  row: (ctx) => {
    if (ctx.selection.length > 1) {
      const n = ctx.selection.length;
      return [{ id: 'bulk', items: [
        { id: 'archive', label: () => ({ key: 'actions.archive_n', params: { n } }), icon: Archive, permission: 'products:edit', run: () => this.archiveMany(ctx.selection as Product[]) },
        { id: 'delete', label: () => ({ key: 'actions.delete_n', params: { n } }), icon: Trash2, danger: true, permission: 'products:delete', run: () => this.deleteMany(ctx.selection as Product[]) },
        { id: 'export', label: () => ({ key: 'actions.export_n', params: { n } }), icon: Download, run: () => this.datasetExport.export('products') },
      ]}];
    }
    const p = ctx.entity as Product;
    return [{ id: 'row', items: [
      { id: 'edit', label: 'inventory.products.edit', icon: Pencil, permission: 'products:edit', chord: { mod: true, key: 'E' }, run: () => this.editProduct(p) },
      { id: 'duplicate', label: 'actions.duplicate', icon: Copy, permission: 'products:create', run: () => this.duplicateProduct(p) },
      { id: 'archive', label: 'actions.archive', icon: Archive, permission: 'products:edit', visible: () => p.status === 'Active', run: () => this.archiveProduct(p) },
      { id: 'delete', label: 'inventory.products.delete', icon: Trash2, danger: true, permission: 'products:delete', run: () => this.deleteProduct(p) },
    ]}];
  },
};

protected newProduct(): void { void this.router.navigate(['/inventory/products/new']); }
protected editProduct(p: Product): void { void this.router.navigate(['/inventory/products', p.id, 'edit']); }

protected duplicateProduct(p: Product): void {
  const { id, organizationId, createdAt, updatedAt, ...rest } = p as any;
  this.inventoryService.createProduct({ ...rest, name: `${p.name} (copia)`, sku: p.sku ? `${p.sku}-COPY` : undefined } as any).subscribe({
    next: () => { this.notificationService.showSuccess('inventory.products.product_created'); this.loadProducts(); },
    error: (e) => this.notificationService.showHttpError(e, 'inventory.products.error_creating_product'),
  });
}

protected archiveProduct(p: Product): void {
  this.inventoryService.updateProduct(p.id, { status: 'Inactive' }).subscribe({
    next: () => { this.notificationService.showSuccess('inventory.products.product_deactivated'); this.loadProducts(); },
    error: (e) => this.notificationService.showHttpError(e, 'inventory.products.error_updating_product'),
  });
}

protected archiveMany(items: Product[]): void {
  forkJoin(items.map((p) => this.inventoryService.updateProduct(p.id, { status: 'Inactive' }))).subscribe({
    next: () => { this.notificationService.showSuccess('inventory.products.product_deactivated'); this.selection.clear(); this.loadProducts(); },
    error: (e) => this.notificationService.showHttpError(e, 'inventory.products.error_updating_product'),
  });
}

protected async deleteMany(items: Product[]): Promise<void> {
  const ok = await this.dialog.confirm({ title: 'dialog.delete_product.title', message: 'dialog.delete_product.message', variant: 'danger' });
  if (!ok) return;
  forkJoin(items.map((p) => this.inventoryService.deleteProduct(p.id))).subscribe({
    next: () => { this.notificationService.showSuccess('inventory.products.product_deleted'); this.selection.clear(); this.loadProducts(); },
    error: (e) => this.notificationService.showHttpError(e, 'inventory.products.error_deleting_product'),
  });
}
```

> Nota de implementación: confirmar la firma real de `DialogService.confirm(...)` y de `CreateProductDto`/`UpdateProductDto`; ajustar `duplicateProduct` a la DTO real (sin `any` si es posible). Si `dataset` de productos no es `'products'`, leer el nombre de `/datasets`.

- [ ] **Step 2: `products.page.html`** — poner `appTableMenu` + ref, columna de checkbox, `appRowMenu` + botón ⋮ en cada fila.

```html
<table [appTableMenu]="productsMenu" #tableMenu="appTableMenu" [appSort]="table.sort" class="data-table">
  <thead>
    <tr>
      <th class="select-column">
        <input type="checkbox" [checked]="selection.allSelected()" (change)="selection.toggleAll()"
          [attr.aria-label]="'actions.select_all' | translate" />
      </th>
      <!-- …cabeceras existentes… -->
      <th class="actions-column"></th>
    </tr>
  </thead>
  <tbody>
    @for (product of table.rows(); track product.id) {
      <tr appRowLink [appRowMenu]="product" #rowMenu="appRowMenu" [class.is-selected]="selection.isSelected(product.id)">
        <td class="select-column">
          <input type="checkbox" [checked]="selection.isSelected(product.id)"
            (click)="$event.stopPropagation()"
            (change)="selection.toggle(product.id)"
            [attr.aria-label]="'actions.row_actions' | translate" />
        </td>
        <!-- …celdas existentes… -->
        <td class="actions-column">
          <div class="action-buttons">
            <!-- …editar/eliminar existentes… -->
            <button type="button" class="icon-button" (click)="rowMenu.open($event)"
              [attr.aria-label]="'actions.row_actions' | translate" aria-haspopup="menu">
              <lucide-icon [img]="MoreIcon" size="18" aria-hidden="true"></lucide-icon>
            </button>
          </div>
        </td>
      </tr>
    }
  </tbody>
</table>
```

(Importar `EllipsisVertical as MoreVertical` y exponer `MoreIcon = EllipsisVertical`.)

- [ ] **Step 3: `products.page.scss`** — estilos mínimos:

```scss
.select-column { width: 2.5rem; text-align: center; }
tr.is-selected > td { background: var(--accent-surface); }
```

- [ ] **Step 4: Compilar + lint** `npx nx lint client-web` sobre los archivos tocados. **Commit.**

---

### Task 11: Verificación final

- [ ] **Step 1:** `npx jest context-menu --silent` → PASS
- [ ] **Step 2:** `npx jest overlay-styles --silent` → PASS (el panel no usa `:host` para su contenido)
- [ ] **Step 3:** `npx nx build client-web` → build correcto
- [ ] **Step 4:** `node tools/i18n/verify-catalogues.mjs` → verde
- [ ] **Step 5: Commit** final y resumen.

---

## Self-review

- **Cobertura del spec:** motor (T4/T5), integración por convención (T6/T7), selección múltiple (T2, T10), permisos/i18n/a11y (T5/T9/T7), demo inventario con ⋮ y checkboxes (T10), pruebas incl. gotcha de overlay (T11). ✓
- **Placeholders:** la única incógnita señalada es la firma real de `DialogService.confirm` y de las DTO de producto / nombre de dataset — se resuelven leyendo el código en T10, no son placeholders del diseño.
- **Consistencia de tipos:** `MenuContext`/`MenuItem`/`MenuSection`/`ListMenuConfig` se usan igual en service, host y directivas; `ListSelectionService` opcional en ambas directivas; `openAt(x,y)`/`open(coords)` coherentes.
