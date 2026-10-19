# Sistema de menús contextuales (clic derecho) — Diseño

**Fecha:** 2026-10-19
**Estado:** Diseño aprobado — pendiente de plan de implementación
**Ámbito:** `apps/core/client-web` (Angular 20, standalone, signals, OnPush)

## 1. Problema y objetivo

Hoy cada acción sobre un registro vive escondida en botones de icono al final de la
fila (`Editar`/`Eliminar`) y en el botón «Nuevo» de la cabecera. No hay un gesto
rápido, uniforme y descubrible para «¿qué puedo hacer con esto?».

Queremos un **menú contextual al estilo del navegador (clic derecho)**, que aparezca
en la posición del cursor y cuyo contenido **dependa de dónde se hizo clic**: una fila
de producto ofrece Editar / Duplicar / Archivar / Eliminar; el área vacía de la tabla
ofrece Nuevo / Refrescar / Exportar; y, con varias filas seleccionadas,
acciones **en lote** («Eliminar 5»).

El objetivo no es solo Inventario: es un **framework reutilizable** que, cableado una
sola vez en la primitiva de lista compartida, cualquier tabla del producto pueda
heredar con ~2 líneas. Debe ser robusto, accesible, escalable y respetar permisos e
i18n como el resto de la casa.

## 2. Decisiones ya tomadas (con el usuario)

| Decisión | Elección |
|---|---|
| Disparador | **Clic derecho** (como el navegador). El clic izquierdo no cambia: sigue seleccionando/navegando. También abre con tecla Menú / `Shift+F10` y con un botón `⋮`. |
| Alcance de esta entrega | **Motor + integración en la primitiva de lista compartida**, demostrado en Inventario / Productos. El resto de tablas se suma en una ola mecánica posterior. |
| Selección múltiple | **Sí, consciente de selección múltiple**: acciones en lote cuando hay varias filas marcadas. Se añade UI de checkboxes a Inventario en esta entrega como vitrina. |
| Botón `⋮` para táctil/a11y | **Incluido** en esta entrega. |

## 3. Enfoque técnico

### 3.1 Motor sobre `@angular/cdk/menu`

`@angular/cdk/menu` ya está instalado (parte de `@angular/cdk ~20.2`). Se usa
`CdkContextMenuTrigger` + `CdkMenu`/`CdkMenuItem`, que resuelven de fábrica:

- disparo con `contextmenu` en la posición del cursor (cubre clic derecho **y** tecla Menú);
- navegación por teclado: flechas, type-ahead, `Home`/`End`, `Esc`;
- roles ARIA (`menu`, `menuitem`, `menuitemcheckbox`, `separator`), foco gestionado y atrapado;
- submenús, cierre al hacer clic fuera, soporte RTL.

Sobre eso construimos un componente **data-driven** que renderiza un descriptor
declarativo (no un template estático por tabla).

Descartado: overlay a mano (reimplementar teclado/ARIA = más código y bugs) y librería
externa (contra la política conservadora de dependencias del repo, chokepoint Angular 20).

### 3.2 Integración por convención sobre configuración

La primitiva compartida es `vx-list-shell` (gesto LIST). El `<table>` se escribe por
página, pero las filas comparten el patrón `<tr appRowLink>` + `a.table-link` +
botones con `*appHasPermission`.

- `vx-list-shell` gana un input opcional `[menu]` con la config declarativa de la lista.
- Una directiva `[appRowMenu]="entidad"` en el `<tr>` (compañera de `appRowLink`) ata
  la entidad de esa fila y construye el contexto al abrir.
- El trigger interno (fila) gana sobre el externo (tabla), igual que en el navegador.

Descartado: servicio global que lee `data-ctx` del DOM (stringly-typed, sin tipos,
difícil de testear).

## 4. Arquitectura

```
apps/core/client-web/src/app/shared/components/context-menu/
  index.ts                         → barril; se agrega a VX_UI
  context-menu.types.ts            → MenuItem, MenuSection, MenuContext, ListMenuConfig
  context-menu.component.ts        → vx-context-menu (motor: cdkMenu data-driven)
  context-menu.component.scss
  context-menu-item.component.ts   → una fila: icono · label · atajo (vx-kbd) · check · flecha de submenú
  context-menu-item.component.scss
  context-menu.directive.ts        → [appContextMenu]="descriptor" (envuelve cdkContextMenuTriggerFor + botón ⋮)
  row-menu.directive.ts            → [appRowMenu]="entidad" (contexto de fila + selección)
  context-menu.service.ts          → apertura programática y utilidades
  list-selection.service.ts        → selección múltiple por lista (scoped al list-shell)
```

El motor es **genérico**: los contextos `kind: 'row' | 'table' | 'cell' | 'empty'`
permiten usarlo más allá de tablas (barra lateral, celdas, texto) en el futuro.

## 5. Modelo de datos (tipado, declarativo)

```ts
export type MenuContextKind = 'row' | 'table' | 'cell' | 'empty';

export interface MenuContext<E = unknown> {
  kind: MenuContextKind;
  entity?: E;            // la fila bajo el cursor, si aplica
  selection: E[];        // nunca vacío cuando hay fila: por defecto [entity]
  event: MouseEvent;     // para posición / modificadores
}

export interface MenuItem<C extends MenuContext = MenuContext> {
  id: string;
  /** Clave i18n lower_snake, o función para labels dinámicos (p.ej. "Eliminar {n}"). */
  label: string | ((ctx: C) => { key: string; params?: Record<string, unknown> });
  icon?: LucideIconData;
  chord?: KeyChord;                       // se dibuja con vx-kbd
  permission?: string | string[];         // oculto si AuthService.hasPermissions() es false
  danger?: boolean;                        // estilo destructivo
  checked?: (ctx: C) => boolean;           // ítem tipo checkbox (menuitemcheckbox)
  visible?: (ctx: C) => boolean;
  disabled?: (ctx: C) => boolean;
  submenu?: MenuItem<C>[];
  run?: (ctx: C) => void | Promise<void>;
}

export interface MenuSection<C extends MenuContext = MenuContext> {
  id: string;
  items: MenuItem<C>[];                     // separador visual entre secciones
}

/** Config declarativa que la página pasa a <vx-list-shell [menu]>. */
export interface ListMenuConfig<E = unknown> {
  resource: string;                         // p.ej. 'products' (para labels/telemetría)
  permissionPrefix?: string;                // p.ej. 'products' → 'products:edit'
  /** Acciones del área de tabla / vacío (Nuevo, Refrescar, Exportar, Columnas). */
  table?: MenuSection<MenuContext<never>>[];
  /** Fábrica de acciones de fila; recibe el contexto (entidad + selección). */
  row?: (ctx: MenuContext<E>) => MenuSection<MenuContext<E>>[];
}
```

### Reglas de resolución
- **Visibilidad:** un ítem se omite si `visible()` es false **o** si `permission` no se
  cumple (`AuthService.hasPermissions`). Secciones que quedan vacías no pintan separador.
- **Selección:** `selection` nunca es vacío cuando hay fila (`[entity]` por defecto). Si
  `selection.length > 1`, la fábrica de fila puede devolver acciones en lote con labels
  pluralizados (`context_menu.delete_n` con `{ n }`).
- **Async y errores:** `run` puede ser `Promise`. El menú se cierra al activar; la acción
  es responsable de su confirmación (reusar `confirmation-modal` para destructivas) y de
  su feedback (toasts `VX_FEEDBACK`). Un fallo muestra toast de error, no rompe el menú.

## 6. Motor `vx-context-menu`

- `ng-template` con `<div cdkMenu>` y `@for` sobre `sections()` → por cada ítem un
  `<app-context-menu-item>` dentro de `<button cdkMenuItem>`.
- Submenú: `cdkMenuItem` con `[cdkMenuTriggerFor]="subTpl"`.
- Deshabilitado: `[cdkMenuItemDisabled]`. Checkbox: `cdkMenuItemCheckbox` + `checked`.
- Expone un `TemplateRef` (o un API imperativo por el service) que el trigger usa.
- Estilo con **tokens** (`--accent-surface`, `--content-primary/secondary/disabled`,
  `--radius-sm`, `--space-2`, `--text-sm`) para calcar el menú de pestañas de Dockview en
  ambos temas. El ítem reutiliza la estructura visual de `TabContextMenuItemComponent`
  (check a la izquierda, label, atajo a la derecha con `vx-kbd`).

**Gotcha de overlay (conocido en el repo):** el panel del menú se monta en el overlay,
fuera del `:host`. Por eso sus estilos se escriben apuntando al panel directamente (no
`:host ::ng-deep`). Se añade un spec que lo verifica, al estilo de `overlay-styles.spec.ts`.

## 7. Directivas de integración

### `[appContextMenu]="descriptor"`
Envuelve `cdkContextMenuTriggerFor` apuntando al template del motor, pasa el contexto, y
—si se activa— añade/gestiona el botón `⋮` para táctil/teclado (`Shift+F10`).

### `[appRowMenu]="entidad"`
En el `<tr>`, compañera de `appRowLink`. Al `contextmenu`:
1. construye `MenuContext` con `entity` = la entidad y `selection` = selección actual (o `[entity]`);
2. resuelve las secciones (fila + tabla heredada) desde el `ListMenuConfig` del shell;
3. abre el menú en la posición del cursor.
Si la fila no está en la selección vigente, al abrir se selecciona solo esa (como un navegador/Finder).

## 8. Selección múltiple

`ListSelectionService` (provisto por `vx-list-shell`, scoped por lista):
- estado por `id`, API `toggle(id)`, `selectRange(fromId,toId)`, `clear()`, `isSelected(id)`, `count()`;
- soporta `Shift`+clic (rango) y `⌘/Ctrl`+clic (toggle);
- la UI de checkbox (cabecera «seleccionar todo» + por fila) se añade a Inventario como vitrina.

## 9. a11y, teclado e i18n

- **Disparo:** clic derecho, tecla Menú / `Shift+F10`, y botón `⋮`. Clic izquierdo intacto.
- **Teclado:** navegación completa vía CDK menu; `Esc` cierra y devuelve foco al origen.
- **ARIA:** roles de CDK; el botón `⋮` lleva `aria-haspopup="menu"` y label traducido.
- **i18n:** claves `lower_snake` por catálogo (fuente en `libs/shared/locales/src/base`,
  `build-catalogues` + `verify-catalogues`). Reutiliza las existentes
  (`inventory.products.edit`, `.delete`, `.new_product`) y añade una familia genérica:
  `context_menu.refresh`, `context_menu.export`,
  `context_menu.duplicate`, `context_menu.archive`, `context_menu.delete_n` (con `{ n }`),
  `context_menu.selected_n`. Las familias pluralizadas van por `composed-keys.json`.

## 10. Permisos

Cada ítem declara `permission`; el motor filtra con `AuthService.hasPermissions()` —
mismo criterio que `*appHasPermission`. Ejemplos: Editar → `products:edit`, Eliminar →
`products:delete`, Nuevo → `products:create`. Sin permiso, el ítem no aparece.

## 11. Demo en Inventario / Productos

`products.page` como vitrina:
- **Menú de fila:** Editar (`⌘E`), Duplicar, Archivar, Eliminar (`⌦`, destructiva con confirmación).
- **Menú de tabla/vacío:** Nuevo producto (`⌘N`), Refrescar, Exportar (reusa `core/export`).
  _(Una acción «Columnas» queda fuera de esta entrega: no existe aún un sistema de
  visibilidad de columnas; el menú es extensible para añadirla cuando lo haya.)_
- **Selección múltiple:** checkbox por fila + «seleccionar todo» en la cabecera; con >1
  marcada → «Archivar N», «Eliminar N», «Exportar N».
- Reutiliza `confirmation-modal` (destructivas) y `VX_FEEDBACK` (toasts de resultado/error).

## 12. Pruebas

- **Motor:** render de secciones/ítems; filtrado por `visible`/`permission`; labels según
  selección; estado checkbox; submenús.
- **Directivas:** `contextmenu` abre con el contexto correcto; precedencia fila vs tabla;
  fila fuera de selección → selecciona solo esa.
- **Selección:** toggle, rango con Shift, select-all, clear.
- **Estilos de overlay:** spec que verifica que el panel se estiliza directamente (gotcha).
- **i18n:** conformidad de catálogos (sin huérfanos/stale/parity).
- **Permisos:** ítems ocultos sin permiso.

## 13. Despliegue posterior (fuera de esta entrega)

El motor + la primitiva ya son universales. Las ~93 tablas restantes se suman en una ola
mecánica (`[menu]` en el `vx-list-shell` + `[appRowMenu]` en el `<tr>` + fábrica de
acciones por página). Se mantiene fuera de este spec para que la entrega sea enfocada y
verificable.

## 14. Criterios de aceptación

1. Clic derecho sobre una fila de Productos abre un menú en el cursor con acciones de fila
   filtradas por permiso; el clic izquierdo sigue navegando.
2. Clic derecho sobre el área de tabla/vacío abre el menú de tabla (Nuevo/Refrescar/Exportar).
3. Con varias filas seleccionadas, el menú ofrece acciones en lote con conteo correcto.
4. Teclado: `Shift+F10`/tecla Menú abre; flechas/`Esc` navegan/cierran; foco vuelve al origen.
5. Botón `⋮` abre el mismo menú (táctil/a11y).
6. Build del cliente, `verify-catalogues` y specs en verde.
