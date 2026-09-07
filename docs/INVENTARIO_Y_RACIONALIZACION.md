# Inventario y racionalización — Virtex ERP

**Fecha:** 2026-09-06 · **Alcance:** `apps/core/client-web` (Angular 20, zoneless, standalone) y `apps/backend/api` (NestJS)
**Método:** análisis estático del código fuente. Se rastrearon rutas, definiciones de pestañas, inyección de dependencias y llamadas HTTP hasta el controlador de destino. `node_modules` no está instalado en este entorno, por lo que **no se ejecutaron las pruebas ni la aplicación**: todo lo afirmado abajo proviene de leer el código, y lo que no se pudo verificar se marca explícitamente como *no verificado*.

**Magnitud:** 41.416 líneas TS en frontend, 91.955 en backend · 114 componentes tipo página · 361 endpoints en 72 controladores · 134 entidades.

---

# Hallazgo estructural previo (condiciona todo el inventario)

Antes de las tablas hay que fijar un hecho que cambia el significado de la columna «¿es alcanzable?», porque sin él el inventario se lee al revés.

**`MainLayout` no contiene ningún `<router-outlet>`.** El shell autenticado pinta su contenido con `<app-tab-container>` (Dockview), y ese contenedor no resuelve componentes por el router sino por `TabRegistryService.resolve(route)`.

Evidencia:

| Hecho | Ubicación |
|---|---|
| El único elemento de contenido del shell es el contenedor de pestañas | `layout/main/main.layout.html:398` |
| No hay `<router-outlet>` en `main.layout.html` (405 líneas) | verificado por búsqueda exhaustiva de `router-outlet` en todo `src/` |
| El componente de cada pestaña sale del registry, no del router | `core/tabs/components/tab-container.component.ts:234` (`this.registry.resolve(tab.route)`) |
| Sin definición coincidente se usa `GenericModulePage` («En construcción») | `core/tabs/tab-registry.service.ts:57-60, 88-99` |
| La ruta comodín del shell monta un componente vacío a propósito | `core/components/workspace-blank/workspace-blank.ts` |
| `provideTabs(...)` no se invoca en ningún sitio: el registry solo contiene `CORE_TAB_DEFINITIONS` | verificado por búsqueda de `provideTabs`/`TAB_DEFINITIONS` en todo `src/` |

`CORE_TAB_DEFINITIONS` declara **15 patrones** (`core/tabs/tab-definitions.ts`). Toda ruta autenticada fuera de esos 15 patrones abre una pestaña con la tarjeta «En construcción», **aunque su página exista, esté terminada y esté conectada a endpoints que funcionan**.

Consecuencia medida sobre los 50 enlaces del menú lateral:

| Resultado al hacer clic | Enlaces |
|---|---|
| Renderiza la página real | **10** |
| Abre el placeholder «En construcción» | **40** |

Entre los 40 están la totalidad de Contabilidad, Reportes, Datos maestros, Cuentas por pagar, Cobros, Tesorería, Conciliación y Compras — módulos cuyas páginas están construidas y llaman a endpoints reales y funcionales.

Por eso, en las tablas de la Parte A se separan dos columnas que normalmente serían una:

- **Alcanzable**: existe un camino de navegación (menú o enlace) que lleva a esa URL.
- **Renderiza**: el shell efectivamente monta ese componente.

Una página puede ser alcanzable y aun así no renderizar nunca. Es el caso mayoritario.

> Nota sobre `sidebar-routes.spec.ts`: esa prueba valida los enlaces del menú contra la **configuración del router**, no contra el registry de pestañas. Como el router sí declara esas rutas, la prueba pasa mientras el usuario ve un placeholder. La prueba es correcta en lo que mide; lo que mide dejó de ser lo que determina el render.

---

# PARTE A — Inventario de páginas

Leyenda de **Datos**: `Real` = llega a un endpoint que consulta base de datos · `Mock` = arreglo hardcodeado en el componente · `Vacío` = la señal se inicializa vacía y nada la puebla · `Estático` = pantalla sin datos · `Placeholder` = componente «en desarrollo» declarado como tal.

## Registro / Login / Usuarios

Estas rutas viven fuera del shell de pestañas y se pintan con el `<router-outlet>` de `app.html`, así que **sí renderizan** con normalidad.

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/{lang}/auth/login` | `auth/login/login.page.ts` → `LoginPage` | Sí (raíz redirige) | Sí | Real | `POST /auth/login`, `POST /auth/verify-2fa`, `POST /auth/sso/discover`, `POST /auth/webauthn/login/options`, `POST /auth/webauthn/login/verify`; redirección de navegador a `GET /auth/google` y `GET /auth/microsoft` (`login.page.ts:136-137`) |
| `/{lang}/auth/forgot-password` | `auth/forgot-password/forgot-password/forgot-password.page.ts` | Sí (enlace en login) | Sí | Real | `POST /auth/forgot-password` |
| `/{lang}/auth/reset-password` | `auth/reset-password/reset-password.page/reset-password.page.ts` | Sí (enlace de correo) | Sí | Real | `POST /auth/reset-password` |
| `/{lang}/auth/set-password` | `auth/set-password/set-password.page.ts` | Sí (invitación) | Sí | Real | `POST /auth/set-password-from-invitation`, `POST /auth/invitation/details` |
| `/{lang}/{country}/auth/register` | `auth/register/register.page.ts` | Sí | Sí | Real | `POST /auth/register-checkout`, `POST /auth/register-confirm`, `POST /auth/send-public-verification`, `POST /auth/verify-public-code`, `POST /auth/send-phone-otp`, `POST /auth/verify-phone` |
| `/{lang}/auth/plan-selection` | `payment/components/plan-selection/plan-selection.component.ts` | Sí (alta) | Sí | Parcial | `GET /saas/plans` (real); **`GET /payment/config` no existe en el backend** |
| `/auth/checkout-complete` | `auth/checkout-complete/checkout-complete.page.ts` | Sí (retorno Stripe) | Sí | Real | `POST /auth/create-checkout-session`, `POST /payment/checkout/confirm` |
| `/payment/success` | `payment/components/payment-success/payment-success.component.ts` | Sí (retorno Stripe) | Sí | Estático | ninguno |
| `/payment/cancel` | `payment/components/payment-cancel/payment-cancel.component.ts` | Sí (retorno Stripe) | Sí | Estático | ninguno |
| `/unauthorized` | `unauthorized/unauthorized.page.ts` | Sí (guard) | Sí (fuera del bridge de pestañas) | Estático | ninguno |
| — | `auth/register/steps/step-account-info/step-account-info.ts` | Sí (paso del alta) | Sí | Real | Inyecta `HttpClient` en la línea 29 y **no lo usa** |

**Componentes compartidos de auth** (`auth-shell`, `auth-layout`, `auth-button`, `auth-input`, `auth-footer`, `passkey-button`, `password-validator`, `social-auth-buttons`): sin datos propios, todos alcanzables y en uso.

## Configuración / Administración

Estas 21 secciones **no se alcanzan por el router**. `SETTINGS_ROUTES` está declarado en `settings/settings.routes.ts` y **ningún archivo lo importa** (verificado). Lo que abre estas pantallas es `SECTION_MAP` en `settings/modal/settings-modal.component.ts:39-83`, un segundo mapa que duplica el primero. El acceso es por fragmento `#settings/<seccion>`; `settingsModalRedirectGuard` traduce `/settings/*` a ese fragmento.

| Sección (`#settings/…`) | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `my-profile` | `settings/my-profile/my-profile.page.ts` | Sí (modal) | Sí | Real | `GET/PATCH /users/profile`, `GET /users/job-titles`, `POST /users/profile/avatar`, `POST /users/profile/email-change/request`, `.../confirm` |
| `sessions` | `settings/pages/sessions/sessions.component.ts` | Sí (modal) | Sí | Real | `GET /auth/sessions`, `POST /auth/sessions/:id/revoke` |
| `profile` | `settings/company-profile/company-profile.page.ts` | Sí (modal) | Sí | Real | `GET/PATCH /organizations/profile`, `GET /organizations/memberships`, `POST /organizations/switch` |
| `subsidiaries` | `settings/organization/subsidiaries/subsidiaries.page.ts` | Sí (modal) | Sí | Real | `GET /organizations/subsidiaries`, `POST /organizations/subsidiaries` |
| `branding` | `settings/branding/branding.page.ts` | Sí (modal) | Sí | Real + presets | `BrandingService`; los 15 objetos hardcodeados son paletas de tema, no datos de negocio |
| `billing` | `settings/billing/billing.page.ts` | Sí (modal) | Sí | Real | `GET /saas/plans`, `GET /saas/usage`, `GET /payment/overview`, `GET /payment/invoices`, `POST /payment/portal-session` |
| `roles` | `settings/roles/roles.page.ts` | Sí (modal) | Sí | Real | `GET /roles`, `GET /roles/available-permissions`, `POST /roles`, `PATCH /roles/:id`, `POST /roles/clone/:id`, `DELETE /roles/:id` |
| `users` | `settings/user-management/user-management.page.ts` | Sí (modal) | Sí | Real | `GET /users`, `POST /users/invite`, `PATCH /users/:id`, `PATCH /users/:id/status`, `DELETE /users/:id`, `POST /users/:id/reset-password`, `.../force-logout`, `.../block-and-logout` |
| `sso` | `settings/system/sso/sso.page.ts` | Sí (modal) | Sí | Real | `GET/POST /auth/sso/admin/providers`, `PATCH/DELETE .../providers/:id`, `GET/POST /auth/sso/admin/domains`, `POST .../domains/:id/verify`, `DELETE .../domains/:id` |
| `fiscal` | `settings/fiscal/fiscal.page.ts` | Sí (modal) | Sí | Real | `GET/POST/DELETE /einvoicing/certificates`, `GET /compliance/ncf-sequences`, `POST /compliance/ncf-sequences`, `GET /compliance/reports/:kind` |
| `accounting` | `settings/finance/accounting/accounting.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno — usa `SettingsEmptyStateComponent`, que muestra la insignia «En desarrollo» |
| `currencies` | `settings/finance/currencies/currencies.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `taxes` | `settings/finance/taxes/taxes.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `closing-rules` | `settings/finance/closing-rules/closing-rules.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `intercompany` | `settings/finance/intercompany/intercompany.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `sequences` | `settings/operations/sequences/sequences.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `approvals` | `settings/operations/approvals/approvals.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `inventory-policies` | `settings/operations/inventory-policies/inventory-policies.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `security` | `settings/system/security/security.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `integrations` | `settings/system/integrations/integrations.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| `smtp` | `settings/system/smtp/smtp.page.ts` | Sí (modal) | Sí | **Placeholder** | ninguno |
| — | `settings/layout/settings.layout.ts` | **No** | No | — | Layout con `<router-outlet>` para `SETTINGS_ROUTES`, que nadie monta |

Los 11 «Placeholder» son honestos: declaran «En desarrollo» en pantalla en vez de simular datos. Se distinguen de un mock precisamente por eso.

## General (páginas del shell que sí renderizan)

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/overview` | `overview/overview.page.ts` | Sí (menú, pestaña fija) | **Sí** | **Mock** | Ninguno. `overview/overview.service.ts` devuelve `of(data)` con `MOCK_LATENCY_MS` y tres `TODO(backend)` (líneas 59, 80, 97) |
| `/dashboard` | `dashboard/dashboard.page.ts` | Sí (menú) | **Sí** | **Mixto** | Ver desglose de widgets abajo |
| `/my-work` | `my-work/my-work.page.ts` | Sí (menú) | **Sí** | Real | `GET /my-work` |
| `/approvals` | `approvals/approvals.page.ts` | Sí (menú) | **Sí** | **Mock** | Ninguno. `pendingInvoices`/`pendingExpenses` hardcodeados (líneas 41-47) |
| `/notifications` | `notifications/notifications.page.ts` | Sí (menú) | **Sí** | Real | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| `/global-search` | `global-search/global-search.page.ts` | Sí (menú) | **Sí** | Real | `GET /search` |
| `/data-imports` | `data-imports/data-imports.page.ts` | Sí (pestaña) | **Sí** | **Mock** | Ninguno. `importHistory` hardcodeado (línea 53) |
| `/data-exports` | `data-exports/data-exports.page.ts` | Sí (pestaña) | **Sí** | **Mock** | Ninguno. `exportHistory` hardcodeado (línea 55) |
| `/documents` | `documents/layout/documents.layout.ts` | Sí (menú) | **Sí** (solo el marco) | Estático | Ninguno. Su `<router-outlet>` interno no tiene ruta activa: el área de contenido queda vacía |
| `/documents/repository` | `documents/repository/repository.page.ts` | Sí (por `DOCUMENTS_ROUTES`) | **No** | Mock | 7 archivos hardcodeados (línea 35) |
| `/documents/templates` | `documents/templates/templates.page.ts` | Sí (menú) | **No** | Mock | 4 plantillas hardcodeadas (línea 25) |
| — | `documents/documents.page.ts` | **No** | No | — | Archivo entero comentado; la clase `DocumentsPage` no existe (línea 26) |

### Desglose de widgets del dashboard

| Widget | Datos | Endpoint |
|---|---|---|
| `kpi-roe`, `kpi-roa`, `kpi-current-ratio`, `kpi-quick-ratio`, `kpi-working-capital`, `kpi-leverage`, `kpi-ebitda`, `kpi-fcf`, `kpi-net-margin` | **Real** | `GET /dashboard/kpi/{roe,roa,current-ratio,quick-ratio,working-capital,leverage,ebitda,fcf,net-margin}` |
| `cashflow-chart` | **Real** | `GET /dashboard/consolidated-cash-flow-waterfall` |
| `financial-ratios` | **Mock** | Ninguno. Los 5 ratios están escritos a mano: `'15.2%'`, `'8.1%'`, `'2.1'`, `'1.2'`, `'$250.8K'` (líneas 24-30) |
| `ar-aging-chart` | **Mock** | Ninguno. `amounts = [65000, 22000, 15000, 8500, 4000]` (línea 89) |
| `sales-chart` | **Mock** | Ninguno. `data: [5200, 7500, …]` con meses fijos (líneas 38-43) |
| `invoice-status` | **Mock** | Ninguno. Pagadas 70 / Pendientes 20 / Vencidas 10 (líneas 99-101) |
| `low-stock-products` | **Mock** | Ninguno. Productos inventados; el comentario dice «datos simulados» (línea 33) |
| `top-products-chart`, `expenses-chart`, `comparison-chart`, `recent-activity`, `alerts-panel` | **Mock** | Inyectan `DashboardService`, que **solo gestiona el layout de widgets en `localStorage`** — no tiene ninguna llamada HTTP (verificado sobre las 250 líneas del archivo) |

## Ventas / Facturación

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/invoices` | `invoices/list/list.page.ts` | Sí (menú) | **Sí** | Real | `GET /invoices`, `DELETE /invoices/:id`, `GET /invoices/:id/pdf` |
| `/invoices/new` | `invoices/new/new.page.ts` | Sí (menú) | **Sí** | Real | `POST /invoices`, `GET /customers`, `GET /inventory`, `GET /currencies`, `GET /invoices/context` |
| `/invoices/:id` | `invoices/detail/detail.page.ts` | Sí (desde lista) | **Sí** | Real | `GET /invoices/:id`, `POST /invoices/:id/issue`, `POST /invoices/:id/credit-note`, `GET /invoices/:id/pdf`, `GET /einvoicing/invoices/:id/status`, `POST /einvoicing/invoices/:id/submit`, `GET /einvoicing/invoices/:id/xml` |
| `/invoices/list` (enlace del menú) | — | Sí (menú) | **Sí, pero equivocado** | — | No existe esa ruta: cae en el patrón `/invoices/:id` con `id='list'` y abre el detalle de una factura inexistente |
| `/sales` → `/sales/history` | `sales/history/history.page.ts` | Sí (pestaña `/sales`) | **Sí** | **Mock** | Ninguno. 4 ventas hardcodeadas (línea 27) |
| `/sales/pos` | `sales/pos/pos.page.ts` | Solo por URL directa | **No** | **Mixto** | `InvoicesService` real, pero `allProducts` hardcodeado (línea 57) |

## Inventario

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/inventory` → productos | `inventory/products/products.page.ts` | Sí (pestaña `/inventory`) | **Sí** | Real | `GET /inventory`, `DELETE /inventory/:id` |
| `/inventory/products/new` | `inventory/product-form/product-form.page.ts` | Sí (botón) | **No** | Real | `POST /inventory`, `GET /inventory/:id`, `PATCH /inventory/:id` |
| `/inventory/products/:id/edit` | `inventory/product-form/product-form.page.ts` | Sí (botón) | **No** | Real | idem |
| `/inventory/categories` | `inventory/categories/categories.page.ts` | Solo por URL directa | **No** | **Estático** | Ninguno. El componente solo declara un icono (12 líneas) |
| `/masters/products` | → **el mismo** `inventory/products/products.page.ts` | Sí (menú) | **No** | Real | Alias de ruta al mismo componente |

## Compras / Proveedores

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/purchasing/orders` | `purchasing/orders/orders.page.ts` | Sí (menú) | **No** | **Mock** | Ninguno. 5 órdenes hardcodeadas |
| `/purchasing/requisitions` | `purchasing/requisitions/requisitions.page.ts` | Sí (menú) | **No** | **Mock** | Ninguno. 4 requisiciones hardcodeadas |
| `/purchasing` (layout) | `purchasing/layout/purchasing.layout.ts` | Sí | **No** | — | Layout con `router-outlet` que nunca se monta |
| `/procurement` | `procurement/pages/dashboard.component.ts` | No (sin enlace) | **No** | **Estático** | Ninguno |
| `/masters/suppliers` | `masters/suppliers/supplier-list/supplier-list.page.ts` | Sí (menú) | **No** | Real | `GET /suppliers`, `DELETE /suppliers/:id` |
| `/masters/suppliers/new`, `/:id/edit` | `masters/suppliers/supplier-form/supplier-form.ts` | Sí (botón) | **No** | Real | `POST /suppliers`, `PATCH /suppliers/:id` |
| `/contacts/suppliers` | `contacts/suppliers/suppliers.page.ts` | Solo por URL directa | **No** | Real | `GET /suppliers`, `DELETE /suppliers/:id` |

## Contabilidad

Ninguna de estas páginas renderiza: `/accounting/*` no está en `CORE_TAB_DEFINITIONS`. Todas son alcanzables desde el menú y casi todas están conectadas a endpoints reales.

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/accounting/chart-of-accounts` | `accounting/chart-of-accounts/chart-of-accounts.page.ts` | Sí (menú) | No | Real | vía `ChartOfAccountsStateService` → `GET /chart-of-accounts`; **`DELETE /chart-of-accounts/:id` no existe en el backend** (ver Parte B) |
| `/accounting/chart-of-accounts/new`, `/:id/edit` | `accounting/account-form/account-form.page.ts` | Sí | No | Real | `POST /chart-of-accounts`, `GET /chart-of-accounts/:id`, `PATCH /chart-of-accounts/:id` |
| `/accounting/chart-of-accounts/segments-configuration` | `accounting/chart-of-accounts/segment-configuration/segment-configuration.page.ts` | Solo por URL | No | Real | `GET/POST /chart-of-accounts/segment-definitions`, `POST .../initialize` |
| `/accounting/journal-entries` | `accounting/journal-entries/journal-entries.page.ts` | Sí (menú) | No | Real | `GET /journal-entries` |
| `/accounting/journal-entries/new`, `/:id/edit` | `accounting/journal-entry-form/journal-entry-form.page.ts` | Sí | No | Real | `POST /journal-entries`, `GET /journal-entries/:id`, `GET /journals`, `GET /accounting/ledgers/…` |
| `/accounting/journal-entries/import` | `accounting/journal-entries/import/import.page.ts` | Solo por URL | No | Real | `POST /journal-entries/import/headers`, `.../preview`, `.../confirm` |
| `/accounting/daily-journal` | `accounting/daily-journal/daily-journal.page.ts` | Sí (menú) | No | Real | `GET /journal-entries`, `GET /chart-of-accounts` |
| `/accounting/general-ledger`, `/:accountId` | `accounting/general-ledger/general-ledger.page.ts` | Sí (menú) | No | Real | `GET /accounting/ledgers/general-ledger` |
| `/accounting/ledgers` | `accounting/ledger-list/ledger-list.page.ts` | Sí (menú) | No | Real | `GET /accounting/ledgers` |
| `/accounting/general-ledger/new` | `accounting/ledger-form/app-ledger-form-page.ts` | Sí | No | Real | `POST /accounting/ledgers`, `PATCH /accounting/ledgers/:id` |
| `/accounting/journals` | `accounting/journal-list/journal-list.page.ts` | Sí (menú) | No | Real | `GET /journals` |
| `/accounting/journals/new` | `accounting/journal-form/journal-form.page.ts` | Sí | No | Parcial | `POST /journals` existe; **`GET /journals/:id` y `PUT /journals/:id` no existen en el backend** |
| `/accounting/periods` | `accounting/periods/periods.page.ts` | Sí (menú) | No | Real | `GET /accounting/periods`, `POST /accounting/close-period`, `POST /accounting/reopen-period` |
| `/accounting/closing/month-end` | `accounting/closing/month-end-close/month-end-close.page.ts` | Sí (menú) | No | Real | `GET /accounting/periods`, `GET /accounting/periods/:id/closing-checklist` |
| `/accounting/closing/checklist` | `accounting/closing/checklist/checklist.page.ts` | Sí (menú) | No | Real | idem |
| `/accounting/closing/annual-close` | `accounting/closing/annual-close/annual-close.page.ts` | Sí (menú) | No | **Vacío** | Ninguno. `tasks` se inicializa `[]` y nada la puebla (línea 45). El backend **sí** tiene `POST /accounting/year-end-close` |
| `/accounting/subsidiary-ledgers` | `accounting/subsidiary-ledgers/subsidiary-ledgers.page.ts` | Sí (menú) | No | **Vacío** | Ninguno. 7 señales inicializadas vacías (líneas 52-59) |
| `/accounting/variance-analysis` | `accounting/variance-analysis/variance-analysis.page.ts` | Sí (menú) | No | **Vacío** | Ninguno. `variances` inicializada `[]` (línea 58). El backend tiene `GET /budgets/:id/vs-actual` |
| `/accounting/treasury` | `accounting/treasury/treasury.page.ts` | Sí (menú) | No | Real | `GET /treasury/cash-position`, `GET /treasury/bank-accounts`, `GET /treasury/bank-transfers` |
| `/accounting/treasury/bank-accounts/new`, `/:id/edit` | `accounting/treasury/bank-account-form/bank-account-form.page.ts` | Sí | No | Real | `POST/PATCH /treasury/bank-accounts`, `GET /currencies`, `GET /chart-of-accounts` |
| `/accounting/reconciliation` | `accounting/reconciliation/account-reconciliation/account-reconciliation.page.ts` | Sí (menú) | No | Real | `GET /reconciliation/statements/:id/summary`, `.../suggestions`, `POST /reconciliation/matches`, `DELETE /reconciliation/matches/:id` |
| `/accounting/reconciliation/import` | `accounting/reconciliation/statement-import/statement-import.page.ts` | Solo por URL | No | Real | `POST /reconciliation/statements` |
| — | `accounting/layout/accounting.layout.ts`, `accounting/closing/layout/closing.layout.ts` | Sí | No | — | Layouts con `router-outlet` que nunca se montan |
| — | `accounting/bulk-operations/bulk-operations.ts` | **No** | No | **Roto** | Sin ruta ni uso; solo lo referencia su propio `.spec`. Usa `ChartOfAccountsService`, cuya base es `/api/...` en vez de `/api/v1/...` |
| — | `accounting/merge-tool/merge-tool.ts` | **No** | No | Mock | Sin ruta ni uso; solo lo referencia su propio `.spec` |

## Finanzas y Tesorería (CxC / CxP)

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/accounts-payable` | `accounts-payable/list/list.page.ts` | Sí (menú) | No | Real | `GET /accounts-payable` |
| `/accounts-payable/new`, `/:id/edit` | `accounts-payable/form/form.page.ts` | Sí | No | Real | `POST /accounts-payable`, `PATCH /accounts-payable/:id`, `GET /suppliers`, `GET /chart-of-accounts` |
| `/accounts-payable/:id` | `accounts-payable/detail/detail.page.ts` | Sí | No | Real | `GET /accounts-payable/:id`, `POST /accounts-payable/:id/void`, `.../submit-for-approval`, `GET /accounts-payable/:id/payments` |
| `/accounts-payable/payments` | `accounts-payable/payment/payment.page.ts` | Solo por URL | No | Real | `POST /accounts-payable/payments`, `GET /treasury/bank-accounts` |
| `/customer-receipts` | `customer-receipts/list/list.page.ts` | Sí (menú) | No | Real | `GET /customer-payments`, `GET /customers` |
| `/customer-receipts/new` | `customer-receipts/form/form.page.ts` | Sí | No | Real | `POST /customer-payments`, `GET /invoices`, `GET /customers`, `GET /treasury/bank-accounts` |

## Reportes

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/reports/financial-statements/balance-sheet` | `reports/financial-statements/balance-sheet/balance-sheet.page.ts` | Sí (menú) | No | Real | `GET /financial-reporting/balance-sheet` |
| `.../income-statement` | `.../income-statement/income-statement.page.ts` | Sí (menú) | No | Real | `GET /financial-reporting/income-statement` |
| `.../trial-balance` | `.../trial-balance/trial-balance.page.ts` | Sí (menú) | No | Real | `GET /financial-reporting/trial-balance` |
| `.../cash-flow` | `.../cash-flow/cash-flow.page.ts` | Sí (menú) | No | Real | `GET /financial-reporting/cash-flow-statement` |
| `/reports/aging/receivables` | `reports/aging/aging.page.ts` (`data.side`) | Sí (menú) | No | Real | `GET /customer-payments/aging` |
| `/reports/aging/payables` | `reports/aging/aging.page.ts` (`data.side`) | Sí (menú) | No | Real | `GET /accounts-payable/aging` |
| `/reports/profitability-by-product` | `reports/profitability-by-product/…` | Solo por URL | No | Real | `GET /reports/profitability/by-product` |
| `/reports/profitability-by-customer` | `reports/profitability-by-customer/…` | Solo por URL | No | Real | `GET /reports/profitability/by-customer` |
| `/datasheets` | `datasheets/pages/datasheet-list/datasheet-list.page.ts` | Sí (menú) | No | **Estático** | Ninguno. Es una maqueta sin servicio, aunque el backend expone `GET /datasheets`. Su botón «nuevo» navega a `['new']`, que en `DATASHEET_ROUTES` cae en `:id` |
| `/datasheets/:id` | `datasheets/pages/datasheet-editor/datasheet-editor.page.ts` | Sí | No | Real | `GET /datasheets/:id`, `PATCH /datasheets/:id`, `POST /datasheets`, `GET /datasheets/variables` |
| — | `reports/layout/reports.layout.ts` | Sí | No | — | Layout con `router-outlet` que nunca se monta |

## Datos maestros (sin clasificar en la taxonomía base)

`/masters` agrupa catálogos que pertenecen a módulos distintos (Ventas, Compras, Contabilidad, Configuración). Se listan aparte porque el agrupamiento en sí es objeto de veredicto en la Fase 2.

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/masters/customers` | `masters/customers/customer-list/customer-list.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 4 clientes hardcodeados (línea 30) |
| `/masters/customers/new`, `/:id/edit` | `masters/customers/customer-form/customer-form.page.ts` | Sí | No | Real | `POST /customers`, `GET /customers/:id`, `PATCH /customers/:id` |
| `/masters/suppliers` + formulario | ver «Compras» | Sí | No | Real | — |
| `/masters/products` | → `inventory/products/products.page.ts` | Sí (menú) | No | Real | alias |
| `/masters/price-lists` | `masters/price-lists/price-lists.page.ts` | Sí (menú) | No | Real | `GET /price-lists`, `DELETE /price-lists/:id` |
| `/masters/price-lists/new`, `/:id/edit` | `masters/price-lists/price-lists-form/price-list-form.page.ts` | Sí | No | Real | `POST /price-lists`, `PATCH /price-lists/:id`, `GET /inventory` |
| `/masters/taxes` | `masters/taxes/taxes.page.ts` | Sí (menú) | No | Real | `GET /taxes`, `DELETE /taxes/:id` |
| `/masters/taxes/new` | `masters/taxes/tax-form/tax-form.page.ts` | Sí | No | Real | `POST /taxes`, `PATCH /taxes/:id` |
| `/masters/currencies` | `masters/currencies/currencies.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 4 monedas hardcodeadas. El backend tiene `GET /currencies` |
| `/masters/units-of-measure` | `masters/units-of-measure/units-of-measure.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 7 unidades hardcodeadas. El backend tiene `GET /units-of-measure` |
| `/masters/banks` | `masters/banks/banks.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 4 bancos hardcodeados (líneas 27-32) |
| `/masters/branches` | `masters/branches/branches.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 3 sucursales hardcodeadas |
| `/masters/warehouses` | `masters/warehouses/warehouses.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 4 almacenes hardcodeados |
| `/masters/payment-methods` | `masters/payment-methods/payment-methods.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 4 métodos hardcodeados |
| `/masters/payment-terms` | `masters/payment-terms/payment-terms.page.ts` | Sí (menú) | No | **Mock** | Ninguno. 5 términos hardcodeados |
| — | `masters/layout/masters.layout.ts` | Sí | No | — | Layout con `router-outlet` que nunca se monta |

## Contactos

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints (verificado) |
|---|---|---|---|---|---|
| `/contacts` → `/contacts/customers` | `contacts/customers/customers.page.ts` | Sí (pestaña `/contacts`) | **Sí** | Real | `GET /customers`, `DELETE /customers/:id` |
| `/contacts/customers/new`, `/:id/edit` | `contacts/customer-form/customer-form.page.ts` | Sí | No | Real | `POST /customers`, `PATCH /customers/:id` |
| `/contacts/suppliers` | `contacts/suppliers/suppliers.page.ts` | Solo por URL | No | Real | `GET /suppliers` |

## Nómina y módulos anunciados sin implementar

| Ruta | Archivo / componente | Alcanzable | Renderiza | Datos | Endpoints |
|---|---|---|---|---|---|
| `/hcm` | `hcm/pages/dashboard.component.ts` | No (sin enlace) | No | Estático | Ninguno. **No existe módulo de nómina en el backend** |
| `/manufacturing` | `manufacturing/pages/dashboard.component.ts` | No (sin enlace) | No | Estático | Ninguno. El backend tiene `GET/POST /manufacturing/orders` sin consumidor |
| `/wms` | `wms/pages/dashboard.component.ts` | No (sin enlace) | No | Estático | Ninguno |
| `/projects` | `projects/pages/dashboard.component.ts` | Sí (menú) | No | Estático | Ninguno. **No existe módulo de proyectos en el backend** |
| `/procurement` | `procurement/pages/dashboard.component.ts` | No (sin enlace) | No | Estático | Ninguno |

## Pagos / Pasarelas

Cubierto en «Registro/Login» (checkout, success, cancel, plan-selection) y en «Configuración» (`#settings/billing`). Backend: `PaymentController` (6 endpoints) y `SaasController` (2). `POST /payment/webhook` lo invoca Stripe, no el frontend.

---

# PARTE B — Inventario de endpoints

361 endpoints en 72 controladores. **212 tienen al menos un llamador en el frontend; 149 no.**

Nota metodológica: el emparejamiento se hizo normalizando parámetros de ruta, de modo que `GET /customers/:id` empareja con `GET /customers/${id}`. Un endpoint marcado «sin consumidor conocido» **no es un endpoint muerto**: puede servir a un cron, a otro servicio, a un webhook o a un cliente externo. Se reporta como hallazgo a verificar.

## B.1 — Llamadas del frontend que no encuentran endpoint (defectos confirmados)

Estas son rupturas reales, no ambigüedades: se comparó la URL construida contra los decoradores del controlador.

| Método | URL que llama el frontend | Origen | Qué existe realmente en el backend |
|---|---|---|---|
| `DELETE` | `/api/v1/chart-of-accounts/:id` | `core/api/chart-of-accounts.service.ts:81` → usado por el botón «eliminar» de `chart-of-accounts.page.ts:84` vía `core/state/chart-of-accounts.state.ts:114` | **No hay `@Delete`** en `ChartOfAccountsController`. Solo `PATCH :id/deactivate`. **Eliminar una cuenta falla siempre.** |
| `GET` | `/api/v1/chart-of-accounts/tree` | `core/api/chart-of-accounts.service.ts:65` | No existe. Existen `GET tree/roots` y `GET tree/children/:parentId`. La URL cae en `@Get(':id')` con `id='tree'`. *(Atenuante: `getAccountTree()` no lo llama nadie — es código muerto.)* |
| `GET` / `PUT` | `/api/v1/journals/:id` | `core/api/journals.service.ts` → `journal-form.page.ts` | `JournalsController` solo tiene `POST /journals` y `GET /journals`. **Editar un diario falla siempre.** |
| `GET` | `/api/v1/payment/config` | `features/payment/services/payment.service.ts:14` | `PaymentController` no expone `/config`. |
| `GET`,`POST`,`PATCH` | `/api/chart-of-accounts` y 7 rutas más bajo ese prefijo | `core/services/chart-of-accounts.ts:52` — base `'/api/chart-of-accounts'` | El prefijo global es `api/v1` (`main.ts:151`). **Prefijo equivocado: todas fallan.** *(Atenuante: su único consumidor es `bulk-operations.ts`, que no está enrutado.)* |
| `GET`,`POST` | `/api/datasheets/import/{modules,data}` | `features/datasheets/services/datasheet-import.service.ts:18` — base `'/api/datasheets/import'` | Existen como `/api/v1/datasheets/import/…`. **Prefijo equivocado: la importación de datasheets falla.** |

Además, `features/auth/login/login.page.ts:136` construye `${window.location.origin}/api/v1/auth` a mano en vez de usar `environment.apiUrl`. Funciona solo si el frontend y el backend comparten origen. **No verificado** si el despliegue lo garantiza; no hay `proxy.conf.json` en el proyecto.

## B.2 — Endpoints sin consumidor conocido (149)

Agrupados por módulo. La columna «Lectura» distingue lo que casi seguro tiene otro consumidor de lo que hay que investigar.

### Consumidos por un canal que no es XHR — verificado

| Endpoint | Canal |
|---|---|
| `GET /auth/google`, `GET /auth/microsoft` | Redirección de navegador desde `login.page.ts:137` |
| `GET /auth/google/callback`, `GET /auth/microsoft/callback` | Retorno del proveedor OAuth |
| `GET /auth/sso/:idpId`, `GET /auth/sso/:idpId/callback` | Redirección a `startUrl` devuelta por `POST /auth/sso/discover` (`login.page.ts:152-155`) |
| `GET /auth/step-up/sso`, `GET /auth/step-up/sso/callback` | Redirección desde `core/services/step-up.service.ts:121-125` |
| `POST /payment/webhook` | Stripe |
| `GET /auth/.well-known/jwks.json` | Verificadores externos de JWT |
| `GET /health/queues` | Sondas de infraestructura |

### Sin consumidor — a verificar

| Módulo | Nº | Endpoints |
|---|---|---|
| **journal-entries** | 20 | `PATCH /journal-entries/:id`; adjuntos (`POST/GET /:id/attachments`, `DELETE /attachments/:id`, `GET /attachments/:id/download`); reversos (`POST /:id/reverse`, `POST /:id/create-reversal`); ajustes (`POST /adjustments/period-end`, `/reclassify`); plantillas (`journal-entry-templates`, 6); recurrentes (`recurring-journal-entries`, 5) |
| **chart-of-accounts** | 11 | `GET /:accountId/history`; `PATCH /:id/{deactivate,block,unblock}`; `POST /batch/deactivate`; `POST /merge`; importación (`POST /import/preview`, `/import/confirm`, `GET /import/template`); `GET /tree/roots`, `GET /tree/children/:parentId` |
| **accounting** | 9 | `POST /close-module-period`, `/reopen-module-period`, `/lock-account-in-period`, `/unlock-account-in-period`, `/year-end-close`, `/year-end-close/reopen`, `/inflation-adjustment/run`, `/ledger-mappings` (2) |
| **currencies** | 8 | `POST /currencies`, `GET/PATCH/DELETE /currencies/:id`; `exchange-rates` (4, incl. `POST /exchange-rates/update` y `/backfill`) |
| **dimensions** | 8 | CRUD completo de dimensiones y sus reglas |
| **sales** | 7 | `leads` (3), `opportunities` (1), `quotes` (3, incl. `POST /quotes/:id/convert-to-invoice`) |
| **budgets** | 6 | CRUD + `GET /budgets/:id/vs-actual` |
| **fixed-assets** | 6 | CRUD + `POST /fixed-assets/:id/dispose` |
| **workflows** | 6 | `POST /approve/:requestId`, `POST /reject/:requestId`, políticas (4) |
| **accounts-payable** | 6 | `DELETE /accounts-payable/:id`; `vendor-debit-notes` (5) |
| **datasheets** | 6 | `GET /datasheets`, `DELETE /datasheets/:id`, versiones (2), importación (2 — el frontend las llama con prefijo malo) |
| **customers** | 5 | `customer-groups` (5) |
| **customer-service** | 5 | `GET /cases`; portal de cliente (4) |
| **reconciliation** | 5 | reglas (4), `GET /statements/:id/matches` |
| **intercompany** | 4 | transacciones (4) |
| **auth** | 4 | `POST /logout-all`, `POST /sessions/revoke-others`, `GET /password-policy` |
| **einvoicing** | 3 | `GET /messages`, `POST /received/approval`, `POST /sequences/void` |
| **consolidation** | 3 | `POST /run`, mapeo (2) |
| **analytical-reporting** | 3 | `POST /query`, `/refresh-view`, `/synchronize-view` |
| **units-of-measure** | 2 | `GET`, `POST` — la página que los necesita usa datos hardcodeados |
| **manufacturing** | 2 | `GET/POST /manufacturing/orders` |
| **reports** | 2 | `GET /reports/aging`, `POST /reports/generate` |
| **users** | 2 | `GET /users/:id/activity`, `POST /users/:id/email-change` |
| **otros** | 5 | `GET /bi/sales`, `GET /audit`, `GET /invoices/:id/print`, `POST /notifications/test-notification`, `PATCH /compliance/ncf-sequences/:id`, `DELETE /push/unsubscribe` |

---

# PARTE C — Veredicto por página (Fase 2)

## Criterio previo sobre el veredicto «eliminar»

Se reserva para lo que **nada referencia**, verificado por búsqueda exhaustiva en todo `src/`. Cuando no se pudo descartar un uso externo (cron, servicio, cliente), el veredicto es *«verificar uso real antes de eliminar»*, tal como exige el enunciado.

## C.1 — El veredicto que domina a los demás

| Elemento | Veredicto | Evidencia | Justificación |
|---|---|---|---|
| Registro de pestañas (`CORE_TAB_DEFINITIONS`) vs. rutas del router | **Reconstruir (prioridad 1)** | 15 patrones en el registry frente a ~90 rutas declaradas; 40 de 50 enlaces del menú caen en `GenericModulePage` | El sistema tiene **dos tablas de enrutado** y solo una decide lo que se pinta. No es que falten páginas: están construidas y conectadas. Falta registrarlas. Es la corrección con mayor relación valor/esfuerzo del proyecto: convierte ~35 páginas ya funcionales de invisibles en utilizables sin tocar su lógica. |

Mientras esto no se resuelva, cualquier otro veredicto sobre páginas de Contabilidad, Reportes, Maestros, CxP o CxC es teórico: el usuario no las ve.

## C.2 — Duplicadas (misma función implementada dos veces)

| Página | Veredicto | Evidencia | Justificación |
|---|---|---|---|
| `masters/customers/customer-form/customer-form.page.ts` | **Fusionar** con `contacts/customer-form/customer-form.page.ts` | Mismo nombre de clase `CustomerFormPage`, mismo `CustomersService`, mismos campos. El `diff` solo difiere en cómo se lee el id: `ActivatedRoute` vs `input<string>()` | Copia literal. Además el sistema de pestañas pasa los parámetros de ruta **como inputs** (`tab-container.component.ts:246`), así que la variante de `contacts` es la compatible con la arquitectura vigente y la de `masters` no recibiría nunca su id. **Sobrevive la de `contacts`.** |
| `masters/customers/customer-list/customer-list.page.ts` | **Eliminar** | 34 líneas, 4 clientes hardcodeados, sin servicio. `contacts/customers/customers.page.ts` (68 líneas) hace lo mismo contra `GET /customers` | Dos listas de clientes; una es una maqueta. Confirmado que nada más la referencia: solo `masters.routes.ts` la enruta. |
| `masters/suppliers/supplier-list/supplier-list.page.ts` vs `contacts/suppliers/suppliers.page.ts` | **Fusionar** | Ambas reales, ambas sobre `SuppliersService`; la de `contacts` añade `DialogService` para la confirmación de borrado | Redundancia con dos implementaciones válidas. **Sobrevive la de `contacts`**, por coherencia con el veredicto anterior y porque confirma antes de borrar. |
| `SETTINGS_ROUTES` (`settings/settings.routes.ts`) | **Eliminar** | Ningún archivo lo importa (verificado). `SECTION_MAP` (`settings-modal.component.ts:39-83`) declara las mismas 21 secciones y es lo que realmente se usa | Dos mapas de las mismas secciones; uno es inalcanzable. Mantenerlo garantiza que se desincronicen. Al eliminarlo, eliminar también `settings/layout/settings.layout.ts`, cuyo único fin es alojar el `router-outlet` de esas rutas. |
| Ruta `documents` duplicada en `app.routes.ts` (líneas 243 y 333) | **Fusionar** | Dos entradas con `path: 'documents'`; la primera monta `DocumentsLayout` sin hijos, la segunda carga `DOCUMENTS_ROUTES` con `repository` y `templates` | La primera declaración gana el match y deja las subrutas inalcanzables por el router. Debe quedar una sola: la que carga `DOCUMENTS_ROUTES`. |
| `masters/products` → `inventory/products/products.page.ts` | **Mover** | La ruta de `masters` carga el mismo componente que `inventory` | No es código duplicado sino un alias de URL. Dos URLs para una pantalla fragmentan enlaces, historial y analítica. Dejar `/inventory/products` como canónica. |
| Widget `financial-ratios` | **Eliminar** | Muestra ROE, ROA, liquidez corriente, prueba ácida y capital de trabajo escritos a mano (`'15.2%'`, `'8.1%'`…). Los widgets `kpi-roe`, `kpi-roa`, `kpi-current-ratio`, `kpi-quick-ratio` y `kpi-working-capital` calculan **esos mismos cinco** contra `GET /dashboard/kpi/*` | Redundante y peor: en el mismo tablero pueden convivir el ROE real y un ROE inventado. Es un riesgo de credibilidad, no solo deuda técnica. |
| Widget `ar-aging-chart` | **Reconstruir** | `amounts = [65000, 22000, 15000, 8500, 4000]` hardcodeado (línea 89), mientras `AgingService` ya consume `GET /customer-payments/aging` para la página `/reports/aging/receivables` | El dato real existe y ya se usa en otra pantalla. Conectar, no rehacer. |

## C.3 — Huérfanas de backend (mock o desconectadas)

### Renderizan hoy y muestran datos falsos — máxima prioridad

Estas cuatro son las únicas que el usuario **ve de verdad** con datos inventados. Es donde el producto miente.

| Página | Veredicto | Evidencia | Justificación |
|---|---|---|---|
| `overview/overview.page.ts` | **Reconstruir** | `overview.service.ts` devuelve `of(data)` con `MOCK_LATENCY_MS` y tres `TODO(backend)`: actividad reciente, noticias, eventos. Los datos incluyen facturas y clientes inventados con importes en RD$ | Es la **pestaña fija de inicio**, lo primero que ve todo usuario tras entrar. Muestra actividad de una empresa que no existe. Falta endpoint: `GET /overview/{recent-activity,news,events}`. |
| `dashboard/dashboard.page.ts` (7 widgets) | **Reconstruir parcialmente** | `sales-chart`, `invoice-status`, `low-stock-products`, `ar-aging-chart`, `financial-ratios`, `top-products-chart`, `recent-activity` sin fuente real; `DashboardService` solo persiste el layout en `localStorage` | Los 9 KPI y el waterfall de caja **sí** son reales. El tablero es mitad verdad y mitad ficción, sin distinción visual: es peor que un tablero vacío, porque induce decisiones. |
| `approvals/approvals.page.ts` | **Reconstruir** | Sin servicios; `pendingInvoices` y `pendingExpenses` hardcodeados | El backend **ya tiene** `POST /workflows/approve/:requestId`, `/reject/:requestId` y `GET /workflows/policies`, todos sin consumidor. Es conectar lo que existe. |
| `sales/history/history.page.ts` | **Reconstruir** | 4 ventas hardcodeadas con nombres inventados | Es lo que se abre en la pestaña `/sales`. `GET /invoices` ya sirve el dato. |
| `data-imports`, `data-exports` | **Reconstruir** | Historiales hardcodeados | No hay endpoint de historial de importación/exportación. Requiere backend nuevo. |

### No renderizan y además son mock

| Página | Veredicto | Evidencia |
|---|---|---|
| `masters/banks`, `masters/branches`, `masters/warehouses`, `masters/payment-methods`, `masters/payment-terms` | **Reconstruir** — no hay endpoint que las alimente; requieren backend nuevo | Arreglos hardcodeados; sin controlador equivalente en los 361 endpoints |
| `masters/currencies` | **Reconstruir** — el endpoint existe | 4 monedas hardcodeadas; `GET /currencies` y `GET /currencies/:id` están sin consumidor |
| `masters/units-of-measure` | **Reconstruir** — el endpoint existe | 7 unidades hardcodeadas; `GET/POST /units-of-measure` sin consumidor |
| `purchasing/orders`, `purchasing/requisitions` | **Reconstruir** | Mock; no hay controlador de órdenes de compra ni requisiciones. Requiere backend nuevo |
| `documents/repository`, `documents/templates` | **Reconstruir** | Mock; no hay módulo de documentos en el backend |
| `sales/pos` | **Reconstruir** | `InvoicesService` real pero catálogo hardcodeado; `GET /inventory` ya existe |

### Páginas permanentemente vacías (peor que mock: no muestran nada)

| Página | Veredicto | Evidencia | Justificación |
|---|---|---|---|
| `accounting/closing/annual-close` | **Reconstruir** | `tasks` inicializada `[]`, sin servicio (línea 45) | El backend tiene `POST /accounting/year-end-close` y `/reopen`, sin consumidor. La pantalla del cierre anual no puede ejecutar el cierre anual. |
| `accounting/subsidiary-ledgers` | **Reconstruir** | 7 señales vacías (líneas 52-59) | Enlazada en el menú. Sin fuente, muestra una pantalla en blanco permanente. |
| `accounting/variance-analysis` | **Reconstruir** | `variances` inicializada `[]` (línea 58) | El backend tiene `GET /budgets/:id/vs-actual` sin consumidor: es exactamente el dato que falta. |
| `inventory/categories` | **Reconstruir** o **eliminar** | Componente de 12 líneas, solo un icono | No hay endpoint de categorías. Si no hay plan de producto, retirarla del router; hoy no aporta nada. |
| `datasheets/pages/datasheet-list` | **Reconstruir** | Maqueta estática; `GET /datasheets` existe sin consumidor. El botón «nuevo» navega a `['new']`, que cae en `:id` | La lista está a un servicio de distancia de funcionar. |

## C.4 — Mal ubicadas

| Página | Veredicto | Evidencia | Justificación |
|---|---|---|---|
| `masters/taxes` + `masters/taxes/tax-form` | **Mover** a Configuración → Finanzas | `#settings/taxes` existe y es un placeholder «En desarrollo» | Los impuestos son reglas de configuración fiscal, no un catálogo operativo. Hay una sección vacía esperándolos. |
| `masters/currencies` | **Mover** a Configuración → Finanzas | `#settings/currencies` existe y es un placeholder | Mismo razonamiento; hoy hay dos sitios para lo mismo y ninguno funciona. |
| `masters/payment-methods`, `masters/payment-terms` | **Mover** a Configuración → Operaciones | Son parámetros, no maestros operativos | Coherencia con el agrupamiento de `sequences` y `approvals`. |
| `masters/warehouses` | **Mover** a Inventario | Un almacén es una entidad de inventario | `#settings/inventory-policies` cubre las políticas; el catálogo pertenece al módulo. |
| `masters/branches` | **Mover** a Configuración → Organización | Convive conceptualmente con `#settings/subsidiaries` | Estructura de la empresa, no dato maestro transaccional. |
| `masters/products` | **Mover** (consolidar en `/inventory/products`) | Alias del mismo componente | Ver C.2. |
| `accounting/treasury/*`, `accounting/reconciliation/*` | **Mover** a un módulo Tesorería propio | 4 páginas reales bajo `/accounting/`; el menú ya las agrupa como «Tesorería» | El menú y las URLs discrepan. Tesorería es un módulo con dueño distinto al de Contabilidad general. |
| `masters/price-lists` | **Mover** a Ventas | Una lista de precios es un instrumento comercial | Se decide con Ventas, no con Contabilidad. |

Tras estos movimientos, `/masters` queda sin contenido propio: el veredicto sobre el grupo es **disolverlo**, no reorganizarlo. Existía como cajón de sastre y esa es la razón por la que 8 de sus 13 páginas son mock.

## C.5 — Código sin referencia alguna

| Elemento | Veredicto | Evidencia |
|---|---|---|
| `features/documents/documents.page.ts` | **Eliminar** | Archivo íntegramente comentado; la clase `DocumentsPage` no existe. Búsqueda exhaustiva: cero referencias |
| `features/accounting/merge-tool/merge-tool.ts` | **Eliminar** | Sin ruta ni uso en plantillas; solo lo referencia su propio `.spec.ts` |
| `features/accounting/bulk-operations/bulk-operations.ts` | **Eliminar** | Igual que el anterior, y además su servicio apunta a un prefijo inexistente |
| `core/services/chart-of-accounts.ts` (`ChartOfAccountsService`) | **Eliminar** | Su único consumidor es `bulk-operations.ts`. Sus 8 rutas usan `/api/…` en vez de `/api/v1/…` |
| `getAccountTree()` en `core/api/chart-of-accounts.service.ts:64` | **Eliminar** | Sin llamadores; apunta a un endpoint inexistente |
| `HttpClient` inyectado en `step-account-info.ts:29` | **Eliminar** | Inyectado y nunca usado |
| `features/hcm`, `features/wms`, `features/manufacturing`, `features/procurement` (dashboards) | **Verificar uso real antes de eliminar** | Sin enlace en el menú y sin backend equivalente (salvo `manufacturing/orders`). No se puede descartar que sean andamiaje de un roadmap en curso: **la decisión es de producto, no técnica** |
| `features/projects` | **Verificar uso real antes de eliminar** | Enlazado en el menú pero sin backend. Igual que arriba |

## C.6 — Defectos funcionales confirmados (no encajan en las categorías del enunciado)

Se reportan porque son fallos de producción, independientes de la racionalización.

| Defecto | Evidencia | Impacto |
|---|---|---|
| **Eliminar una cuenta contable falla siempre** | El frontend llama `DELETE /chart-of-accounts/:id`; `ChartOfAccountsController` no tiene `@Delete` | Función visible en la UI que nunca puede funcionar |
| **Editar un diario contable falla siempre** | `GET`/`PUT /journals/:id` no existen; solo hay `POST` y `GET` de colección | Igual |
| **La importación de datasheets falla siempre** | `datasheet-import.service.ts:18` usa `/api/datasheets/import` en vez de `/api/v1/…` | Igual |
| **`GET /payment/config` no existe** | `payment.service.ts:14` | Afecta la selección de plan en el alta |
| **El enlace «Facturas» del menú abre el detalle de una factura inexistente** | `/invoices/list` cae en el patrón `/invoices/:id` con `id='list'` | Enlace roto en el camino comercial principal |
| **29 de 73 controladores no declaran permisos** | Solo 43 usan `@HasPermission`; `PermissionsGuard` **no** está registrado como `APP_GUARD` (`app.module.ts:300-328` registra Throttler, Jwt, Csrf y SubscriptionActive) | `InventoryController`, `SuppliersController`, `PriceListsController`, `DimensionsController`, `DatasheetsController`, `ManufacturingController`, `UnitsOfMeasureController`, `sales/leads`, `sales/opportunities` y `DashboardController` quedan accesibles a **cualquier miembro autenticado del tenant**, mientras el frontend simula restringirlos con `permissionsGuard`. El propio comentario del decorador (`permissions.decorator.ts:13`) advierte de este patrón. **Es un fallo de control de acceso, no una carencia de funcionalidad.** |
| **`login.page.ts` construye la URL de la API a mano** | `${window.location.origin}/api/v1/auth` (línea 136) en vez de `environment.apiUrl` | Rompe el login social si frontend y backend no comparten origen. **No verificado** contra la configuración de despliegue |

---

# PARTE D — Scorecard de madurez por módulo

Las seis dimensiones se puntúan por separado sobre 10. «Datos reales» mide qué proporción de las páginas del módulo no depende de datos hardcodeados.

## Registro / Login / Usuarios

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **9** | Alta con pago, verificación por correo y teléfono, 2FA (TOTP + correo), passkeys/WebAuthn, SSO con descubrimiento de dominio, step-up, impersonación, invitaciones, gestión de sesiones. 57 endpoints |
| Datos reales vs. mock | **10** | Ninguna pantalla mock |
| Permisos/roles | **8** | `RolesController` y `UsersController` con `@HasPermission`; los controladores de auth son públicos por diseño |
| Validaciones y casos borde | **9** | Comentarios de corrección con referencia a OWASP/CWE en guards y páginas; CSRF global; token en fragmento, nunca en query |
| Localización LatAm/EEUU | **9** | es/en/pt; ruta con prefijo de idioma y de país; validadores de identificador fiscal por país |
| Consistencia UI/UX | **9** | `AuthShellComponent` como armazón persistente compartido |

**Falta para el 100%:** registrar `PermissionsGuard` como `APP_GUARD`; dar consumidor a `POST /auth/logout-all`, `POST /auth/sessions/revoke-others` y `GET /auth/password-policy`; usar `environment.apiUrl` en `login.page.ts:136`; eliminar el `HttpClient` inerte de `step-account-info.ts`.

## Configuración / Administración

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **5** | 10 de 21 secciones operativas; 11 son placeholders «En desarrollo» |
| Datos reales vs. mock | **7** | Sin datos falsos: los placeholders se declaran como tales. Se penaliza la ausencia, no el engaño |
| Permisos/roles | **8** | `permissionsGuard` por sección en el frontend; `RolesController`/`UsersController` protegidos atrás |
| Validaciones y casos borde | **7** | Bien en perfil, SSO y facturación; sin cubrir en las 11 secciones vacías |
| Localización LatAm/EEUU | **6** | La sección fiscal cubre e-CF de RD; `#settings/currencies` y `#settings/taxes` están vacías |
| Consistencia UI/UX | **9** | Modal unificado con navegación lateral e iconografía coherente |

**Falta para el 100%:** implementar las 11 secciones placeholder (preferencias contables, multimoneda, reglas fiscales, periodos fiscales, intercompañía, secuencias, flujos de aprobación, políticas de inventario, seguridad, integraciones, SMTP); eliminar `SETTINGS_ROUTES` y `settings.layout.ts`; conectar `sequences` con `POST /einvoicing/sequences/void` y `PATCH /compliance/ncf-sequences/:id`; conectar `approvals` con `GET/POST /workflows/policies`.

## Contabilidad

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **8** | 22 páginas; plan de cuentas con segmentos, asientos con importación, libro diario y mayor, multi-libro, periodos, cierre mensual. Backend con 18 + 28 + 18 endpoints |
| Datos reales vs. mock | **8** | 19 de las 22 páginas conectadas a endpoints reales; 3 permanentemente vacías (cierre anual, auxiliares, análisis de variaciones); ninguna muestra datos falsos |
| Permisos/roles | **7** | `ChartOfAccountsController`, `JournalEntriesController` y `AccountingController` con `@HasPermission` |
| Validaciones y casos borde | **8** | `PeriodLockGuard`, partida doble validada, importación con previsualización antes de confirmar |
| Localización LatAm/EEUU | **7** | `coa-builder.ts` genera plan por país; ajuste por inflación implementado (relevante para AR/VE) pero sin consumidor |
| Consistencia UI/UX | **3** | **Ninguna de las 22 páginas renderiza**: todas caen en «En construcción» |

**Falta para el 100%:** registrar las rutas de `/accounting/*` en `CORE_TAB_DEFINITIONS`; añadir `DELETE /chart-of-accounts/:id` o cambiar el botón a `PATCH :id/deactivate`; añadir `GET`/`PUT /journals/:id`; conectar cierre anual con `POST /accounting/year-end-close`, variaciones con `GET /budgets/:id/vs-actual` y auxiliares con su fuente; dar consumidor a asientos recurrentes, plantillas, reversos, adjuntos, historial de cuenta e importación del plan.

## Finanzas y Tesorería

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **7** | CxP (lista, alta, detalle, pagos), CxC (lista, alta), tesorería (posición de caja, cuentas bancarias, transferencias), conciliación con sugerencias e importación de extractos |
| Datos reales vs. mock | **9** | Las 10 páginas conectadas a endpoints reales |
| Permisos/roles | **7** | `AccountsPayableController`, `TreasuryController` y `ReconciliationController` con `@HasPermission` |
| Validaciones y casos borde | **7** | Conciliación con exclusión de transacciones y cierre/reapertura de extracto |
| Localización LatAm/EEUU | **6** | Multimoneda en cuentas bancarias; `POST /exchange-rates/update` sin consumidor |
| Consistencia UI/UX | **3** | Ninguna renderiza |

**Falta para el 100%:** registrar las pestañas; conectar las reglas de conciliación (4 endpoints sin consumidor); dar consumidor a `vendor-debit-notes` (5) y a `DELETE /accounts-payable/:id`; construir la UI de tipos de cambio.

## Ventas / Facturación

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **6** | Facturación completa (lista, alta, detalle, emisión, nota de crédito, PDF, e-CF). CRM inexistente en frontend pese a `leads`, `opportunities` y `quotes` en backend |
| Datos reales vs. mock | **5** | Las 3 páginas de facturas son reales; historial de ventas y POS son mock |
| Permisos/roles | **7** | `InvoicesController` con `@HasPermission`; `leads` y `opportunities` sin protección |
| Validaciones y casos borde | **8** | Secuencias fiscales, emisión idempotente, notas de crédito |
| Localización LatAm/EEUU | **7** | e-CF de DGII (RD) completo; no hay CFDI (MX), DIAN (CO) ni DTE (CL) |
| Consistencia UI/UX | **6** | Facturas renderizan bien; el enlace `/invoices/list` del menú está roto |

**Falta para el 100%:** corregir `/invoices/list` → `/invoices`; conectar historial de ventas a `GET /invoices`; conectar el POS a `GET /inventory`; construir UI de leads, oportunidades y cotizaciones (7 endpoints listos, incluido `POST /quotes/:id/convert-to-invoice`); `GET /invoices/:id/print` sin consumidor.

## Compras / Proveedores

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **2** | Solo maestro de proveedores. Órdenes y requisiciones son maquetas; **no hay controlador de compras en el backend** |
| Datos reales vs. mock | **3** | 2 de 5 páginas reales (listas y formulario de proveedores) |
| Permisos/roles | **2** | `SuppliersController` **sin** `@HasPermission` |
| Validaciones y casos borde | **2** | Inexistentes fuera del maestro |
| Localización LatAm/EEUU | **2** | Solo el identificador fiscal del proveedor |
| Consistencia UI/UX | **3** | Ninguna renderiza |

**Falta para el 100%:** módulo backend de compras completo (requisición → orden → recepción → factura de proveedor → pago), con su modelo de datos; proteger `SuppliersController`; conectar el flujo de aprobación con `workflows`; reconstruir las dos páginas mock.

## Inventario

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **4** | CRUD de productos. Sin movimientos, sin lotes/series, sin valoración, sin multi-almacén. `InventoryController` tiene 5 endpoints |
| Datos reales vs. mock | **8** | Productos y formulario reales; categorías es una pantalla vacía |
| Permisos/roles | **1** | `InventoryController` **sin** `@HasPermission`. El frontend simula exigir `inventory:view` |
| Validaciones y casos borde | **3** | Sin control de stock negativo ni de costo |
| Localización LatAm/EEUU | **3** | Sin métodos de valoración por jurisdicción |
| Consistencia UI/UX | **6** | `/inventory` sí renderiza (es una de las 15 pestañas); el formulario y categorías no |

**Falta para el 100%:** proteger `InventoryController`; movimientos y kardex; valoración (promedio/PEPS); multi-almacén conectado al maestro de almacenes; categorías reales; conectar `low-stock-products` del dashboard.

## Nómina

| Dimensión | Nota | Sustento |
|---|---|---|
| Todas | **0** | No existe módulo de nómina en el backend. `features/hcm` es un componente estático sin enlace en el menú |

**Falta para el 100%:** el módulo entero. Para LatAm implica motor de cálculo por país (TSS y regalía en RD, IMSS e ISR en MX, seguridad social en CO/CL/PE), y para EEUU retención federal y estatal más W-2/941. Es un producto en sí mismo, no una pantalla.

## Pagos / Pasarelas

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **7** | Stripe: checkout, confirmación, portal de cliente, facturas, webhook, planes y consumo SaaS |
| Datos reales vs. mock | **9** | Todo real salvo `GET /payment/config`, que no existe |
| Permisos/roles | **7** | `PaymentController` con `@Public()` deliberado en el webhook y comentario que lo justifica |
| Validaciones y casos borde | **8** | `SubscriptionActiveGuard` global; periodo de gracia contemplado en `MainLayout` |
| Localización LatAm/EEUU | **4** | Solo Stripe. Sin pasarelas locales (Azul/CardNet en RD, Mercado Pago, PSE, Webpay), decisivas en LatAm |
| Consistencia UI/UX | **8** | Flujo de alta y facturación coherentes |

**Falta para el 100%:** añadir `GET /payment/config` o eliminar la llamada; pasarelas locales por país; conciliación de cobros con `customer-payments`.

## Reportes

| Dimensión | Nota | Sustento |
|---|---|---|
| Completitud funcional | **7** | Los 4 estados financieros, antigüedad de saldos en ambos lados, rentabilidad por producto y cliente, datasheets |
| Datos reales vs. mock | **8** | 8 de 10 conectadas; la lista de datasheets es una maqueta |
| Permisos/roles | **7** | `FinancialReportingController` y `ReportsController` con `@HasPermission`; `DatasheetsController` sin protección |
| Validaciones y casos borde | **7** | `TemporalValidityGuard` en informes financieros |
| Localización LatAm/EEUU | **5** | Sin formatos regulatorios locales (IT-1/606/607 de RD, DIOT de MX) más allá de `GET /compliance/reports/:kind` |
| Consistencia UI/UX | **3** | Ninguna renderiza |

**Falta para el 100%:** registrar las pestañas; conectar la lista de datasheets a `GET /datasheets` y arreglar su botón «nuevo»; corregir el prefijo de `datasheet-import.service.ts`; proteger `DatasheetsController`; dar consumidor a `analytical-reporting` (3), `POST /reports/generate`, `GET /bi/sales` y `GET /audit`.

---

# PARTE E — Problemas sistémicos

Estos no encajan en las categorías del enunciado y se reportan igual, como pide la Fase 2.

1. **Dos tablas de enrutado, una sola manda.** El router declara ~90 rutas; el registry de pestañas conoce 15. Nada obliga a que coincidan y no hay prueba que lo compruebe. Corregir los 40 enlaces sin cerrar la brecha estructural garantiza la reaparición del problema. **Recomendación:** una prueba que recorra `SIDEBAR_MENU` y falle si `TabRegistryService.resolve()` devuelve `isFallback: true`. Es el equivalente exacto de lo que `sidebar-routes.spec.ts` hace hoy contra el router, aplicado a lo que sí determina el render.

2. **La prueba de enlaces da una garantía que ya no corresponde.** `sidebar-routes.spec.ts` está bien escrita y documentada, y valida la tabla equivocada. Una prueba verde sobre lo que no manda es peor que no tenerla: sostiene la creencia de que los enlaces funcionan.

3. **`PermissionsGuard` no es global mientras Csrf, Jwt y SubscriptionActive sí lo son.** El propio código documenta que declarar un control por endpoint termina en «4 de 50» y por eso hizo globales los otros tres. El de permisos quedó fuera, con el resultado medido: 29 de 73 controladores sin declaración. **Recomendación:** registrarlo como `APP_GUARD` con denegación por defecto y `@Public()`/`@NoPermission()` explícitos donde corresponda.

4. **El frontend simula un control de acceso que el backend no aplica.** `permissionsGuard` exige `inventory:view`, `sales:view`, `reports:view`… y varios controladores correspondientes no comprueban nada. Un cliente que no sea el navegador de la aplicación entra sin restricción. Es el punto más grave del inventario en términos de riesgo.

5. **Prefijo de API construido a mano en tres sitios distintos.** `core/services/chart-of-accounts.ts` y `datasheet-import.service.ts` usan `/api`; `login.page.ts` usa `${window.location.origin}/api/v1`. Los tres eluden `environment.apiUrl`. Dos ya están rotos. **Recomendación:** prohibirlo por regla de lint y centralizar en el token `API_URL`, que ya existe y se usa en `AuthService`.

6. **Ocho páginas listas y desconectadas frente a nueve grupos de endpoints listos y sin consumidor.** Cierre anual, análisis de variaciones, aprobaciones, monedas, unidades de medida, antigüedad en el dashboard, datasheets y variaciones presupuestarias tienen ya su contraparte construida al otro lado. No es trabajo de producto: es cableado. Es el segundo mejor retorno del proyecto después del registro de pestañas.

7. **`/masters` como cajón de sastre.** 8 de sus 13 páginas son mock, la proporción más alta de cualquier grupo. Un grupo definido por «es un catálogo» y no por un dominio de negocio no tiene dueño, y lo que no tiene dueño no se termina. La composición del grupo es la causa, no el síntoma.

8. **Cobertura de pruebas asimétrica.** 120 specs en frontend y 70 en backend, con el backend al doble de líneas y concentrando la lógica de negocio real (99 de 131 DTO con `class-validator`, 134 entidades). Las reglas contables, fiscales y de conciliación son lo más caro de equivocar y lo menos cubierto en proporción.

9. **Localización profunda en fiscalidad, ausente en el resto.** 19 perfiles de país en `country-profiles.ts`, pero solo dos estrategias fiscales concretas (RD y EEUU) más la genérica y la de base de datos. La facturación electrónica solo cubre DGII. Comercializar en México, Colombia o Chile exige CFDI, DIAN y DTE, cada uno un proyecto. **El producto está preparado para RD y EEUU; el resto de LatAm es superficie, no cobertura.**

---

# PARTE F — Orden de trabajo sugerido

El orden sigue la relación entre valor entregado y esfuerzo, con las correcciones de seguridad primero por su naturaleza.

| # | Trabajo | Por qué va aquí |
|---|---|---|
| 1 | Registrar `PermissionsGuard` como `APP_GUARD` y declarar permisos en los 29 controladores sin ellos | Fallo de control de acceso en producción. No depende de nada más |
| 2 | Registrar en `CORE_TAB_DEFINITIONS` las ~35 rutas cuyas páginas ya funcionan | Convierte la mayor parte del producto de invisible en utilizable sin tocar lógica |
| 3 | Prueba que falle si un enlace del menú resuelve a `isFallback: true` | Impide que el punto 2 se deshaga |
| 4 | Corregir los 6 defectos de la Parte B.1 y el enlace `/invoices/list` | Funciones visibles que no pueden funcionar |
| 5 | Sustituir los datos falsos de `/overview` y de los 7 widgets del dashboard | Son las pantallas que el usuario sí ve; hoy muestran cifras inventadas |
| 6 | Cablear las 8 páginas cuyo endpoint ya existe (Parte E, punto 6) | Alto valor, esfuerzo bajo |
| 7 | Aplicar los veredictos de eliminación y fusión de C.2 y C.5 | Reduce superficie antes de invertir en lo que queda |
| 8 | Disolver `/masters` según C.4 | Corrige la causa de su tasa de mocks |
| 9 | Implementar las 11 secciones placeholder de Configuración | Deuda declarada, no oculta |
| 10 | Decidir con producto el destino de HCM, WMS, Manufacturing, Procurement y Projects | Decisión de negocio, no técnica |
| 11 | Módulo de compras y módulo de nómina | Productos completos; planificar aparte |
| 12 | Localización fiscal más allá de RD/EEUU | Condiciona la entrada a MX, CO y CL |

---

## Anexo — Qué no se pudo verificar

Honestamente delimitado, según la regla de no dar por hecho lo no comprobado:

- **No se ejecutaron las pruebas ni la aplicación**: `node_modules` no está instalado en este entorno. Todo lo anterior es análisis estático.
- **Los 149 endpoints sin llamador en el frontend** no son necesariamente código muerto. Se verificó y descartó como huérfanos los de redirección de navegador, el webhook de Stripe, el JWKS y la sonda de colas. Para el resto, **no se pudo comprobar** si hay crons, servicios internos o clientes externos: requiere revisar despliegue e integraciones.
- **`login.page.ts:136`**: si el despliegue sirve frontend y backend en el mismo origen, el login social funciona. No hay `proxy.conf.json` en el repositorio y **no se verificó** la configuración de producción.
- **El comportamiento exacto del router ante la ruta `documents` duplicada** se dedujo de las reglas de coincidencia de Angular, no de una ejecución. La duplicación en sí (líneas 243 y 333) sí está verificada.
- Las páginas marcadas «Renderiza: No» lo están por ausencia de patrón en el registry. **No se comprobó en navegador**; la cadena de evidencia (ausencia de `router-outlet`, resolución vía registry, `provideTabs` sin usar) es consistente y está citada para que pueda auditarse.
