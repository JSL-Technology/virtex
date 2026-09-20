# Componentización del cliente web — qué debería ser compartido y no lo es

**Alcance:** `apps/core/client-web/src/app` — 214 componentes, 173 plantillas.
**Fecha:** 2026-09-19.
**Método:** conteo sobre el árbol, no impresión. Cada cifra de este documento se
reproduce con el comando que la acompaña, y cada afirmación de «esto se repite»
cita archivo y línea.

---

## Lo que ya existe, y por qué importa para lo que sigue

Este repositorio **no** parte de cero, y eso cambia las conclusiones:

- **`assets/styles/design-system/`** — tokens semánticos de color (claro y
  oscuro), escala tipográfica, retícula de 4 px, radios, densidad, movimiento y
  una escala de apilamiento con nombre. `npm run lint:design-system` rechaza
  cualquier color literal y cualquier `var(--x)` inexistente, así que la capa de
  tokens está **gobernada de verdad**, no solo documentada.
- **`_mixins.scss`** — 40 mixins de patrón (`button-primary`, `input-base`,
  `badge`, `data-table`, `empty-state`, `modal-panel`, `skeleton`…).
- **Cuatro armazones de gesto** (`vx-list-shell`, `vx-draft-shell`,
  `vx-document-shell`, `vx-inbox-shell`), con una prueba
  (`gestures/gesture-conformance.spec.ts`) que **falla nombrando el archivo** si
  una pantalla declara su gesto y se dibuja el encabezado por su cuenta.
- **`libs/shared/ui-i18n`** — pipes de formato (`vxMoney`, `vxNumber`, `vxDate`,
  `vxPercent`) sensibles a la configuración regional del inquilino.
- **`libs/shared/ui-a11y`** — `aria-invalid` automático, con verificador propio.

La consecuencia es que **el problema de este frontend ya no es la falta de
sistema: es que el sistema existe y la mitad del producto no lo usa.** Varias de
las piezas de la lista de abajo ya están construidas como mixin y tienen cero
consumidores. Eso no se arregla escribiendo más mixins; se arregla convirtiendo
el patrón en un **componente**, que es una cosa que se importa y no una que hay
que acordarse de invocar.

> Eso es exactamente lo que hizo la Parte 1 con el selector de entidades:
> `shared/components/select/` (`vx-select`), ya en uso en
> `features/invoices/new/new.page.html:72`.

---

## Prioridad 1 — Selector de entidad (`vx-select`) · **migrado**

**Componente**: `apps/core/client-web/src/app/shared/components/select/`.
**Estado**: los trece controles del inventario están migrados.

| Evidencia | Cifra |
|---|---|
| `<select>` nativos en plantillas (al levantar la auditoría) | **102 en 45 archivos** |
| de ellos, listas de entidad **sin cota** | 13 controles en 12 archivos |
| páginas que descargaban el catálogo entero para rellenarlos | 7 |
| páginas que lo siguen descargando | **0** |

```
grep -rn "<select" --include=*.html apps/core/client-web/src/app | wc -l
```

Los que no escalaban, con la línea de la plantilla, la del fetch que la
alimentaba, y el modo en el que quedaron:

| Control | Plantilla | Carga completa que tenía | Modo |
|---|---|---|---|
| `customerId` | `features/customer-receipts/form/form.page.html:18` | `form.page.ts:114` `getCustomers()` | servidor |
| `customerId` | `features/invoices/new/new.page.html:90` | `new.page.ts` `getCustomers()` | servidor + alta en línea |
| `supplierId` | `features/purchasing/orders/form/form.page.html:36` | `form.page.ts:111` `getSuppliers()` | servidor |
| `productId` | `features/purchasing/orders/form/form.page.html:88` | `form.page.ts:115` `getProducts()` | servidor |
| `productId` | `features/purchasing/requisitions/form/form.page.html:59` | `form.page.ts:89` `getProducts()` | servidor |
| `productId` | `features/masters/price-lists/price-lists-form/price-list-form.page.html:71` | `price-list-form.page.ts:79` `getProducts()` | servidor |
| `productId` | `features/invoices/new/new.page.html:148` | `new.page.ts` `getProducts()` | servidor |
| `vendorId` | `features/accounts-payable/form/form.page.html:25` | `form.page.ts:241` `getSuppliers()` | servidor |
| `accountId` | `features/accounting/journal-entry-form/journal-entry-form.page.html:94` | `journal-entry-form.page.ts:195` `getAccounts()` | servidor |
| `accountId` | `features/accounting/audit-adjustments/audit-adjustment-form/audit-adjustment-form.page.html:64` | `audit-adjustment-form.page.ts:113` `getAccounts()` | servidor |
| `expenseAccountId` | `features/accounts-payable/form/form.page.html:117` | `form.page.ts:278` `getAccounts()` | servidor + filtro de producto |
| `parentId` | `features/accounting/account-form/account-form.page.html:72` | catálogo completo de cuentas | cliente (lista cerrada) |
| `bankAccountId` ×3 | `features/accounts-payable/payment/payment.page.html:31`, `features/customer-receipts/form/form.page.html:41`, `features/accounting/reconciliation/statement-import/statement-import.page.html:24` | — | cliente (lista cerrada) |
| `roleId` | `features/settings/user-management/user-management.page.html:158` | — | cliente (lista cerrada) |

**Por qué era la primera.** No es una diferencia estética: era la única de la
lista que se rompe **con los datos del cliente**, no con el código. Un plan
contable real ronda las mil cuentas y un catálogo de productos las decenas de
miles; cada uno de esos formularios los metía enteros en el DOM como `<option>`,
sin buscador, y sin forma de dar de alta el que falta sin abandonar el
formulario a medio escribir.

**Trabajo de servidor que arrastró.** Cada entidad necesitaba su
`?search=&limit=`. Los cuatro están hechos, compartiendo el escapado de
comodines y el tope de `apps/backend/api/src/app/common/database/search-term.ts`:

| Ruta | Controlador | Columnas que busca |
|---|---|---|
| `GET /customers` | `customers/customers.controller.ts` | `name`, `taxId` |
| `GET /inventory/products` | `inventory/inventory.controller.ts` | `name`, `sku` |
| `GET /suppliers` | `suppliers/suppliers.controller.ts` | `name`, `taxId` |
| `GET /chart-of-accounts` | `chart-of-accounts/chart-of-accounts.controller.ts` | `code`, `name::text` |

Los dos parámetros son opcionales y omitirlos reproduce exactamente lo que la
ruta hacía antes, que es lo que dejaba migrar página por página sin romper a las
que todavía no lo estaban. Cubierto por
`inventory/inventory-search.spec.ts`, `suppliers/suppliers-search.spec.ts`,
`chart-of-accounts/chart-of-accounts-search.spec.ts` y
`customers/customers-search.spec.ts`.

**Dos `<select>` de entidad que se quedan como están, a propósito.** El de
empleado de una nómina (`features/payroll/runs/detail/detail.page.html:106`) y
el de cuenta bancaria de la conciliación
(`features/accounting/reconciliation/account-reconciliation/account-reconciliation.page.html:48`)
no están dentro de un formulario reactivo —van con `[value]` y `(change)`— y las
dos listas son cerradas y cortas. No son el problema que esta migración
ataca, y meterlos obligaría a arrastrar `FormsModule` a esas dos páginas para no
ganar nada.

---

## Prioridad 2 — Insignia de estado (`vx-badge`) · **el peor caso de divergencia**

| Evidencia | Cifra |
|---|---|
| usos de `.status-badge` | **24 en 23 archivos** |
| definiciones CSS rivales de `.status-badge` | **10**, más una base en `assets/styles/_list-page.scss:29` |
| otros nombres para lo mismo | 7 (`ext__badge`, `e-badge`, `ownership-badge`, `order-badge`, `plan-card__badge`, `sess-badge-current`, `security-header__badge`) |
| funciones TS que traducen estado → clase | **20**, en dos convenciones (`statusClass` / `getStatusClass`) |
| consumidores del mixin `ds.badge()` que ya existe | **0** |

Las diez definiciones CSS:

```
features/invoices/list/list.page.scss:38
features/invoices/detail/detail.page.scss:10
features/accounts-payable/list/list.page.scss:29
features/customer-receipts/list/list.page.scss:29
features/data-imports/data-imports.page.scss:129
features/data-exports/data-exports.page.scss:71
features/accounting/journal-entries/journal-entries.page.scss:9
features/accounting/periods/periods.page.scss:7
features/accounting/reconciliation/account-reconciliation/account-reconciliation.page.scss:16
features/inventory/products/products.page.scss:18
```

**Ya divergieron, y esa es la urgencia.** Los tres archivos expresan los mismos
cuatro tonos con tres vocabularios incompatibles:

- `features/invoices/list/list.page.scss:38` → `.paid`, `.pending`, `.partially-paid`
- `features/accounting/periods/periods.page.scss:7` → `.status-open`, `.status-closed`, `.status-future`
- `features/data-exports/data-exports.page.scss:71` → `.status-completed`, `.status-failed`, `.status-processing`

Y lo mismo del lado TypeScript
(`features/invoices/list/list.page.ts:164`,
`features/accounting/periods/periods.page.ts:85`,
`features/data-exports/data-exports.page.ts:81`): tres funciones que hacen la
misma traducción y no comparten ni el nombre.

**Forma propuesta.** `<vx-badge [tone]="'success'">` con cuatro tonos
(`success | warning | danger | neutral | info`) y **el estado traducido fuera**:
el dominio decide el tono, el componente lo pinta. Las veinte funciones se
convierten en veinte tablas `Record<Estado, Tono>`, que es lo que en realidad
son.

**Coste bajo, retorno alto**: 23 archivos, cambios mecánicos, sin lógica.

---

## Prioridad 3 — Importe monetario (`vx-amount`) · **dos formatos incompatibles en producción**

| Evidencia | Cifra |
|---|---|
| `\| vxMoney` (conoce la moneda) | **81 usos en 30 archivos** |
| `\| vxNumber: '1.2-2'` (una cifra suelta) | **126 usos en 23 archivos** |
| de esos, los que pegan el código a mano | 4, en 2 archivos |
| importes que colorean el negativo | **7, en 5 archivos** |
| definiciones rivales de `.negative` | **5** |

```
grep -rn "vxNumber: '1.2-2'" --include=*.html apps/core/client-web/src/app | wc -l
```

Las dos formas, una al lado de la otra:

- `shared/components/transition-preview/transition-preview.component.html:58`
  → `{{ ledger.totalDebit | vxMoney: ledger.currencyCode }}`
- `features/invoices/new/new.page.html:219`
  → `{{ totals().total | vxNumber: '1.2-2' }} {{ ...currencyCode }}`
- `features/reports/aging/aging.page.html:87`
  → `{{ row.current | vxNumber: '1.2-2' }}` — **sin moneda en ninguna parte**

Las cinco `.negative`:
`shared/components/kpi-card/kpi-card.scss:106`,
`features/accounting/chart-of-accounts/chart-of-accounts.page.scss:69`,
`features/accounting/variance-analysis/variance-analysis.page.scss:20`,
`features/accounting/treasury/treasury.page.scss:70`,
`features/dashboard/widgets/stat-summary/stat-summary.scss:89`.

**Por qué importa en este producto y no en otro.** Es un ERP contable: las cifras
son el contenido. Hoy, de 126 importes, **119 no distinguen visualmente un saldo
negativo**, y los informes financieros
(`features/reports/financial-statements/*`, 51 usos entre los cuatro estados)
muestran columnas sin moneda. Un componente resuelve las cuatro cosas de golpe:
moneda, cifras tabulares (`--font-numeric`, que ya existe), alineación a la
derecha y signo.

**Forma propuesta.** `<vx-amount [value]="x" [currency]="c" />`, y `vxMoney`
sigue existiendo para el texto corrido. El componente no recalcula nada: los
importes siguen viniendo del servidor.

---

## Prioridad 4 — Diálogo (`vx-dialog`) · **tres mecanismos, ninguna trampa de foco**

| Evidencia | Cifra |
|---|---|
| mecanismos de diálogo en paralelo | **3** |
| superposiciones dibujadas a mano | **8 archivos** |
| `cdkTrapFocus` / trampa de foco propia en todo el producto | **0** |
| `aria-modal` | 6 |

Los tres mecanismos:

1. **`core/services/dialog.service.ts`** — el de facto: **20 consumidores**
   (`features/invoices/detail`, `chart-of-accounts`, `periods`, `products`,
   `customers`, `suppliers`, `roles`, `user-management`…). Confirmaciones.
2. **`shared/components/ui/modal/ui-modal.component.ts`** — el modal con
   proyección de contenido. **2 consumidores.**
3. **`shared/service/modal.service.ts`** — y este **está roto**. `open()` crea
   un `ModalComponent` y se suscribe a `instance.onConfirm`, `instance.onCancel`
   y `instance.onCloseModal` (`modal.service.ts:50-52`), pero
   `shared/components/modal/modal.component.ts:15-17` declara `confirmed`,
   `cancelled` y `closed`. Las tres propiedades a las que se suscribe son
   `undefined`, así que **cada llamada a `open()` lanza `TypeError`** antes de
   adjuntar nada al DOM.

   No es código muerto. Se llama desde `core/services/auth.ts:154`, al recibir
   `force-logout` por websocket: el aviso «Sesión Terminada» que debería
   explicarle al usuario por qué acaba de perder la sesión **no se muestra
   nunca**. El otro llamante es `app.ts:105` (`openTestModal()`, andamiaje), y
   `core/services/idle.service.ts:15` lo inyecta sin usarlo.

   Retirarlo es, además, la forma más barata de arreglar ese defecto: los dos
   llamantes reales caben en `DialogService`, que ya tiene 20.

Las ocho superposiciones a mano:

```
shared/components/geo-mismatch-modal/geo-mismatch-modal.component.html:1
shared/components/password-confirm-modal/password-confirm-modal.component.html:3
features/invoices/components/invoice-selection-dialog/invoice-selection-dialog.component.html:3
features/settings/components/security-settings/security-settings.component.html:108
features/settings/components/phone-verification-modal/phone-verification-modal.component.html:3
features/settings/roles/roles.page.html:49
features/settings/organization/subsidiaries/subsidiaries.page.html:58
features/auth/login/login.page.html:17
```

**El hallazgo de accesibilidad.** Ninguno atrapa el foco. Abierto un diálogo, el
tabulador recorre la página que hay detrás: para quien navega con teclado o con
lector de pantalla, el diálogo modal del producto no es modal. Tres de ellos
(`security-settings.component.html:109`, `roles.page.html:49`,
`subsidiaries.page.html:58`) además le ponen `role="button"` y `tabindex="0"` al
velo, que **añade** una parada de tabulación delante del diálogo.

**Circunstancia favorable:** `@angular/cdk` ya es dependencia desde la Parte 1,
así que `cdkTrapFocus` y `Overlay` están disponibles sin instalar nada.

---

## Prioridad 5 — Campo de fecha y rango (`vx-date-field`, `vx-date-range`)

| Evidencia | Cifra |
|---|---|
| `<input type="date">` | **41 en 24 archivos** |
| páginas que emparejan un *desde/hasta* | **15** |
| que validan que *desde* ≤ *hasta* | **0** |
| que acotan un campo con el otro (`[min]`/`[max]`) | **0** |

Los quince rangos:
`features/reports/financial-statements/{balance-sheet,income-statement,cash-flow,trial-balance}`,
`features/reports/profitability-by-{product,customer}`,
`features/accounting/general-ledger`, `features/accounting/account-form`,
`features/accounting/reconciliation/statement-import`,
`features/accounts-payable/form`, `features/purchasing/orders/form`,
`features/masters/price-lists/price-lists-form`, `features/payroll/parameters`,
`features/settings/finance/tax-jurisdictions`, `features/hcm/employees/form`.

**Por qué no es cosmético.** Los cuatro estados financieros se piden por rango;
un rango invertido produce un informe vacío y ningún mensaje. El componente
acota un extremo con el otro y lo dice antes de consultar.

Segundo motivo, más silencioso: `<input type="date">` usa el formato del
**navegador**, no el del inquilino, así que hoy la fecha se **escribe** en un
formato y se **lee** (vía `vxDate`) en otro dentro de la misma pantalla.

---

## Prioridad 6 — Estados de carga y de vacío (`vx-spinner`, `vx-empty-state`)

| Evidencia | Cifra |
|---|---|
| `@keyframes` de giro escritos a mano | **16** |
| el que ya existe en el sistema | `assets/styles/base/_elements.scss:213` (`vx-spin`) |
| estados de vacío propios | 12 archivos (15 usos de `.empty-state`, 4 de `.no-results`) |
| consumidores del mixin `ds.empty-state()` | **0** |

Las dieciséis copias de «gira 360 grados» están en `settings/_settings-shared.scss:461`,
`settings/billing/billing.page.scss:611`, `settings/pages/sessions/sessions.component.scss:206`,
`settings/user-management/user-management.page.scss:443`,
`settings/organization/subsidiaries/subsidiaries.page.scss:55`,
`settings/components/phone-verification-modal/…:204`,
`data-imports/data-imports.page.scss:164`, `data-exports/data-exports.page.scss:100`,
`extensions/extensions.page.scss:277`, `invoices/new/new.page.scss:196`,
`accounting/chart-of-accounts/segment-configuration/…:182`,
`accounting/closing/month-end-close/…:61`,
`shared/components/password-confirm-modal/…:300`,
`shared/components/gestures/draft-shell.component.scss:101`,
`layout/main/main.layout.scss:1380`.

**El dato que decide la forma de la solución.** `ds.empty-state()` existe, está
documentado y tiene **cero** consumidores; `vx-spin` existe y se reescribió a
mano dieciséis veces. Un mixin es una regla que hay que recordar. Los armazones
de gesto demostraron lo contrario: desde que la lista vacía es del armazón,
ninguna lista se quedó muda. Lo mismo hace falta aquí, para las pantallas que
**no** son listas.

---

## Prioridad 7 — Paginador (`vx-pager`)

Cinco implementaciones, dos vocabularios:

| Archivo | Clase | CSS propio |
|---|---|---|
| `features/invoices/list/list.page.html:93` | `.pager` | `list.page.scss` |
| `features/accounting/journal-entries/journal-entries.page.html:68` | `.pager` | (global) |
| `features/accounting/daily-journal/daily-journal.page.html:65` | `.pager` | (global) |
| `features/accounting/chart-of-accounts/chart-of-accounts.page.html:166` | `.pagination-info` | `chart-of-accounts.page.scss` |
| `features/settings/user-management/user-management.page.html:122` | `.pagination-controls` | `user-management.page.scss` |

Base global en `assets/styles/_list-page.scss:85`. La de `user-management` es la
única con números de página y elipsis; las demás son anterior/siguiente. Tamaño
de página: `PAGE_SIZE` constante en `journal-entries.page.ts:76`, `pageSize = 8`
en `user-management.page.ts:157`, 50 por defecto en
`payroll/data/payroll.service.ts:192`. **Ninguna deja elegir al usuario.**

Prioridad media-baja: solo cinco sitios, y tres ya convergen en `.pager`.

---

## Prioridad 8 — Vocabulario de botones · **converger, no construir**

| Clase | Usos | Archivos |
|---|---|---|
| `.primary-button` | 90 | 61 |
| `.secondary-button` | 82 | 50 |
| `.icon-button` | 54 | 31 |
| `.btn-primary` | 25 | 15 |
| `.btn-secondary` | 18 | 10 |
| `.danger-button` / `.btn-danger` | 7 / 5 | 5 / 4 |

**No hace falta un `<vx-button>`.** Las dos familias ya resuelven al mismo mixin
(`assets/styles/base/_controls.scss:23` y `assets/styles/_utilities.scss:23`), de
modo que se ven igual. El problema es que hay **dos nombres para la misma cosa**,
más **6 redefiniciones locales** que se salen del sistema:
`shared/components/live-preview/live-preview.scss`,
`features/data-imports/data-imports.page.scss`,
`features/settings/company-profile/company-profile.page.scss`,
`features/settings/branding/branding.page.scss`,
`features/settings/roles/roles.page.scss`,
`features/accounting/chart-of-accounts/segment-configuration/segment-configuration.page.scss`.

Trabajo: elegir una familia, reemplazar la otra con `sed`, borrar las seis
redefiniciones, y añadir la regla al guardián de tokens para que no vuelvan.

---

## Prioridad 9 — Pestañas dentro de página (`vx-tabs`)

Tres tiras de pestañas (`features/invoices/new/new.page.html:52`,
`features/invoices/detail/detail.page.html`,
`features/accounting/account-form/account-form.page.html`), **ninguna** con
`role="tablist"` / `role="tab"` / `aria-selected`, y ninguna con navegación por
flechas. Son `<button>` sueltos con una clase `.active`.

Prioridad baja por volumen (3 sitios) y alta por accesibilidad por sitio. Entra
cuando se toque alguna de las tres.

---

## Lo que NO recomiendo componentizar

- **Tablas.** 83 `<table>` en 72 archivos, pero el mixin `ds.data-table()` ya las
  gobierna y los armazones de gesto ya dan el marco. Un `<vx-table>` genérico en
  un ERP acaba siendo una configuración más complicada que el HTML que sustituye.
- **Tarjetas.** 211 usos de `.card` en 97 archivos, ya resueltos por
  `ds.surface-card()`. Es un contenedor, no un comportamiento: no gana nada
  siendo componente.
- **Envoltorio de campo (`.form-field`).** Hay dos convenciones
  (`.form-field` 165/22, `.form-group` 18/4), pero `ds.input-base()` ya las iguala
  y `libs/shared/ui-a11y` ya pone el `aria-invalid`. Converger las clases sí;
  construir un componente, no — todavía.

---

## Estado de ejecución

El orden que esta auditoría proponía se ejecutó entero. Lo que quedó:

| Prioridad | Componente | Estado |
|---|---|---|
| 1 | `vx-select` | construido y migrado — 13/13 controles, 4 rutas de búsqueda en el servidor |
| 2 | `vx-badge` | construido y migrado |
| 3 | `vx-amount` | construido y migrado |
| 4 | `vx-dialog` | construido y migrado — 9 diálogos con trampa de foco; `shared/service/modal.service.ts` retirado |
| 5 | `vx-date-field`, `vx-date-range` | construidos y migrados |
| 6 | `vx-spinner`, `vx-empty-state`, `vx-error-state` | construidos y migrados |
| 7 | `vx-pager` | construido y migrado |
| 8 | vocabulario de botones | convergido sobre los mixins existentes |
| 9 | `vx-tabs` | construido y migrado |

Tres defectos de producción que la auditoría destapó y que quedaron corregidos
por el camino: ningún diálogo atrapaba el foco (ahora los nueve lo atrapan y lo
devuelven), `ModalService.open()` lanzaba `TypeError` —el aviso de cierre de
sesión forzado no llegaba a verse nunca (`core/auth/auth.ts:154`)— y tres
asteriscos de «campo obligatorio» marcaban campos que no lo eran, que el
verificador `verify:required-markers` destapó al subir de 121 a 139 controles
etiquetados bajo su cobertura.

Lo que sigue abierto es el **resto de `<select>` nativos**: de los 102 del
inventario, los que quedan son enumeraciones (estado, tipo de documento, moneda)
y no listas de entidad. No escalan mal y no es urgente tocarlos; entran cuando
se abra la pantalla por otro motivo.
