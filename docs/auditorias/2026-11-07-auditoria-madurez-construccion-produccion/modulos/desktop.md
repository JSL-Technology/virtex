# Ficha de módulo: `desktop` (aplicación Electron)

Familia: PLTB · Auditor: PLTB · Fecha: 2026-11-07 · QA_SESSION=pltb

## 1. Identificación
- Código: `apps/desktop/src/` — `main.js`, `preload.js`, `security-policy.js`, `security-policy.test.js`, `i18n/`.
- Empaquetado: `apps/desktop/electron-builder.json` (appId `io.virtex.desktop`; targets mac dmg, win nsis, linux AppImage).
- Verificación: `npm run verify:desktop-policy` → `node --test apps/desktop/src/security-policy.test.js` (parte de `verify:security`).
- Electron: `^44.4.5` (root `package.json`).
- La app es un **shell** que carga el portal web remoto (`DESKTOP_PORTAL_URL` / `DESKTOP_POS_URL`), con preload estrecho; no reimplementa lógica de negocio.
- Países: N/A. ¿Núcleo para vender? Complemento (acceso de escritorio); no bloquea venta base.

## 2. Estándar de referencia
Checklist de seguridad de Electron (OWASP/Electron docs): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload mínimo, bloqueo de navegación fuera de origen (`will-navigate`/`will-redirect`), `setWindowOpenHandler` denegando por defecto, manejadores de permisos (cámara/micrófono/geo) deny-by-default, CSP, solo HTTPS, Electron en versión sin vulnerabilidades conocidas, y **firma de código + actualizaciones firmadas**.

## 3. Resultado
- **Madurez (calibrada por el coordinador): **58 (50–65, confianza media-alta)**; el agente propuso 68–78.**
  - _Motivo de la calibración (Paso 9):_ Runtime seguro y probado (5/5), pero Electron con vulnerabilidad alta (≤44.9.0), binarios sin firma de código y sin auto-actualización (PLTB-DT-01/02): no se puede distribuir a clientes de forma segura ni parchear. Para un producto vendible esto es básico.
  - Preparación 50 · **Piloto controlado** (solo distribución interna).
- ~~Madurez original: 68–78 (confianza alta en lo revisado).** La **postura de seguridad del runtime es correcta y está probada** (test 5/5). Las carencias están en la cadena de suministro/distribución: Electron vulnerable, sin firma de código, sin mecanismo de actualización, y sin CSP forzada por el shell.
- **Preparación comercial: Listo con reservas (Piloto para distribución masiva).** El runtime es seguro; distribuir binarios **sin firmar** y con Electron vulnerable es la reserva que bloquea un despliegue amplio.
- **Eje más débil:** Operabilidad/seguridad de distribución (firma, actualizaciones, versión de Electron).
- **Hallazgos críticos abiertos:** ninguno en runtime; PLTB-DT-01 (Electron vulnerable) es alto.

## 4. Ejes (nota / evidencia / qué falta para 100)
1. Funcionalidad real (78, alta): shell real que carga el portal; menú, idioma desde `localStorage`, ventanas.
2. Integridad: N/A (sin estado propio).
3. AuthZ/aislamiento (N/A backend): la autorización vive en el portal web; el shell no la altera.
4. Validación (85, alta): `resolveTargets` exige HTTPS en build empaquetado y rechaza `file:`/http (probado por el test).
5. Multi-país: idioma del menú sincronizado con el portal (`vx-language`).
6. Calidad (80, alta): `security-policy.js` separado y testeado; comentarios claros.
7. Robustez: N/A mayormente.
8. **Seguridad runtime (88, alta) — PROBADA**: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload estrecho (`main.js:116-119`); `will-navigate` + `will-redirect` guard; `setWindowOpenHandler` deny; `setPermissionRequestHandler`/`setPermissionCheckHandler` deny-by-default a orígenes de confianza; confianza por **origen exacto** (rechaza `app.virtex.io.evil.example`, `http://`, `data:`, `javascript:`, `file:`). `verify:desktop-policy` → **5/5 pass**.
   - **Falta:** no se fuerza **CSP** desde el shell (`onHeadersReceived`/`Content-Security-Policy` ausentes) — se depende de las cabeceras del portal remoto (PLTB-DT-03).
9. Pruebas (80, alta): `security-policy.test.js` cubre navegación externa, HTTPS en build, origen exacto, permisos. Falta: prueba de que `BrowserWindow` se crea con los flags correctos (hoy el test cubre `security-policy.js`, no `main.js`).
10. **Operabilidad/distribución (45, alta) — DÉBIL**: **sin firma de código** (`electron-builder.json` no define identidad mac/notarización ni certificado win) → Gatekeeper/SmartScreen; **sin actualizaciones** (no hay `autoUpdater`/`electron-updater` en el repo) → PLTB-DT-02.
11. UX: menú/idioma; no auditado a fondo.
12. Competitividad (65): tener app de escritorio es un plus; sin firma/actualización queda por debajo de competidores con instaladores firmados y auto-update.

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | CUMPLE | shell real |
| 2 | Integridad | N/A | |
| 3 | AuthZ/aislamiento | CUMPLE (runtime) | flags de seguridad + guards (probado) |
| 4 | Validación servidor | CUMPLE | HTTPS-only en build (test) |
| 5 | Humo sin 500 | NO VERIFICADO en vivo | no se empaquetó/lanzó binario (presupuesto) |
| 6 | País | N/A | |
| 7 | Pruebas CI | CUMPLE PARCIAL | policy test 5/5; falta test de flags de main.js |
| 8 | Auditoría | N/A | |
| 9 | Migraciones | N/A | |
| 10 | Observabilidad/distribución | **NO CUMPLE** | sin firma ni auto-update (PLTB-DT-02) |
| 11 | UI sin bloqueos | NO VERIFICADO | |
| 12 | Documentación | CUMPLE PARCIAL | `apps/desktop/README.md` |

## 6. Hallazgos

**PLTB-DT-01** · desktop · eje 8 · Categoría: seguridad/dependencias · Severidad: **alta**
- Ubicación: `package.json` `"electron": "^44.4.5"`.
- Qué está mal: `npm audit` reporta Electron **high** en rango `44.0.0-alpha.1 - 44.9.0` — mitigación de certificados intermedios eMudhra comprometidos (high) y atribución de permiso pointer-lock a marco equivocado (moderate). Fix disponible (≥44.9.0).
- Forma correcta: subir Electron a ≥44.9.0 y fijar versión (no `^`) para builds reproducibles.
- Impacto: riesgo de seguridad en el cliente distribuido.
- Esfuerzo: S.

**PLTB-DT-02** · desktop · eje 10 · Categoría: operabilidad/seguridad · Severidad: **alta**
- Ubicación: `apps/desktop/electron-builder.json` (sin firma) y ausencia de `autoUpdater`/`electron-updater` en `apps/desktop/src/`.
- Qué está mal: los binarios se empaquetan **sin firma de código** (ni identidad/notarización mac ni certificado win) y **no hay mecanismo de actualización**. Distribuir así provoca advertencias de Gatekeeper/SmartScreen y deja a los usuarios en versiones vulnerables sin camino de parcheo (agrava PLTB-DT-01).
- Forma correcta: firmar y notarizar (configurar `mac.identity`/`afterSign` y `win` con certificado vía variables CSC), y añadir actualizaciones firmadas (`electron-updater` con canal y verificación de firma).
- Impacto: bloquea distribución masiva confiable.
- Esfuerzo: M (firma) / M-L (auto-update).

**PLTB-DT-03** · desktop · eje 8 · Categoría: seguridad · Severidad: **media**
- Ubicación: `apps/desktop/src/main.js` (sin `session...onHeadersReceived` con `Content-Security-Policy`).
- Qué está mal: el shell no fuerza una CSP; depende de que el portal remoto envíe sus cabeceras. Un shell de escritorio debería imponer una CSP de defensa en profundidad.
- Forma correcta: inyectar CSP vía `onHeadersReceived` (o verificar que el portal la envía y documentarlo).
- Esfuerzo: S.

**PLTB-DT-04** · desktop · eje 9 · Categoría: pruebas · Severidad: baja
- El test valida `security-policy.js` pero no comprueba que `createWindow` instancie `BrowserWindow` con `contextIsolation/nodeIntegration/sandbox` correctos. Añadir una aserción sobre los `webPreferences` reales.
- Esfuerzo: S.

## Pruebas ejecutadas (2026-11-07)
- `node --test apps/desktop/src/security-policy.test.js` → **5 tests, 5 pass** (navegación externa solo https/mailto; build empaquetado exige https; origen exacto; permisos).
- Lectura de `main.js`: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload estrecho (líneas 116-119); `will-navigate`+`will-redirect` guard (144-146); `setWindowOpenHandler` deny (147-151); `setPermissionRequestHandler`/`setPermissionCheckHandler` deny-by-default (257-263).
- `electron-builder.json`: sin bloque de firma; grep `autoUpdater|electron-updater` en `apps/desktop/src/*.js` → sin resultados.
- `npm audit` (log global): electron high, fix disponible.
- No se empaquetó ni lanzó un binario (presupuesto; evita red/firma externas).

## 7. Camino mínimo a producción
1. (S) Subir Electron ≥44.9.0 y fijar versión (PLTB-DT-01).
2. (M) Firma de código + notarización (PLTB-DT-02).
3. (M-L) Actualizaciones firmadas con `electron-updater` (PLTB-DT-02).
4. (S) CSP forzada por el shell (PLTB-DT-03).

## 8. Camino a 100
- +12 firma+auto-update (DT-02) M-L; +6 Electron al día (DT-01) S; +4 CSP (DT-03) S; +3 test de flags de main.js (DT-04) S.

## 9. Competitividad
- Básica: app de escritorio con buena postura de runtime. Avanzada faltante: instaladores firmados y auto-update (estándar en competidores). Fuente: código + audit (confianza alta).

## 10. Fortalezas a preservar
- Postura de runtime Electron correcta y **probada** (aislamiento, sandbox, guards de navegación, permisos deny-by-default, origen exacto).
- `security-policy.js` extraído y testeado; HTTPS-only en builds empaquetados.

## 11. Lo que no se pudo verificar
- Arranque real del binario empaquetado y humo E2E (presupuesto; evita firma/red externas).
- Que el portal remoto envíe CSP adecuada (PLTB-DT-03).
- Flags reales de `BrowserWindow` por prueba automatizada (PLTB-DT-04).
