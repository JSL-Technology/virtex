# Ficha — frontend-shell (plataforma del portal Angular)

Familia FE · 2026-11-07/08.

## 1. Identificación
- Alcance: `apps/core/client-web/src/app` — `core/` 182 archivos/19.534 l. (58 specs), `layout/` 9/1.621 l., `shared/` 116/8.752 l., `features/` 337/60.992 l. (133 specs, 34 carpetas); `app.routes.ts` (336 l.), `app.config.ts` (159 l.), registro de módulos y 8 manifiestos `core/modules/manifests/*.ts` (1.849 l., 155 rutas), pestañas/ventanas Dockview (`core/tabs/tab-state.service.ts` 787 l.), interceptores `core/interceptors/auth.interceptor.ts`, `step-up.interceptor.ts`, `core/services/error-handler.service.ts`, i18n cliente (`@virteex/shared/ui-i18n`).
- Pruebas: 239 suites / 1.294 tests verdes (log coordinador). Núcleo para vender: sí.

## 2. Estándar de referencia
(a) Básico: SPA con carga diferida por módulo, rutas profundas (deep links) estables, manejo de sesión/CSRF/refresh centralizado, errores de red traducidos y no silenciosos, estados vacío/cargando/error/sin permiso consistentes, i18n completa, accesibilidad WCAG 2.1 AA, presupuesto de rendimiento cumplido (LCP < 2,5 s; bundle inicial acotado), sin datos fijos en servicios. Avanzado: multiventana/pestañas con estado, PWA/offline, design system con tokens, feature flags/plan visibles en navegación. (b) Invariantes: la UI nunca es la autorización; la empresa activa de una pestaña no cambia en silencio; un enlace profundo lleva a la página que nombra. (c) Referencia: Dynamics 365 / NetSuite (navegación por áreas y multi-pestaña, deep links por registro — confianza media, conocimiento de producto); Angular style guide "folders-by-feature" y lazy loading (angular.dev, confianza alta). (d) Construcción: core = infraestructura transversal; cada feature dueña de su acceso a datos; shared = UI sin dominio.

## 3. Resultado
- **Madurez: 56 (50–62, confianza media)**. Preparación comercial: 55. **Veredicto: Piloto controlado** (sin compuerta crítica incumplida propia del shell; reservas en rendimiento, enlaces profundos y separación por feature).
- Eje más débil: 5 (separación: ~40 servicios de dominio en `core/api` + duplicados).
- Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 70 (62–76, media) | Humo: 119 rutas + 27 secciones sin error JS ni 5xx ni 404 (03-insumo-humo-ui-FE.md); búsqueda de datos fijos en services: solo catálogos legítimos (`PURCHASE_CATEGORIES`/`PAYMENT_FORMS` DGII en `core/services/accounts-payable.ts:221-245`, condicionados por country pack en `features/accounts-payable/form/form.page.ts:129-135`) | Catálogos fiscales servidos por el backend (country pack), no en el cliente |
| 2 Corrección | 55 (45–62, media) | Deep links con idioma pierden la ruta (`/es/invoices` → overview); `/settings/<id>` abre `#settings/e` (`core/guards/settings-modal-redirect.guard.ts:12-13`) | Corregir guard y matcher de idioma; pruebas de enlaces |
| 3 Multi-país | 55 (45–60, baja) | Country pack en cliente; respaldo DO: `supplierDocumentNumberKey ?? 'accounts_payable.form.ncf'` (`form.page.ts:129`) — sin pack, el formulario cae en NCF dominicano | Sin fallback de país; estado "país no soportado" |
| 4 Arquitectura | 58 (50–65, media) | Manifiesto único → router + menú + ventanas (`app.routes.ts:244-312`), lazy `load()` por ruta; zoneless + signals (`app.config.ts:62`); interceptores funcionales | — |
| 5 Higiene/separación | 42 (35–50, media) | 40 servicios de dominio en `core/api/` (accounting, payroll, purchasing, treasury, inventory…) + 15 en `core/services/` (invoices, journal-entries, einvoicing, chart-of-accounts…); duplicados: `core/api/journal-entries.service.ts` vs `core/services/journal-entries.ts`, `core/api/users.service.ts` vs `features/settings/data/users.service.ts`, `core/api/chart-of-accounts.service.ts` vs `core/services/chart-of-accounts.ts`; core importa de features (`core/services/regional-format.service.ts:7`, `core/state/chart-of-accounts.state.ts`, `core/api/*` 5 casos, `layout/main/main.layout.ts` 2) | Mover acceso a datos a cada feature; core sin dominio; regla de lint de fronteras en cliente |
| 6 Calidad | 50 (45–58, alta) | Lint client-web 480 warnings (178 unused-vars, 156 any, 146 non-null); 86 usos `any` explícitos fuera de specs; archivos grandes: `features/workflow/designer/workflow-designer.page.ts` 1.397 l., `core/services/auth.ts` 1.015 l., `features/accounts-payable/form/form.page.ts` 893 l., `features/invoices/new/new.page.ts` 884 l.; 9 TODO/FIXME, 2 supresiones | Partir componentes >500 l.; any → tipos de `shared-types` |
| 7 Rendimiento | 45 (38–55, media) | Build prod: initial **2,00 MB** vs budget 1,60 MB (sólo `maximumWarning`; `maximumError: 4mb` en `apps/core/client-web/project.json:79-80`); módulos CommonJS (exceljs en `features/invoices/detail/detail.page.ts`, elkjs, dagre, google-libphonenumber); humo: cada página de overview hace 13+ llamadas dashboard | Importación diferida de exceljs; budget error = 1,6 MB; medir LCP |
| 8 Seguridad | 62 (55–70, media) | Guards en cliente + servidor rechaza (member PATCH /organizations/profile → 403); CSP/HSTS en `public/serve.json`; empresa en la URL `/e/:org` (evita escribir en otra empresa desde otra pestaña, `app.routes.ts:276-287`) | — |
| 9 Pruebas | 62 (55–68, media) | 1.294 tests verdes; specs de guards/tenancy (`core/tenancy/active-organization.service.spec.ts`); ninguna cubre `settings-modal-redirect` con prefijo `/e/:org` | E2E de deep links |
| 10 Operabilidad | 45 (35–55, baja) | `error-handler.service.ts` global; no verificado envío de errores de cliente a backend con correlación | Telemetría de errores de cliente con request-id |
| 11 UX/i18n | 60 (52–66, media) | 0 claves sin resolver en 146 vistas; en/pt correctos; 390 px sin scroll horizontal (muestra 10); `lint:design-system` 75 comprobaciones OK + contraste 150 WCAG OK; `verify:form-a11y` 123 formularios OK; `verify:required-markers` 155 OK. Pero: identificador técnico del plan en pantalla («La función ai_collections no está incluida en tu plan») | Estado "no incluido en tu plan" con nombre comercial y CTA; ocultar/etiquetar en menú |
| 12 Competitividad | 55 (45–62, baja) | Multi-pestaña tipo escritorio (Dockview) y búsqueda global son comparables a D365; faltan pantallas para CRM, proyectos, manufactura, consolidación (ver navegacion) | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple (shell) | grep de datos fijos; humo |
| 2 Integridad | N/A | — |
| 3 AuthZ | Cumple en lo probado | member → /unauthorized; servidor 403 |
| 4 Validación servidor | N/A | — |
| 5 Humo sin 500/consola | **No cumple** | Errores de consola 403 en todas las páginas (`/ai/copilot/charts/pinned`), 13 en overview para member |
| 6 País | Parcial | fallback NCF |
| 7 Pruebas CI | No cumple (global: main rojo, ver ci-cd-infra) | — |
| 8 Auditoría | N/A | — |
| 9 Migraciones | N/A | — |
| 10 Observabilidad | No verificado | — |
| 11 UI/traducciones | Cumple con reservas | 0 claves; deep links rotos |
| 12 Documentación | Parcial | `docs/TAB_ARCHITECTURE.md`, `docs/ARQUITECTURA_UX_MODULAR.md` |

## 6. Hallazgos
- **FE-SH-01** · eje 5 · arquitectura/mezcla de contexto · **Alta** · `core/api/*.service.ts` (40), `core/services/{invoices,journal-entries,einvoicing,accounts-payable,chart-of-accounts,customer-receipts}.ts`. El acceso a datos de casi todos los dominios vive en `core`, con duplicados por dominio y `core` importando de `features`. Contradice la separación por feature que el propio manifiesto promete; extraer un módulo exige tocar core. Forma correcta: `features/<dominio>/data/*` como único dueño; core solo infraestructura. Deuda técnica. L.
- **FE-SH-02** · eje 2/11 · bug · **Media** · `core/guards/settings-modal-redirect.guard.ts:12-13`. Cualquier enlace a `/settings/<sección>` (marcadores, correos, notificaciones con ruta) abre `#settings/e`, porque el guard asume que la URL empieza por `/settings` pero corre bajo `/e/:org`. Reproducido en 27/27 secciones. Forma: leer el segmento desde `route` o quitar `/e/<org>`. S.
- **FE-SH-03** · eje 2 · bug · **Media** · matcher de idioma / `organizationRouteGuard`. `/es/invoices`, `/en/e/<org>/invoices` → overview, y `/en/` no cambia idioma: los enlaces localizados (los que usan las páginas públicas y los correos con prefijo) no llevan a la página. S–M.
- **FE-SH-04** · eje 7 · rendimiento · **Media** · `apps/core/client-web/project.json:79-80`. Bundle inicial 2,00 MB > 1,60 MB; el budget es solo aviso (error a 4 MB) → CI no lo frena. exceljs se importa estáticamente en `features/invoices/detail/detail.page.ts`. M.
- **FE-SH-05** · eje 11 · UX · **Media** · páginas `collections`, `inventory/predictions`, `reports/manager-report`, `reports/anomalies`, `accounting/treasury/cash-flow`, settings `sso`/`integrations`/`ai`. Funciones no incluidas en el plan aparecen en el menú, disparan peticiones 403 (errores de consola) y muestran la clave técnica (`ai_collections`, `ai_forecasting`) con un botón «Reintentar» inútil. S.
- **FE-SH-06** · eje 7/11 · robustez · **Media** · overview/dashboard. La página de inicio no conoce los permisos: para un miembro hace 13 peticiones 403 (`/dashboard/kpi/*`, `/dashboard/alerts`, `/accounting/current-period`) y registra `ERROR HttpErrorResponse`; para todos los admins `GET /ai/copilot/charts/pinned` → 403 en cada carga. S.
- **FE-SH-07** · eje 6 · calidad · **Baja** · componentes >800 l. (workflow-designer 1.397, auth.ts 1.015, AP form 893, invoice new 884, invoice detail 846) y 480 warnings. M.
- **FE-SH-08** · eje 3 · multi-país · **Baja** · `features/accounts-payable/form/form.page.ts:129` y `core/services/accounts-payable.ts:221-245`: catálogos DGII 606 en el cliente y fallback a etiqueta NCF cuando el pack no llegó. S.

## 7. Camino mínimo a producción
1. FE-SH-02/03 deep links (S). 2. FE-SH-05/06 permisos/plan en navegación e inicio (S). 3. Budget como error + exceljs diferido (M). 4. Plan de migración de `core/api` a features por dominio, empezando por los duplicados (L, retocar). Todos los países.

## 8. Camino a 100
Separación por feature (+10), rendimiento medido con LCP y budget (+8), E2E de navegación en CI (+6), telemetría de errores de cliente con correlación (+5), estados de plan/permiso coherentes (+5), reducción de any/warnings (+4).

## 9. Competitividad
Pestañas tipo escritorio, búsqueda global, multiempresa en URL: a la par de D365/NetSuite en concepto (confianza media). Falta de pantallas para CRM/proyectos/manufactura/consolidación pesa más (ficha navegacion-y-cobertura-ux).

## 10. Fortalezas
Manifiesto único (router+menú+ventanas); empresa en la URL; zoneless+signals; verificadores de design system, a11y y marcadores obligatorios en CI; i18n sin claves crudas en es/en/pt.

## 11. No verificado
LCP/TTI reales; composición del chunk inicial; envío de errores del cliente al servidor; modo offline/PWA; rutas con parámetro (36) por URL directa.
