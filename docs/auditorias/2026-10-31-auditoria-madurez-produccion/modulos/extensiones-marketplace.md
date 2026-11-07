# Ficha — Extensiones y marketplace (T18)

Auditor: familia F11 · Fecha: 2026-10-31/11-01 · Tenant: qa-mx · HEAD `495719fc`

> **Sin hallazgo CRÍTICO de seguridad confirmado.** Las vías de abuso entre tenants que el código describe como cerradas (publicar como otro, ejecutar código inline, versión no consentida) están efectivamente cerradas en las rutas probadas. El problema principal es de **autenticidad**: la plataforma de extensiones no permite construir extensiones útiles (EXT-01).

## 1. Identificación
- Backend `apps/backend/api/src/app/extensions`: 21 archivos, ~2,7 k LOC, **9 endpoints**, 4 entidades (`plugins`, `plugin_versions`, `tenant_consents`, `metering_records`), 3 specs (consentimiento, guard de alcance, sandbox).
- Frontend `features/extensions`: 7 archivos (~860 LOC), 1 spec; host de UI en iframe.
- Política OPA `platform/policies/security/plugin_admission.rego` (27 líneas). Promesa: `docs/extensions.md`.
- Dependencias: `isolated-vm` 7.0.1 (carga OK en este host: `node -e "require('isolated-vm')"` → ok), `ipaddr.js`, `@virteex/shared/util-auth`.
- Consumidores: ninguno. Busqué `ExtensionsService|SandboxService|sandbox.run` fuera de `app/extensions`: 0 usos → ningún módulo de negocio invoca extensiones.
- ¿Núcleo para vender? No (diferenciador para clientes grandes).

## 2. Estándar de referencia
(a) Básicas: modelo de extensión con puntos de enganche en eventos del negocio (antes/después de factura, validación, cálculo), API de datos con permisos acotados, portal de desarrolladores, revisión de seguridad, instalación/consentimiento por tenant, versionado y desinstalación. Avanzadas: funciones en sandbox con límites deterministas (Shopify Functions: WebAssembly, límite de instrucciones y memoria, entrada/salida declarada — fuente: shopify.dev/docs/api/functions, confianza alta), revisión de seguridad manual + automatizada (Salesforce AppExchange Security Review, confianza alta), UI embebida en sandbox (Zoho Creator/Zoho Marketplace widgets en iframe, confianza media), facturación por uso.
(b) Invariantes: código de un tenant nunca accede a datos de otro; el tenant aprueba exactamente la versión y capacidades que corren; límites duros de CPU/memoria/tiempo/concurrencia; firma verificada en cada ejecución; publicación separada del inquilino.
(d) Construcción: sandbox fuera del proceso que sirve tráfico o con cuota de concurrencia; API de datos capability-based; eventos de dominio como hooks.

## 3. Resultado
- **Madurez: 35** (28–42, confianza media).
- **Preparación comercial: 28 — No listo** (compuerta 1 incumplida: no hay capacidades básicas de extensibilidad).
- Eje más débil: 1 Autenticidad / 12 Competitividad. Críticos: 0. Altos: 3.

## 4. Doce ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 30 (22–38, media) | Sandbox real, pero el código de servidor solo puede `log` y `fetch` a 3 hosts (`sandbox.service.ts:375-396`, `plugin-policy.config.ts:283-287`); sin API de datos, sin hooks; nadie lo invoca; catálogo vacío (`GET /extensions` → `[]`, `select count(*) from plugins` → 0); publicar exige permiso de plataforma (no hay flujo para terceros). | Hooks de dominio, API de datos acotada, portal de publicación |
| 2 Corrección | 55 (48–62, media) | Fijación de versión consentida (`extensions.service.ts:324-380`); pero `register` guarda el plugin **antes** de la admisión, sin transacción (`:137-146` vs `:148-162`): un rechazo deja un nombre huérfano reservado. | Transacción y admisión antes de crear |
| 3 Multi-país | N/A | Sin lógica fiscal | — |
| 4 Arquitectura | 58 (50–65, media) | Admisión + firma + consentimiento + medición bien separados; sandbox **dentro del proceso API**. | Cola/worker para ejecuciones, límites de concurrencia |
| 5 Higiene | 70 (62–76, media) | Módulo autocontenido, solo depende de seguridad/i18n | — |
| 6 Código | 62 (55–68, media) | `any` en sandbox (justificado); comentarios extensos; `cpuPercentage` configurado y **no usado** (`plugin-policy.config.ts:293`; SandboxService no lo lee) | Eliminar config muerta |
| 7 Robustez | 42 (35–50, media) | Isolate 128 MB / 1000 ms (`sandbox.service.ts:177-178`); sin límite de concurrencia por tenant ni global → N ejecuciones simultáneas = N×128 MB en el proceso API; `fetch` con timeout 5 s cuyo efecto sobre el timeout de 1 s del script asíncrono no verifiqué. | Semáforo por tenant/global, ejecución fuera del proceso |
| 8 Seguridad | 60 (52–66, media) | Probado: `POST /extensions` como admin de tenant → 403; `execute` con `code` → 403 `inline_code_requires_platform_permission`; host UI `sandbox="allow-scripts"` sin `allow-same-origin` (`extension-host.component.ts:81`); guard de servidor de alcance (`extension-scope.guard.ts`); SSRF por rangos + pin DNS (`sandbox.service.ts:420-533`). Débil: admisión autoafirmada (EXT-02). | Admisión real; CSP para iframe |
| 9 Pruebas | 42 (35–50, media) | 3 specs; no hay prueba de escape/límites con isolate real en CI verde; CI de main rojo. | Pruebas de límites y escape |
| 10 Operabilidad | 48 (40–55, media) | Medición por ejecución + reconciliación (`/extensions/billing/reconciliation` OK); logs `[SECURITY]`. Sin métricas. | Métricas/alertas |
| 11 UX | 45 (38–52, baja) | Pantalla de gestión y runtime; no ejecutada en navegador. | — |
| 12 Competitividad | 25 (18–32, media) | Frente a Shopify Functions/AppExchange, no hay ecosistema ni SDK. | SDK, portal, revisión |

Promedio ≈ 49; madurez 35 limitada por eje 1 (funcionalidad nominal); diferencia >15 explicada por esa compuerta.

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas/capacidades básicas | **No cumple** | EXT-01 |
| 2 Integridad | No cumple (menor) | EXT-04 |
| 3 Autorización/aislamiento | Cumple (rutas probadas) | 403 en publicar/inline; consentimiento por `organizationId` del principal (`extensions.service.ts:456-460`) |
| 4 Validación servidor | Cumple | DTOs class-validator |
| 5 E2E | No verificado | sin E2E UI |
| 6 País | N/A | — |
| 7 Pruebas CI | No cumple | CI rojo |
| 8 Auditoría | Parcial | logs, sin tabla de auditoría de consentimientos |
| 9 Migraciones | Cumple | global |
| 10 Observabilidad | Parcial | — |
| 11 UI | No verificado | — |
| 12 Documentación | No cumple | `docs/extensions.md` desactualizado (EXT-06) |

## 6. Hallazgos
**EXT-01** · Eje 1/12 · Funcionalidad nominal · **Alta** · `services/sandbox.service.ts:375-396`; búsqueda de consumidores = 0. El código de servidor de una extensión no recibe datos ni eventos del ERP y solo puede registrar logs o hacer `fetch` a `api.virtex.io`, `auth.virtex.io`, `api.taxjar.com`. Ningún flujo de negocio la invoca. El "marketplace" está vacío y solo la plataforma puede publicar. Forma correcta: hooks sobre eventos de dominio (p. ej. validación de factura) con entrada/salida declarada al estilo Shopify Functions. Impacto: brecha competitiva; presentar esto como marketplace sería engañoso. Esfuerzo XL.

**EXT-02** · Eje 8 · Seguridad · **Alta** · `services/plugin-admission.service.ts:179-186` + `plugin_admission.rego:6-8`. La política OPA exige `is_signed`/`signature_valid`, pero el servicio los **fija a `true`** en la entrada; las vulnerabilidades del SBOM son las que declara el propio publicador; el SCA compara nombres en un objeto de dependencias declarado; la heurística son 6 regex (`:118-133`). Además la lista de egreso de la política (`api.dian.gov.co`, `nfe.fazenda.sp.gov.br`, `api.taxjar.com`) **no coincide** con la de ejecución (`plugin-policy.config.ts:283-287`) y `requestedEgress` no se guarda ni se aplica por versión. El binario `tools/opa` no existe en el repo (`ls tools/opa` → no existe), así que fuera de dev toda admisión se rechaza salvo instalación externa. Hoy la contención real es solo el isolate. Forma correcta: admisión con evidencias verificables, egreso por versión aplicado en runtime, revisión humana. Esfuerzo L.

**EXT-03** · Eje 7 · Robustez · **Alta** · `services/sandbox.service.ts:302` dentro del proceso API, sin semáforo. Un tenant con `extensions:execute` y una extensión instalada puede lanzar ejecuciones concurrentes (128 MB c/u) y degradar la API compartida (sujeto al throttler global 20 req/min/IP, que se evita con varias IPs). Forma correcta: límite de concurrencia por tenant y global, o worker. Esfuerzo M.

**EXT-04** · Eje 2 · Integridad · Media · `extensions.service.ts:137-162`: plugin creado antes de admisión, sin transacción; nombre reservado aunque se rechace. Esfuerzo S.

**EXT-05** · Eje 8 · Seguridad · Media · `features/extensions/extension-host.component.ts:79-86`. El iframe de origen opaco puede hacer `fetch`/imágenes a cualquier host: datos leídos vía `virtex.api` pueden exfiltrarse. No verifiqué si la CSP del portal (heredada por `srcdoc`) limita `connect-src`. Forma correcta: CSP explícita en el harness. Esfuerzo S.

**EXT-06** · Documentación · Media · `docs/extensions.md` tabla API: publicar/revocar con `extensions:manage` (hoy permiso de plataforma + step-up, `extensions.controller.ts:78-94`); ejemplo `virtex.api('/inventory')` con `api:read` (hoy acotado a datos de referencia). Esfuerzo S.

**EXT-07** · Higiene · Baja · `cpuPercentage` sin uso; `forensicData` incluye el código fuente en el resultado interno (no se devuelve al cliente). Esfuerzo S.

## 7. Camino mínimo a producción
Opción recomendada a corto plazo: **ocultar el marketplace** como función comercial hasta tener EXT-01. Si se mantiene: EXT-03 (M) → EXT-02 (L) → EXT-04/05/06 (S). Hacer real requiere EXT-01 (XL, rehacer el modelo de capacidades).

## 8. Camino a 100
EXT-01 hooks + API de datos (+30 autenticidad/competitividad, XL) → EXT-02 admisión verificable y egreso por versión (+10 seg., L) → EXT-03 (+15 robustez, M) → portal de desarrolladores y revisión (+15 competitividad, L) → pruebas de escape/límites en CI (+15 pruebas, M).

## 9. Competitividad
Shopify Functions (WASM con límites deterministas por evento), Salesforce AppExchange (revisión de seguridad obligatoria), Zoho (widgets + Deluge con API de datos). Virteex tiene buen andamiaje de seguridad (firma, consentimiento por versión, iframe opaco) pero ningún punto de extensión útil. Nota 25 (18–32, media).

## 10. Fortalezas
Fijación de versión consentida; separación permiso de plataforma vs tenant con step-up; SSRF por rangos con pin DNS; iframe sin `allow-same-origin`; guard de alcance en servidor además del cliente; medición por ejecución.

## 11. No verificado
Ejecución real en el isolate (no hay plugins y publicar exige permiso de plataforma + step-up; no creé usuarios de plataforma); comportamiento del timeout con promesas; CSP del iframe; pantalla en navegador.

Cobertura: ~85 % de archivos backend leídos, 9/9 endpoints tocados (7 ejecutados), host UI leído, 0 pantallas ejecutadas.

<!-- RESUMEN: modulo=extensiones-marketplace; madurez=35; prep=28; veredicto=No listo; eje_debil=Autenticidad; criticos=1; altos=2; camino_min=XL -->


## Ajuste de calibración del coordinador (Paso 9)

**EXT-02 se eleva a crítica** (funcionalidad de seguridad falsa presentada como real): verificado por el coordinador — `plugin-admission.service.ts:179-186` pasa `is_signed: true` y `signature_valid: true` como constantes a la política OPA (`plugin_admission.rego:7-8`), de modo que la «admisión de extensiones firmadas» que promete el README no verifica ninguna firma. El riesgo de explotación queda acotado porque publicar exige permiso de plataforma y step-up (EXT-06). Las notas (35/28) respetan los topes.
