# Shell del portal y sistema de diseño (T21) — familia F2

> Auditoría 2026-10-31/11-01. Diagnóstico sin cambios en el repo. Recorrido con Playwright (Chromium headless) el 2026-10-31 18:36–18:41 con qa-a: login por UI + visita de las **77 rutas** del menú (8 módulos del rail). Capturas y resultado en `scratchpad/f2/` (`01-login.png`, `02-home.png`, `nav-0*.png`, `nav-result.json`; script `scratchpad/f2/pw/nav2.js`). El portal no estaba levantado en la última reanudación, por lo que no se repitió.

**Sin hallazgo crítico de seguridad.**

## 1. Identificación
- `apps/core/client-web/src/app/core` (api, auth, components, data, errors, guards [auth, permissions, country, language, public, settings-modal-redirect], http [idempotency-key, read-blob-error], interceptors [auth, step-up], i18n, modules/manifests [8 manifiestos: workspace, ventas, compras, inventario, tesorería, contabilidad, rrhh, análisis — 155 cargas diferidas `loadComponent/import()`], navigation, tenancy, state, tabs, windows, keyboard), `layout`, `shared`; 34 features, 161 `*.page.ts`. Tests: client-web 238 suites / 1280 tests OK (`logs/nx-all.log`).
- Bundle de producción `dist/apps/core/client-web/browser`: 22 MB en disco, 359 chunks JS; inicial **1,78 MB** (389 kB transferidos) frente a presupuesto `maximumWarning 1.6mb` / `maximumError 4mb` (`apps/core/client-web/project.json:74-85`) → aviso del build; mayores chunks diferidos 2,3 MB y 1,46 MB.
- Países: N/A (i18n verificado por `i18n:verify` OK).

## 2. Estándar de referencia
- (a) Básico: shell con navegación por módulo filtrada por permisos/plan, guardas en cliente coherentes con el servidor, manejo central de errores HTTP (401 refresco, 403 explicado, 429 con Retry-After, 5xx con id de correlación), estados vacío/carga/error en todas las pantallas, accesibilidad WCAG 2.1 AA, carga diferida y presupuesto de bundle respetado, E2E de flujos principales en CI. Avanzado: pestañas/ventanas de trabajo, paleta de comandos, atajos, modo oscuro, offline/PWA.
- (c) Referencias: SAP Fiori Design Guidelines y Microsoft Fluent (patrones de estados vacíos/errores — confianza alta); WCAG 2.1 AA (W3C, confianza alta); Angular budgets/lazy loading (docs Angular, confianza alta); Odoo 17 web client (confianza media).
- (d) Construcción: manifiestos de módulo declarativos (rutas + menú + permisos), interceptores encadenados, componentes de diseño compartidos con a11y incorporada.

## 3. Resultado
- **Madurez: 62 (55–68, confianza media)** · **Preparación: 60 — Piloto controlado** (compuerta 7 —E2E en CI— no cumple; a11y incompleta).
- Eje más débil: Pruebas E2E y accesibilidad.
- Críticos: 0. Altos: 2.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 Completitud | 68 (60–74, media) | 77 rutas del menú cargan con contenido (todas con texto > 300 caracteres); shell con pestañas, selector de empresa, buscador, campana, modo oscuro, estado de periodo (captura `02-home.png`) | Ocultar entradas no incluidas en el plan (SHL-02) |
| 2 Corrección | 66 (58–72, media) | 0 respuestas 5xx y 0 `pageerror` en 77 rutas; 12 respuestas 403 en 7 rutas | SHL-02 |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 70 (62–76, media) | Manifiestos declarativos por módulo con carga diferida; `ErrorHandlerService` central que entiende `Retry-After` (`core/services/error-handler.service.ts:86-101`); interceptor de step-up | — |
| 5 Higiene | 62 (55–68, media) | 469 warnings de lint en client-web (`logs/nx-all.log`); `core/` muy amplio (27 subcarpetas) | — |
| 6 Calidad | 62 (55–68, media) | 9 TODO/FIXME en frontend (ENTORNO) | — |
| 7 Rendimiento | 55 (48–62, media) | Inicial 1,78 MB > 1,6 MB (SHL-03); chunks diferidos de 2,3 MB | Dividir dependencias pesadas |
| 8 Seguridad | 70 (62–76, media) | Cookies httpOnly + CSRF doble; guardas de permiso; claves cliente en `environments/environment.ts` (reCAPTCHA siteKey público, API key Google Maps de cliente — restringir por referrer; no copiadas) | Verificar restricción de la key |
| 9 Pruebas | 45 (38–52, media) | Unitarias abundantes; **sin E2E de UI en CI** (no hay suite Playwright/Cypress en `ci.yml`; arnés en `docs/qa/harness` fuera de CI, no leído) | E2E de login + flujos principales |
| 10 Operabilidad | 50 (42–58, baja) | Errores HTTP sin id de correlación (ver OBS-01) | — |
| 11 UX | 58 (50–65, media) | Diseño limpio y consistente; `verify:form-a11y` FALLA (SHL-01); componentes de estado vacío en sólo 12 de 34 features (grep `empty-state|EmptyState|vx-empty`) | a11y AA, estados vacíos uniformes |
| 12 Competitividad | 62 (55–70, baja) | Pestañas de trabajo y "Mi trabajo" comparables a Odoo/D365 | Paleta de comandos, móvil |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple | pantallas con datos reales (facturas, asientos, vencimientos de qa-a en `02-home.png`) |
| 2 | N/A | — |
| 3 | Cumple con reservas | guardas cliente + servidor; menú no filtrado por plan |
| 4 | N/A | — |
| 5 | Cumple con reservas | 0 × 5xx/pageerror en 77 rutas; 12 × 403 con error de consola |
| 6 | N/A | — |
| 7 | **No cumple** | sin E2E de UI en CI |
| 8 | N/A | — |
| 9 | N/A | — |
| 10 | Parcial | — |
| 11 | No cumple | a11y (SHL-01) |
| 12 | Parcial | — |

## 6. Hallazgos
**SHL-01** — Alta — UX/accesibilidad — `npm run verify:form-a11y` falla: 31 componentes listados en `logs/verify:form-a11y.log` (21 formularios según el coordinador; mi conteo de rutas listadas: 31 líneas, incluye POS) sin `VX_FORM_A11Y` (sin `aria-invalid` en controles inválidos), p. ej. `features/settings/system/security/security.page.ts`, `features/settings/system/smtp/smtp.page.ts`. El verificador no está en CI. Forma correcta: añadirlo a CI y corregir. Impacto: bloquea ventas a sector público/grandes cuentas con requisitos de accesibilidad. Esfuerzo: S–M.

**SHL-02** — Media — UX/corrección — entradas de menú visibles cuyos endpoints responden 403 a un ADMINISTRATOR (`permissions:["*"]`), probablemente por plan/entitlement: `/ai/copilot/charts/pinned` (en cada carga de Inicio), `/collections/worklist?limit=200` (Cobranza), `/ai/forecasts/*` (Predicciones de inventario), `/ai/cashflow*` (Flujo de caja), `/ai/reports/manager`, `/ai/anomalies*`. Cada uno genera un error de consola; el usuario ve pantallas parcialmente vacías en lugar de una invitación a ampliar plan. Forma correcta: filtrar el manifiesto por entitlements y tratar 403 de plan con un estado específico. Esfuerzo: S.

**SHL-03** — Media — rendimiento — bundle inicial 1,78 MB > presupuesto 1,6 MB (aviso del build en `logs/nx-all.log`); el presupuesto de error (4 MB) es tan laxo que no frena regresiones. Esfuerzo: M.

**SHL-04** — Alta — pruebas — no hay E2E de UI en CI; los flujos principales (login, emitir factura, contabilizar) sólo se prueban a nivel unitario/API. Esfuerzo: M.

**SHL-05** — Media — UX — estados vacíos no uniformes (12/34 features usan el componente de estado vacío). No verificado pantalla a pantalla.

**SHL-06** — Baja — `ERR_TUNNEL_CONNECTION_FAILED` en login: recurso externo (Google Maps/reCAPTCHA) bloqueado por el proxy del entorno; no imputable al producto, pero el login depende de un tercero externo.

## 7. Camino mínimo a producción
SHL-04 E2E de humo en CI (M); SHL-01 a11y + verificador en CI (S–M); SHL-02 menú por plan (S).

## 8. Camino a 100
E2E (+10); a11y AA con auditoría axe en CI (+8); bundle (+5); estados vacíos/errores con correlación (+5); móvil/responsive verificado (+5); paleta de comandos (+3).

## 9. Competitividad
Shell moderno (pestañas, "Mi trabajo", modo oscuro) a la altura de Odoo 17 y por encima de varios locales (Alegra, Siigo — confianza baja, no verificado). Brecha: app móvil nativa / responsive verificada.

## 10. Fortalezas
Manifiestos declarativos con carga diferida; manejo central de errores con `Retry-After`; claves de idempotencia en cliente para operaciones de dinero (`core/services/invoices.ts:347,371`); 0 errores de ejecución en 77 rutas.

## 11. No verificado
Formularios (crear/editar) por UI; responsive/móvil; lectores de pantalla; rendimiento real (Lighthouse).
Cobertura: 77/77 rutas de menú visitadas (sólo carga); ~10 % de archivos de `core` leídos.

<!-- RESUMEN: modulo=shell-portal-y-diseno; madurez=62; prep=60; veredicto=Piloto controlado; eje_debil=Pruebas y verificabilidad; criticos=0; altos=2; camino_min=M -->
