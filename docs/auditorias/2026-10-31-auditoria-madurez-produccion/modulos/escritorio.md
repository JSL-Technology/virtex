# Ficha — Aplicación de escritorio (T22)

Auditor: familia F11 · Fecha: 2026-10-31/11-01 · HEAD `495719fc`

> Sin hallazgo CRÍTICO de seguridad. Dos altos: binarios sin firma ni actualización automática (DESK-01) y Electron en rango vulnerable (DESK-02).

## 1. Identificación
- `apps/desktop`: 11 archivos, ~490 LOC JS (`src/main.js`, `preload.js`, `security-policy.js` + test, catálogos i18n del menú), `electron-builder.json`, `project.json`.
- Es un **envoltorio delgado**: carga el portal y el POS remotos (`main.js:124` `loadURL(PORTAL_URL)`, menú a `POS_URL`); no hay lógica local, ni almacenamiento offline, ni integración de hardware (impresoras fiscales, cajón) en el escritorio.
- Electron instalado 44.4.5 (`package.json:100` `^44.4.5`). Países: transversal. ¿Núcleo? No.

## 2. Estándar de referencia
(a) Básicas: binarios firmados (Authenticode, notarización Apple), actualización automática firmada, `contextIsolation`/`sandbox`/sin `nodeIntegration`, filtro de navegación y de `window.open`, permisos denegados por defecto, CSP, Electron en versión soportada (guía oficial "Electron Security Checklist", electronjs.org/docs/latest/tutorial/security, confianza alta). Avanzadas: modo offline, periféricos (impresora fiscal/ESC-POS), canal de actualización por etapas. Referencias: Dynamics 365 Business Central y QuickBooks Desktop entregan instaladores firmados y actualizaciones gestionadas (confianza media).

## 3. Resultado
- **Madurez: 40** (33–48, media). **Preparación: 35 — No listo** (no distribuible de forma segura: sin firma ni actualización).
- Eje más débil: 10 Operabilidad (sin canal de actualización). Críticos 0, Altos 2.

## 4. Doce ejes
| Eje | Nota | Evidencia | Para 100 |
|---|---|---|---|
| 1 Autenticidad | 40 (32–48, media) | Shell real pero sin valor añadido sobre el navegador | Offline/periféricos |
| 2 Corrección | 60 (50–68, baja) | Menú i18n, validación de idioma por IPC | — |
| 3 Multi-país | N/A | — | — |
| 4 Arquitectura | 65 (58–72, media) | Política de confianza aislada y testeada (`security-policy.js`) | — |
| 5 Higiene | 70 (60–76, media) | Pequeño y separado | — |
| 6 Código | 68 (60–74, media) | Claro | — |
| 7 Robustez | 50 (40–58, baja) | Empaquetado se niega a arrancar sin HTTPS (`main.js:17-24`) | Reintentos/pantalla offline |
| 8 Seguridad | 62 (55–68, media) | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` (`main.js:117-119`); `will-navigate` + `setWindowOpenHandler` (`:144-149`); `openExternal` solo https/mailto (`:30-33`); IPC solo de frames confiables (`:36-39`); permisos denegados salvo lista (`:255-261`); preload mínimo. Electron vulnerable (DESK-02); CSP depende del portal remoto (no verificado). | Electron ≥44.9.x; CSP verificada |
| 9 Pruebas | 50 (42–58, media) | `node --test apps/desktop/src/security-policy.test.js` → `fail 0` (ejecutado); no hay prueba del empaquetado ni E2E | Smoke de empaquetado en CI |
| 10 Operabilidad | 25 (18–32, media) | Busqué `autoUpdater|electron-updater|publish` en `apps/desktop` y `electron-builder.json`: 0; sin firma (DESK-01); sin telemetría de fallos | Actualizador firmado |
| 11 UX | 55 (45–62, baja) | Controles de ventana propios, menú traducido | — |
| 12 Competitividad | 30 (22–38, baja) | Un PWA daría lo mismo | Offline/periféricos |

## 5. Compuertas
1 No cumple (sin capacidad distintiva; aceptable como shell, pero no vendible como "app de escritorio") · 2 N/A · 3 Cumple (sin superficie propia; aislamiento del renderer correcto) · 4 N/A · 5 No verificado · 6 N/A · 7 Parcial (test de política, sin CI verde) · 8 N/A · 9 N/A · 10 No cumple · 11 Parcial · 12 Parcial (`apps/desktop/README.md`).

## 6. Hallazgos
**DESK-01** · Eje 10/8 · Operabilidad/seguridad de cadena de suministro · **Alta** · `apps/desktop/electron-builder.json` (sin `win.certificateFile/sign`, sin `mac.hardenedRuntime/notarize`, sin `publish`); `main.js` sin `autoUpdater`. Los instaladores saldrían sin firma (SmartScreen/Gatekeeper los bloquean) y sin canal de parches, de modo que una vulnerabilidad de Electron queda en las máquinas de los clientes indefinidamente. Forma correcta: firma + notarización en CI, `electron-updater` con verificación de firma. Esfuerzo M.

**DESK-02** · Eje 8 · Seguridad · **Alta** · `package.json:100` → instalado 44.4.5; `npm audit` (logs/audit.json): rango vulnerable `44.0.0-alpha.1 – 44.9.0`, avisos "Pointer lock permission requests can be attributed to the wrong frame" y "Mitigation for compromised eMudhra intermediate certificates". Impacto acotado porque solo se carga el origen propio, pero el segundo afecta la confianza TLS. Forma correcta: actualizar a la versión parcheada y fijar política de actualización. Esfuerzo S.

**DESK-03** · Eje 1/12 · Competitividad · Media · Sin offline ni periféricos; el POS de escritorio es la web remota. Esfuerzo L.

**DESK-04** · Eje 9 · Pruebas · Baja · No hay verificación de que el paquete se construya en CI (no verifiqué si `nx run-many build` incluye el empaquetado). Esfuerzo S.

## 7. Camino mínimo a producción
DESK-02 (S) → DESK-01 (M) → smoke de empaquetado en CI (S).

## 8. Camino a 100
DESK-01 (+25 operabilidad), DESK-02 (+8 seg.), offline/periféricos DESK-03 (+30 autenticidad/competitividad, L), CSP verificada y prueba E2E del shell (+10 pruebas).

## 9. Competitividad
Frente a QuickBooks Desktop / CONTPAQi (aplicaciones nativas con offline) no compite; frente a ERPs SaaS que no ofrecen escritorio es un extra menor. Nota 30.

## 10. Fortalezas
Configuración de seguridad del renderer ejemplar según el checklist de Electron; decisiones de confianza centralizadas y testeadas; arranque empaquetado exige HTTPS.

## 11. No verificado
Empaquetado real; CSP efectiva del portal remoto; comportamiento en Windows/macOS.

Cobertura: 100 % de archivos leídos o inspeccionados por patrón; test ejecutado.

<!-- RESUMEN: modulo=escritorio; madurez=40; prep=35; veredicto=No listo; eje_debil=Operabilidad; criticos=0; altos=2; camino_min=M -->
