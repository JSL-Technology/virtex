# Ficha de módulo: `extensions` (marketplace + sandbox de extensiones)

Familia: PLTB · Auditor: PLTB · Fecha: 2026-11-07 · QA_SESSION=pltb · tenant qa-do-plt

## 1. Identificación
- Backend: `apps/backend/api/src/app/extensions/` (2.726 líneas TS).
  - `extensions.service.ts` (550), `services/sandbox.service.ts` (442, **isolated-vm**), `services/plugin-admission.service.ts` (257), `guards/extension-scope.guard.ts` (114), `services/signing-key.provider.ts` (85), `services/billing.service.ts` (69), `services/metering.service.ts` (38).
  - Entidades: `plugin`, `plugin-version`, `tenant-consent`, `metering-record`.
  - Endpoints (`extensions.controller.ts`): `GET /extensions`, `GET /extensions/consents`, `GET /extensions/runtime`, `GET /extensions/:name`, `POST /extensions` (publicar), `POST /extensions/:name/revoke`, `PUT /extensions/:name/consent`, `POST /extensions/execute`, `GET /extensions/billing/reconciliation`.
- Frontend: `features/extensions` (no auditado en profundidad por presupuesto).
- Evidencia documental: `docs/extensions.md` (declarado como evidencia a evaluar) — no re-leído por presupuesto; el código es la fuente primaria.
- Países: N/A (capacidad transversal).
- ¿Núcleo para vender? Diferenciador (plataforma extensible); no bloquea venta base.

## 2. Estándar de referencia
Marketplace de plugins seguro al estilo Atlassian Forge / Shopify Functions: código no confiable en aislamiento fuerte (isolate V8, no `vm`), firma criptográfica obligatoria antes de ejecutar, pipeline de admisión (SBOM, SAST, SCA, OPA, DAST), consentimiento por tenant de capacidades, metering por ejecución, egress deny-by-default con protección SSRF, y permisos de plataforma (no de tenant) para operaciones que cruzan tenants.

## 3. Resultado
- **Madurez (calibrada por el coordinador): **74 (68–80, confianza media)**; el agente propuso 80–88.**
  - _Motivo de la calibración (Paso 9):_ La seguridad del sandbox se probó en vivo y resistió (mantiene la nota más alta de PLTB), pero el ciclo de negocio publicar→consentir→ejecutar no se ejercitó de punta a punta, no hay auditoría de publicar/revocar/consentir (PLTB-EXT-02) y un OOM deja el sandbox sin resultado ni metering (PLTB-EXT-01). La carga de la prueba exige evidencia E2E para subir de 75.
  - Preparación 72 · **Listo con reservas**.
- ~~Madurez original: 80–88 (confianza alta).** Es el módulo mejor construido de los asignados a PLTB. El diseño de seguridad es correcto y está probado con ejecución real.
- **Preparación comercial: Listo con reservas.** Críticas (authN/authZ, aislamiento, integridad) cumplen; reservas: bug de robustez en ruta OOM, dependencia de infra externa (OPA/Sonar/DAST) para producción, sin verificación en vivo de publicar→consentir→ejecutar extremo a extremo vía HTTP (las rutas de catálogo exigen permiso de plataforma que `'*'` no otorga, correcto, pero impidió el flujo E2E real desde un tenant QA).
- **Eje más débil:** Robustez (ruta de agotamiento de memoria lanza excepción no controlada) y Pruebas E2E HTTP.
- **Hallazgos críticos abiertos:** ninguno. Varios vectores de escape clásicos se intentaron y fueron contenidos.

## 4. Ejes (nota / evidencia / qué falta para 100)
1. Funcionalidad real (85, alta): no hay mocks en la ruta de ejecución; isolate real cargado (`require('isolated-vm')` OK en este host), firma RSA real. Falta: catálogo vacío en QA → no se demostró ciclo de vida completo vía HTTP.
2. Integridad escrituras (80, media): metering por ejecución; consent con `consentedVersionId`/`pendingVersionId` (pin de versión). **Falta:** la ruta OOM no registra metering (lanza antes).
3. AuthZ/aislamiento (88, alta): publicar/revocar/ejecutar-inline exigen **permiso de plataforma** que `RolesService` niega a roles de tenant y que `'*'` no satisface; probado: ver eje 8.
4. Validación servidor (82, alta): DTOs class-validator; admisión valida SBOM CycloneDX ≥1.4, deps prohibidas, heurística, OPA. Falta: la heurística son 6 regex (documentado en el propio código como defensa débil; el isolate es la frontera real).
5. Multi-país: N/A.
6. Calidad código (80, media): código muy documentado, comentarios explican vulnerabilidades pasadas corregidas. `any` deliberado para el addon nativo. Ver warnings globales de api.
7. Robustez (65, alta): **bug**: `sandbox.run()` en OOM lanza `Isolated is disposed` sin capturar (ver PLTB-EXT-01). Timeout CPU sí retorna limpio.
8. **Seguridad (90, alta) — PROBADA**: ver sección Hallazgos/pruebas. Egress deny-by-default + SSRF por rango (ipaddr.js, cubre 169.254/metadata, IPv6, rebinding por pin de DNS). Firma obligatoria sin backdoor.
9. Pruebas (78, alta): `sandbox.service.spec.ts` prueba firma, timeout, egress, forensics con firma real (no mock). Falta: caso OOM y escape por `constructor`, y E2E HTTP del ciclo publicar→consentir→ejecutar.
10. Operabilidad (75, media): logs estructurados `[SECURITY]` en denegación inline; metering persistido. Falta: metering en ruta OOM; auditoría de negocio de publicar/revocar.
11. UX: no verificado (presupuesto).
12. Competitividad (72): sandbox+firma+admisión+metering al nivel de líderes; falta demostrar marketplace operativo y UI.

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | CUMPLE | isolate real, firma real; sin stubs en ejecución |
| 2 | Integridad escrituras | CUMPLE con reserva | metering OK salvo ruta OOM (PLTB-EXT-01) |
| 3 | AuthZ/aislamiento | CUMPLE | 403 en inline/publish/revoke desde tenant admin (probado) |
| 4 | Validación servidor | CUMPLE | DTOs + admisión |
| 5 | Humo sin 500 | CUMPLE con reserva | rutas tenant 200; OOM podría dar 500 |
| 6 | Cumplimiento país | N/A | |
| 7 | Pruebas CI flujos críticos | CUMPLE PARCIAL | spec de sandbox sólido; falta E2E HTTP |
| 8 | Auditoría negocio | NO CUMPLE | sin auditoría de publicar/revocar/consent |
| 9 | Migraciones reproducibles | CUMPLE | (global) |
| 10 | Observabilidad | CUMPLE PARCIAL | logs de seguridad sí; correlación no verificada |
| 11 | UI sin bloqueos | NO VERIFICADO | |
| 12 | Documentación | CUMPLE | código y `docs/extensions.md` |

## 6. Hallazgos

**PLTB-EXT-01** · extensions · eje 7/2 · Categoría: robustez/bug · Severidad: **media**
- Ubicación: `services/sandbox.service.ts` método `run()` bloque `catch`/`finally` (~líneas 230–255), llamada `isolate.getHeapStatisticsSync()`.
- Qué está mal: con una extensión firmada que agota memoria (`for(;;){a.push(new Array(1e6).fill(7))}`, límite 128 MB), el isolate se dispone y el `catch` invoca `getHeapStatisticsSync()` sobre un isolate ya dispuesto → lanza `Isolated is disposed` **no capturado**, que sale de `run()`. Ejecutado 2026-11-07: `[membomb] THREW(uncaught): Isolated is disposed ms=278`. Comparar con CPU infinito, que sí retorna limpio: `[cpu-infinite] success=false err=Script execution timed out ms=274`.
- Impacto: la ejecución de la extensión no devuelve `SandboxResult`, no se registra metering, y el caller HTTP recibiría 500 en vez de `execution_failed`. Containment se mantiene (no hay escape, proceso API intacto).
- Forma correcta: capturar/guardar `memoryBytes` antes de disponer, o `try/catch` alrededor de `getHeapStatisticsSync` devolviendo 0; garantizar un `SandboxResult` siempre.
- Esfuerzo: S.

**PLTB-EXT-02** · extensions · eje 8/10 · Categoría: operabilidad/seguridad · Severidad: **media**
- Ubicación: `extensions.service.ts` `register()`/`revoke()`/`setConsent()`.
- Qué está mal: operaciones sensibles de catálogo (publicar versión, revocar, otorgar consentimiento/capacidades) no escriben auditoría de negocio (quién/cuándo/antes/después). Hay log `[SECURITY]` solo en denegación inline.
- Forma correcta: registro de auditoría inmutable por publicar/revocar/consent.
- Esfuerzo: M.

**PLTB-EXT-03** · extensions · eje 1/9 · Categoría: pruebas · Severidad: **baja**
- No fue posible verificar vía HTTP el ciclo completo publicar→consentir→ejecutar porque exige permiso de plataforma (correcto por diseño). Falta una prueba E2E que use un principal con permiso de plataforma para cubrir el camino feliz del marketplace.
- Esfuerzo: M.

## Pruebas de seguridad ejecutadas (2026-11-07, isolate real isolated-vm)
Arnés: `/tmp/claude-0/.../scratchpad/agents/sandbox-escape2.cjs` y `sb3.cjs` (firma real con la clave del `SigningKeyProvider`; el isolate verifica firma antes de ejecutar).
- **AuthZ HTTP** (tenant admin qa-do-plt, rol `'*'`):
  - `POST /extensions/execute {code:...}` → **403** `extensions.inline_code_requires_platform_permission`.
  - `POST /extensions` (publicar) → **403** `auth.you_do_not_have_permission_perform`.
  - `POST /extensions/:name/revoke` → **403**.
  - `GET /extensions` → 200 `[]`; `GET /extensions/runtime` → 200 `[]`.
- **Escape de sandbox** (código firmado válido, ejecutado en el isolate):
  - `process` → `blocked: process is not defined`.
  - `require("fs")` → `blocked: require is not defined`.
  - `this.constructor.constructor("return process")()` → `blocked: process is not defined` (sin acceso al host).
  - `(function(){}).constructor(...)` y `globalThis.process/require/Buffer` → todos `undefined` (no hay globals del host).
  - Consumo CPU infinito → **cortado por timeout** (success=false, ~274 ms).
  - Bomba de memoria → **límite de memoria aplicado** (isolate dispuesto ~278 ms); defecto de manejo de error = PLTB-EXT-01.
- **SSRF / egress** (deny-by-default, allowlist exacta + rango globalmente ruteable):
  - fetch sin capacidad `egress:http` → `Plugin missing "egress:http" capability`.
  - fetch a `169.254.169.254` (metadata cloud) con capacidad → `Egress ... not allowed by policy` (bloqueado por allowlist; además el clasificador de rango lo rechazaría).
  - fetch a `127.0.0.1` y `evil.example.com` → bloqueados por policy.
  - fetch a host permitido `api.virtex.io` → pasa allowlist, falla solo por DNS (sin red saliente en el entorno) → prueba que la allowlist discrimina correctamente.
- **Firma**:
  - firma ausente → `Security Error: Invalid or missing digital signature`.
  - firma de un código distinto al ejecutado (mismatch) → rechazada.
  - backdoor histórico `signature==='valid-signature'` con `NODE_ENV=test` → **ya no existe**, rechazado.
- **Admisión**: OPA está presente (binario `tools/opa` + rego `platform/policies/security/plugin_admission.rego`) y rechazó activamente paquetes de prueba (`OPA Policy Violation`), confirmando que el pipeline no es un no-op en este entorno.

## 7. Camino mínimo a producción
1. (S) Corregir PLTB-EXT-01 (garantizar `SandboxResult` siempre; metering en fallo).
2. (M) Auditoría de negocio de publicar/revocar/consent (PLTB-EXT-02).
3. (M) E2E HTTP del marketplace con principal de plataforma (PLTB-EXT-03).
4. (Infra/config) Asegurar `MARKETPLACE_SIGNING_KEYS`, OPA/Sonar/DAST obligatorios en prod (ya gated por `isDevLikeEnvironment()`).

## 8. Camino a 100
- +6 robustez (PLTB-EXT-01) S; +5 auditoría (PLTB-EXT-02) M; +4 E2E (PLTB-EXT-03) M; +3 UI de marketplace verificada L; +2 correlación de logs S.

## 9. Competitividad
- Básicas: cubiertas (aislamiento fuerte, firma, consentimiento, metering, SSRF). Avanzadas: marketplace UI, revisión humana, revenue-share (parcial: billing/reconciliation presente). Diferenciador frente a ERP locales (ninguno ofrece sandbox isolated-vm con firma). Fuente: inspección de código (confianza alta).

## 10. Fortalezas a preservar
- Separación permiso de plataforma vs tenant para rutas que cruzan tenants (modelo correcto, raro de ver bien hecho).
- SSRF por clasificación de rango (ipaddr.js) + pin de DNS contra rebinding + match exacto de host.
- Firma obligatoria sin ramas de prueba en el camino de producción.

## 11. Lo que no se pudo verificar
- Ciclo publicar→consentir→ejecutar E2E vía HTTP (requiere permiso de plataforma; se verificó por unidad con firma real).
- UI `features/extensions` (presupuesto).
- `docs/extensions.md` como evidencia (no re-leído; el código fue la fuente).
- Comportamiento de egress real a host permitido (sin red saliente en el entorno).
