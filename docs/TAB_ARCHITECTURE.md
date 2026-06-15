# Arquitectura de Pestañas, Rutas y Workspace — Virtex ERP

> **Estado:** Diseño normativo (v1.0 · 2026-06-14)
> **Stack real:** Angular (standalone + Signals) · Dockview (`dockview-angular`) · NestJS · Nx monorepo
> **Alcance:** `apps/core/client-web` — capa `core/tabs/*`, `layout/main`, `layout/sidebar`, `app.routes.ts`
> **Audiencia:** equipo de frontend. Este documento es la fuente de verdad para *cómo deben comportarse* las pestañas y rutas. Donde el código actual difiera, manda este documento (ver §12 Brechas y plan de migración).

---

## 1. Filosofía y principio rector

Virtex es un ERP de tipo **escritorio dentro del navegador**: el usuario abre módulos y registros como “ventanas” y trabaja en varios a la vez, conservando el contexto al alternar entre ellos. No navega como en un sitio web tradicional.

> **Principio único e inviolable:**
> La **URL** refleja *dónde estás* (la pestaña activa).
> El **workspace** (estado de sesión) refleja *qué tienes abierto* (todas las pestañas).

Todo lo demás en este documento se deriva de ese principio. Si una decisión de diseño lo contradice, la decisión está mal.

### Reglas de oro de la sincronización

```
Abrir/activar una pestaña  →  se actualiza la URL a la ruta de esa pestaña
Navegar por URL (link/F5)  →  se abre o se enfoca la pestaña correspondiente
```

Solo la pestaña **activa** vive en la URL. El conjunto completo vive en el `WorkspaceStore` y se persiste (§8).

---

## 2. Esquema de URL (normativo)

El proyecto usa **URLs limpias en la raíz**, sin prefijo `/app`:

```
/dashboard
/invoices
/invoices/new
/invoices/123
/masters/customers
/accounting/journal-entries
```

Reglas:

| Regla | Detalle |
|---|---|
| Sin prefijo `/app` | Las rutas autenticadas cuelgan de `MainLayout` en la raíz (ver `app.routes.ts`). **No** introducir `/app/...`. |
| Rutas públicas con idioma | `/:lang/auth/login`, `/:lang/:country/auth/...` — fuera del workspace, sin pestañas. |
| Settings es modal, no pestaña | `/...#settings/<section>` se intercepta y abre la modal (`settingsModalRedirectGuard`). **Nunca** genera una pestaña. |
| Query/fragment | `?` = filtros/estado de vista (puede ir en la pestaña). `#settings/*` reservado a la modal. |

> ⚠️ **Bug detectado:** `main.layout.ts → navigateToSearch()` navega a `/app/global-search`, pero la ruta real es `/global-search`. Corregir (ver §12).

### ¿Por qué no codificar todas las pestañas en la URL?

- URLs ilegibles con 10+ pestañas.
- Los *named outlets* de Angular (`(outlet:path)`) no escalan en un ERP.
- El refresco se controla restaurando el workspace desde almacenamiento (§8), no desde la URL.

---

## 3. Taxonomía de pestañas

Mapeada a los módulos reales del ERP (sales, invoices, inventory, manufacturing, wms, projects, hcm, procurement, accounting, accounts-payable, customer-receipts, masters, documents, reports, datasheets…).

| Tipo (`TabType`) | Ejemplos reales | Instancias | Cerrable | Notas |
|---|---|---|---|---|
| `PINNED` | Dashboard | 1, fija | No | Siempre presente; ancla del workspace |
| `MODULE_LIST` | Facturas, Ventas, Inventario, Clientes, Proveedores | 1 por módulo (singleton) | Sí | `entityKey = module:<modulo>` |
| `RECORD` | Factura #123, Cliente #88, Asiento #45 | N (1 por id) | Sí | `entityKey = <entidad>:<id>` evita duplicados |
| `WIZARD` | Nueva Factura, Nueva Venta, Nueva Cotización | N, siempre nueva | Sí (con confirmación si dirty) | `entityKey = <entidad>:new:<uuid>` |
| `REPORT` | Reporte de ventas, Datasheets | N | Sí | Parámetros en `queryParams` |
| `UTILITY` | Mi trabajo, Aprobaciones, Notificaciones, Búsqueda global, ETL | 1 (singleton) | Sí | `entityKey = util:<nombre>` |

> El enum `TabType` ya existe en `core/tabs/tab.model.ts` con estos valores. Mantenerlos.

---

## 4. Modelo de una pestaña (`TabModel`)

Base ya implementada en `tab.model.ts`. Se conserva y se **extiende** con los campos marcados ⊕ (ver §12):

```typescript
interface TabModel {
  // Identidad
  id: string;                    // UUID por instancia: "tab_a8f2..."
  type: TabType;

  // Presentación
  title: string;                 // "Factura #00123"
  icon: string;                  // nombre de icono lucide ("Receipt")
  badge?: number;

  // Ruta (fuente para reabrir/rehidratar)
  route: string;                 // "/invoices/123"
  routeParams: Record<string, string>;
  queryParams?: Record<string, string>;

  // Estado
  isDirty: boolean;
  isLoading: boolean;
  isCloseable: boolean;
  isPinned: boolean;

  // Deduplicación de instancias
  entityKey?: string;            // "invoice:123" | "module:invoices"

  // Ciclo de vida
  createdAt: Date;
  lastActivatedAt: Date;
  scrollPosition?: number;       // ⊕ restaurar scroll
  viewState?: unknown;           // ⊕ estado serializable de la vista (filtros, paso de wizard…)

  // ⊕ Orden y fijado explícito para drag & drop / pin
  order?: number;
}
```

**Convención de iconos:** strings de `lucide-angular` (`Receipt`, `FileText`, `Users`…), coherente con `sidebar-menu.ts` y `tab-registry.service.ts`. No usar Material Icons.

**Convención de `entityKey`** (clave de deduplicación):

```
module:<modulo>            módulo singleton     module:invoices
<entidad>:<id>             registro             invoice:123 · customer:88
<entidad>:new:<uuid>       wizard (siempre nueva) invoice:new:7f3a...
util:<nombre>              utilidad singleton   util:approvals
report:<slug>[:hash]       reporte              report:sales:q3
```

> El wizard **debe** usar un UUID, no `Date.now()` (dos clics en el mismo milisegundo colisionan). Ver §12.

---

## 5. Registro de pestañas (`TabRegistry`) — diseño escalable

### 5.1 Problema del registro actual

`tab-registry.service.ts` importa **estáticamente** cada página (`DashboardPage`, `InvoicesListPage`, …) en un array central. Esto:

- **Rompe el lazy-loading**: `app.routes.ts` carga los módulos con `loadChildren`/`loadComponent`, pero el registro central vuelve a importarlos de forma *eager* → todo el ERP entra en el bundle inicial.
- **No escala**: cada módulo nuevo obliga a tocar un archivo central y acoplar `core/` a `features/`.
- **Está incompleto**: el sidebar enlaza a decenas de rutas (`/masters/*`, `/etl/*`, `/accounting/*`, `/documents`, etc.) que **no** tienen definición → `openTab()` emite `console.warn` y no abre nada.

### 5.2 Diseño objetivo: registro declarativo + lazy por feature

Cada feature **declara** sus definiciones de pestaña junto a sus rutas, y aporta un **loader perezoso** del componente. El `TabRegistry` solo agrega definiciones; nunca importa páginas.

```typescript
interface TabDefinition {
  pattern: string;                 // '/invoices/:id'
  tabType: TabType;
  // Carga perezosa — alineada con loadComponent de las rutas
  load: () => Promise<Type<unknown>>;
  title?: string;
  icon?: string;
  isCloseable?: boolean;
  permissions?: string[];          // espejo del permissionsGuard de la ruta
  entityKeyFn?: (params: Record<string,string>, q?: Record<string,string>) => string;
  titleFn?: (params: Record<string,string>, data?: unknown) => string;
}
```

Ejemplo (declarado en `features/invoices/invoices.tabs.ts`):

```typescript
export const INVOICE_TABS: TabDefinition[] = [
  {
    pattern: '/invoices',
    tabType: TabType.MODULE_LIST,
    entityKeyFn: () => 'module:invoices',
    title: 'Facturas', icon: 'Receipt',
    permissions: ['invoices:view'],
    load: () => import('./list/list.page').then(m => m.InvoicesListPage),
  },
  {
    pattern: '/invoices/new',
    tabType: TabType.WIZARD,
    entityKeyFn: () => `invoice:new:${crypto.randomUUID()}`,
    title: 'Nueva Factura', icon: 'PlusCircle',
    load: () => import('./new/new.page').then(m => m.NewInvoicePage),
  },
  {
    pattern: '/invoices/:id',
    tabType: TabType.RECORD,
    entityKeyFn: p => `invoice:${p['id']}`,
    titleFn: (p, d: any) => `Factura #${d?.number ?? p['id']}`,
    icon: 'FileText',
    load: () => import('./detail/detail.page').then(m => m.InvoiceDetailPage),
  },
];
```

Las definiciones se agregan en el arranque (`provideTabs(INVOICE_TABS, SALES_TABS, …)` o un `APP_INITIALIZER`/multi-provider), de modo que `core/` no dependa de `features/`.

### 5.3 Reglas de matching (deben corregirse)

El matcher actual compara por número de segmentos y literal/`:`. Reglas normativas:

1. **Especificidad primero:** una ruta literal gana a una paramétrica del mismo nivel. `/invoices/new` debe resolverse antes que `/invoices/:id`. Ordenar el registro por especificidad o desempatar explícitamente (literal > `:param`).
2. **Permisos:** antes de abrir, validar `permissions` contra el usuario (espejo de `permissionsGuard`). El backend sigue siendo la autoridad; esto es UX.
3. **Sin definición → no abrir y registrar telemetría**, no solo `console.warn`. Toda ruta del sidebar debe tener definición (§12, criterio de cobertura).

---

## 6. Arquitectura de servicios (capa `core/tabs`)

Servicios ya existentes, con responsabilidades normativas:

```
core/tabs/
├── tab-state.service.ts        WorkspaceStore: signals de tabs + activeTab; API de mutación
├── tab-registry.service.ts     ruta → definición (lazy); matching; permisos
├── tab-router.service.ts       puente Router ↔ Workspace (sync bidireccional)
├── tab-persistence.service.ts  sessionStorage (F5) + backend (cross-session)
├── tab-event-bus.service.ts    eventos entre pestañas (RECORD_SAVED, …)
└── components/
    ├── tab-container.component.ts  hospeda Dockview; mapea tabs ↔ paneles
    └── tab-wrapper.component.ts     monta el componente lazy vía ngComponentOutlet
```

### API objetivo de `TabStateService`

Ya implementado: `openTab`, `activateTab`, `closeTab`, `markDirty`, `updateTitle`, `getTabByEntityKey`, `setTabs`.
**A completar** (§12):

```typescript
markClean(id): void
closeOthers(id): void
closeAll(opts?: { keepPinned: boolean }): void
pinTab(id): void / unpinTab(id)
moveTab(from, to): void                 // drag & drop (Dockview ya reordena)
duplicateTab(id): void
updateViewState(id, state): void        // scroll, filtros, paso de wizard
setBadge(id, n): void
enforceMaxTabs(): void                  // §10 límite configurable
```

`closeTab` actual usa `confirm()`. **Debe** delegar en un servicio de diálogo (§7).

---

## 7. Ciclo de vida y manejo de cambios sin guardar

### 7.1 Estados de una pestaña

```
CREATED → LOADING → ACTIVE ⇄ INACTIVE
                       │
                  (edición) → DIRTY
                       │
                  (cerrar) → CONFIRM_CLOSE → SAVING → CLOSED
                                           └ DISCARD → CLOSED
```

- **OnPush** obligatorio en toda página-pestaña.
- Dockview **no destruye** el DOM de pestañas inactivas. Las páginas deben pausar/reanudar trabajo costoso (polling, websockets, timers) mediante hooks de activación/desactivación. Definir un contrato:

```typescript
interface TabAware {
  onTabActivated?(): void;     // reanudar subscripciones, refrescar si stale
  onTabDeactivated?(): void;   // pausar polling, persistir viewState
}
```

`TabContainerComponent` ya escucha `onDidActivePanelChange`; debe invocar estos hooks sobre el componente montado.

### 7.2 Flujo de cierre con `isDirty`

```
cerrar pestaña
   └ isDirty?
       ├ no  → cerrar
       └ sí  → diálogo  [Guardar] [Descartar] [Cancelar]
                  Guardar  → save() → markClean → cerrar
                  Descartar→ cerrar sin guardar
                  Cancelar → permanece
```

- Reemplazar `window.confirm` por un **servicio de diálogo** de la app (consistencia visual + i18n).
- **`beforeunload`**: si existe alguna pestaña `isDirty`, registrar `window.onbeforeunload` para advertir antes de cerrar/recargar la app.
- Indicador visual de dirty: punto `●` antepuesto al título (lo aplica la capa de presentación, no se muta `title`).

---

## 8. Persistencia del workspace (dos niveles)

| Escenario | Qué persiste | Dónde | Estado actual |
|---|---|---|---|
| **Refresco (F5)** | Lista de pestañas: títulos, rutas, params, dirty, scroll, paso de wizard | `sessionStorage` (`erp_tab_session`) | ✅ Implementado |
| **Nuevo login / otro equipo** | Misma lista, **sin datos temporales** (se recargan al activar) | **Backend** (workspace del usuario) | ⛔ Pendiente |

Reglas:

1. **Rehidratación sin datos**: al restaurar, las pestañas se crean en `isLoading` y resuelven su componente vía `load()` perezoso; los datos se piden a la API al activarse. Nunca se serializan datos de negocio en el almacenamiento.
2. **Backend** (recomendado para cross-session): `GET/PUT /api/me/workspace`. Guardar al cerrar sesión y *debounced* en cambios. Permite continuar en otro dispositivo.
3. **Preferencia de usuario**: “Recordar mis pestañas abiertas” (activada por defecto). Si se desactiva, solo persiste el Dashboard.
4. **Dashboard garantizado**: al restaurar, si el Dashboard (`PINNED`) no está, se crea; se **enfoca la última pestaña activa**, dejando el Dashboard al fondo.
5. **Dirty tras restaurar**: una pestaña marcada dirty se rehidrata con aviso “tenías cambios sin guardar” (los cambios en sí no se conservan salvo `viewState` serializable).
6. **Versionado del esquema**: incluir `schemaVersion` en el payload; descartar/migrar si no coincide para evitar romper sesiones antiguas.

> `TabPersistenceService` ya cubre el nivel `sessionStorage` y la rehidratación de fechas. Falta el nivel backend, el `schemaVersion` y guardar/restaurar `viewState`/`scrollPosition`.

---

## 9. Comunicación entre pestañas (`TabEventBus`)

Ya implementado (`tab-event-bus.service.ts`) con `RECORD_SAVED | RECORD_DELETED | RECORD_OPENED | FILTER_CHANGED`. Convenciones:

```typescript
// Al guardar un registro en una pestaña RECORD:
bus.emit({ type: TabEvent.RECORD_SAVED, entity: 'invoice', id: '123', payload: {…} });

// La lista (MODULE_LIST) escucha y refresca solo esa fila:
bus.on(TabEvent.RECORD_SAVED, 'invoice').subscribe(e => this.refreshRow(e.id!));
```

Reacciones obligatorias:

| Evento | Quién reacciona | Acción |
|---|---|---|
| `RECORD_SAVED` | listas del módulo | refrescar fila / invalidar caché |
| `RECORD_DELETED` | listas + `TabState` | refrescar lista **y cerrar** la pestaña `<entidad>:<id>` |
| `RECORD_OPENED` | tracking/recientes | registrar referencia |
| `FILTER_CHANGED` | vistas hermanas | sincronizar filtros si aplica |

El bus es **solo eventos efímeros entre pestañas**; no es un store ni reemplaza la capa de datos.

---

## 10. Reglas de negocio del workspace

| Regla | Comportamiento |
|---|---|
| **Dashboard fijo** | `PINNED`, `isCloseable:false`. Siempre disponible; se mueve pero no se cierra. |
| **Singleton por módulo** | `/invoices`, `/sales`, … una sola pestaña `MODULE_LIST` (dedupe por `module:<modulo>`). |
| **N por registro** | `/invoices/123` abre 1; un segundo intento **enfoca** la existente (dedupe por `<entidad>:<id>`). |
| **Wizard siempre nuevo** | `/invoices/new` crea pestaña nueva cada vez (UUID en `entityKey`). |
| **Máximo de pestañas** | Límite configurable (def. 20). Al exceder, cerrar la **más antigua no-dirty y no-pinned**; si todas son dirty, bloquear y avisar. |
| **Dirty blocker** | `beforeunload` activo si hay pestañas dirty. |
| **Cambio de empresa/tenant** | Al cambiar de compañía (`CompanySwitcher`): cerrar **todas** las pestañas, limpiar workspace y abrir Dashboard. Los datos pertenecen a otro tenant. |
| **Permisos** | No abrir pestañas de módulos sin permiso (espejo de `permissionsGuard`). |

---

## 11. Integración con Dockview y layout

Layout objetivo (ya reflejado en `main.layout` + `sidebar`):

```
┌───────────────────────────────────────────────────────────────────┐
│ TOPBAR: Logo · Buscador global · Crear (+) · Notificaciones · Perfil│
├──────────┬────────────────────────────────────────────────────────┤
│ SIDEBAR  │ [Dashboard ×][Facturas ×][Cliente #88 ●]                │
│ (fijo)   ├────────────────────────────────────────────────────────┤
│ Grupos:  │                                                        │
│ General  │              CONTENIDO DOCKVIEW                         │
│ Maestros │     (panel principal + split maestro/detalle opcional) │
│ Ventas…  │                                                        │
└──────────┴────────────────────────────────────────────────────────┘
```

- **Sidebar = navegación de módulos** (fijo, agrupado, `SIDEBAR_MENU`). Es el ancla del modelo mental; no se elimina.
- **Topbar = acciones globales** (búsqueda, crear, notificaciones, perfil, settings-modal).
- **Tabs + Dockview = área de trabajo**.
- **Split maestro/detalle** (opcional, fase 2): una lista puede abrir el detalle en un panel a la derecha (`?detail=<id>`) y promoverlo a pestaña completa (`/invoices/123`). Mantener la URL coherente con la pestaña activa.

`TabContainerComponent` ya: crea/elimina/reordena paneles según el signal `tabs`, sincroniza panel activo ↔ `activeTabId`, y cierra la pestaña al cerrar el panel. `TabWrapperComponent` monta el componente vía `ngComponentOutlet`. El diseño objetivo cambia `params.componentType` (clase eager) por el `load()` perezoso de §5.

---

## 12. Brechas actuales y plan de migración

Diferencias entre el código actual y este diseño, priorizadas:

### P0 — Correctitud (rompen funcionalidad hoy)
1. **Rutas del sidebar sin definición de pestaña.** El registro solo cubre ~10 rutas; el sidebar enlaza decenas (`/masters/*`, `/etl/*`, `/accounting/*`, `/documents`, `/reports`, etc.). Resultado: clics que no abren nada. → Cobertura total de definiciones (§5).
2. **`navigateToSearch()` apunta a `/app/global-search`** inexistente. → Cambiar a `/global-search` (§2).
3. **Matching `/invoices/new` vs `/invoices/:id`.** Garantizar especificidad literal > param (§5.3).
4. **`entityKey` de wizard usa `Date.now()`.** → `crypto.randomUUID()` (§4).

### P1 — Escalabilidad / arquitectura
5. **Registro eager rompe lazy-loading.** Migrar a definiciones declarativas por feature con `load()` perezoso; `core/` deja de importar `features/` (§5.2).
6. **Persistencia solo en sessionStorage.** Añadir nivel backend (`/api/me/workspace`), `schemaVersion`, y persistir `viewState`/`scrollPosition` (§8).
7. **`closeTab` usa `confirm()`.** Reemplazar por servicio de diálogo + `beforeunload` global (§7.2).

### P2 — Completitud de funciones
8. **Faltan acciones de workspace:** `markClean`, `closeOthers`, `closeAll`, `pin/unpin`, `moveTab`, `duplicateTab`, `enforceMaxTabs` (§6).
9. **Hooks de activación/desactivación** (`TabAware`) para pausar polling/websockets en pestañas inactivas (§7.1).
10. **Reset por cambio de tenant** en `CompanySwitcher` (§10).
11. **Permisos al abrir pestaña**, espejo de `permissionsGuard` (§5.3).

### Criterio de aceptación (cobertura)
> Para cada `path` de `SIDEBAR_MENU` y cada ruta navegable de `app.routes.ts` (excepto `settings/*`, públicas y de pago) **debe existir** una `TabDefinition`. Un test puede recorrer ambos y fallar si hay rutas huérfanas.

---

## 13. Casos de uso de referencia

**Abrir factura desde lista** → doble clic fila `423` → `openTab('/invoices/423')` → dedupe `invoice:423` (no existe) → pestaña “Factura #00423” → URL `/invoices/423` → `GET /api/invoices/423`. Segundo clic: enfoca la existente.

**Editar con cambios sin guardar** → la página llama `markDirty(id)` → título muestra `●` → al cerrar, diálogo Guardar/Descartar/Cancelar.

**Nueva venta (wizard)** → `/sales/new` → `entityKey sale:new:<uuid>` → pasos en `viewState`; al cambiar de pestaña pausa, al volver reanuda → al confirmar: `POST /api/sales` → cierra wizard, abre `RECORD` “Venta #789”, emite `RECORD_SAVED`.

**Refresco (F5)** → restaura N pestañas desde `sessionStorage` sin datos (`isLoading`), enfoca la última activa, recarga al activar; Dashboard garantizado.

**Notificación (WebSocket)** → clic en “Pedido #512 aprobado” → `openTab('/orders/512')` → enfoca o crea; *highlight* temporal de la pestaña.

**Cambio de empresa** → `CompanySwitcher` → cierra todo, limpia workspace, abre Dashboard del nuevo tenant.

---

## 14. Anatomía de una vista `MODULE_LIST` (ej. Facturas)

Componente singleton `InvoicesListPage`, dividido para reutilización:

| Componente | Rol | Reutilizable |
|---|---|---|
| `InvoicesListPage` | Contenedor: orquesta datos paginados, filtros, selección; escucha `TabEventBus` | No |
| `InvoiceFilterBar` | Búsqueda + filtros (fecha, estado, importe); vistas guardadas | Sí (patrón genérico) |
| `InvoiceTable` | Tabla con columnas configurables, orden, selección múltiple; doble clic → detalle | Sí (tabla genérica) |
| `InvoiceSummary` | Totales y acciones masivas (panel inferior opcional) | Sí |
| `InvoiceDetailPage` | Detalle; **el mismo** componente como pestaña `RECORD` o como panel split | — |
| `NewInvoicePage` | Wizard de creación; abre en pestaña aparte (no pierde la lista) | No |

Flujo: abrir “Facturas” (singleton) → tabla paginada → filtrar → doble clic → detalle (split o pestaña según preferencia) → guardar emite `RECORD_SAVED` → la lista refresca esa fila → cerrar detalle deja la lista intacta.

---

*Virtex ERP — Tab & Workspace Architecture · v1.0 · Angular (Signals) · Dockview · NestJS · Nx*
