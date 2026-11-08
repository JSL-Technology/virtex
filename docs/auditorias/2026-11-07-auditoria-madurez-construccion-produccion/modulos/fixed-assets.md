# Ficha — `fixed-assets` (activos fijos, depreciación, bajas) — Familia FIN-B

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/fixed-assets/` (13 archivos, 2.125 líneas): `fixed-assets.controller.ts` (9 endpoints), `fixed-assets.service.ts` (475), `depreciation.service.ts` (372), `depreciation-schedule.ts` (123), `depreciation.port.ts`, `asset-posting.service.ts`, entidades `fixed_asset`, `fixed_asset_depreciations`.
- **Endpoints**: `GET/POST /fixed-assets`, `GET/PATCH/DELETE /fixed-assets/:id`, `GET /:id/schedule`, `POST /:id/dispose`, `GET /depreciation-runs/preview`, `POST /depreciation-runs` (cron mensual `0 2 1 * *` + cierre de período vía `DepreciationPort`).
- **Frontend**: `apps/core/client-web/src/app/features/accounting/fixed-assets/` (lista, ficha, baja `fixed-asset-dispose.page.ts`), servicio `features/accounting/data/fixed-assets.service.ts` (usa `depreciation-runs`).
- **Pruebas**: `depreciation-schedule.spec.ts` (71), `fixed-asset-register.spec.ts` (317); pasaron en la suite global del coordinador (no re-ejecutadas por mí).
- Países: genérico (sin reglas fiscales por país). Dependencias: journal-entries (`AccountingPostingPort`), accounting (Ledger, períodos), organizations (settings). ¿Núcleo para vender? Sí (todo ERP mediano lo exige).

## 2. Estándar de referencia (resumen)
(a) Básicas: registro con clase/categoría, capitalización desde factura de proveedor, métodos lineal/saldo decreciente/unidades, convención de prorrata configurable (mes completo, medio mes, diario), libros múltiples (contable y fiscal), depreciación por lotes idempotente, bajas totales y parciales con ganancia/pérdida, venta con documento fiscal, mejoras, revaluación/deterioro (NIC 16/36), transferencias, conciliación registro↔mayor, reportes (cuadro de depreciación, roll-forward). Avanzadas: activos en construcción, leasing NIIF 16, componentes, etiquetas/QR, inventario físico.
(b) Invariantes: Σ depreciación = costo − residual; nunca depreciar futuro ni dos veces el mismo mes; asiento cuadra y el mayor coincide con el registro; período cerrado no se toca.
(c) Líderes: SAP FI-AA (áreas de valoración múltiples), NetSuite Fixed Assets Management (libros alternos, convenciones), Dynamics 365 FA (books, conventions), Odoo Assets (prorrata diaria, métodos lineal/degresivo), QuickBooks/Xero (Xero: métodos y "effective life", tax vs book) — confianza media (conocimiento general, no re-verificado en web en esta sesión). DO: Ley 11-92 art. 287 categorías fiscales y tasas — **verificar con contador local**.
(d) Construcción: calendario como función pura, lotes con marca por (activo, mes), asiento por mes, lock por tenant.

## 3. Resultado
- **Madurez: 50 (44–56, confianza media-alta)** — el núcleo de cálculo e idempotencia es sólido y verificado; fallan la baja "de fábrica", la protección contra depreciación futura y faltan capacidades básicas.
- **Preparación comercial: 45 — Veredicto: No listo** (compuerta 1 incumplida: baja inoperable sin configuración manual y capacidades básicas ausentes).
- Eje más débil: 12 Competitividad / 1 Completitud.
- Hallazgos críticos abiertos: 0 (2 altos).

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Completitud (crítico) | 45 (38–52, alta) | Alta, depreciación y baja reales con asiento. Baja falla en tenant nuevo (FINB-10). Sin clases, libro fiscal, mejoras, deterioro, baja parcial, transferencias, moneda, venta con e-CF/ITBIS (FINB-16). Alta no contabiliza: 1210 = 0 con registro 122.800 (FINB-15) | Provisionar diario ACT-FIJOS; categorías y libros múltiples; capitalización desde factura; mejoras/deterioro/revaluación; baja parcial; venta vía factura |
| 2 Corrección (crítico) | 58 (50–65, alta) | Lineal 108.000/36 = 3.000×36 ✓; DDB 166,67+138,89+115,74+96,45 = 517,75 ✓; mayor 1220 = −12.917,75 = registro ✓; ganancia 600−401,87 = 198,13 ✓; pérdida 1.300 ✓; 2.ª corrida = 0; corridas concurrentes serializadas (una 3.196,45, otra 0). Pero: depreciación de meses futuros permitida (FINB-13); SYD vida no múltiplo de 12 y DDB sin cambio a lineal → picos en último mes (FINB-11); fecha 2026-02-30 → 500 (FINB-14) | Rechazar `period` > mes actual; corregir SYD/DDB; validar fechas reales |
| 3 Multi-país | 30 (20–40, media) | Sin reglas por país; ni libro fiscal DO (Ley 11-92 art. 287), ni MX (LISR art. 34), ni CO/CL — buscado `grep -ri "fiscal\|tax" fixed-assets/` sin resultados de libros | Libro fiscal por país como datos versionados |
| 4 Arquitectura | 68 (60–74, media) | Calendario puro (`depreciation-schedule.ts`), port para cierre, CHECKs BD (`CHK_fixed_asset_*`), DTOs validados, paginación. Diario por código mágico 'ACT-FIJOS'/'DEPREC' | Diarios por rol configurable, no por código literal |
| 5 Higiene | 60 (52–66, media) | Importa entidades ajenas (`Ledger`, `Account`, DTOs de journal-entries) en `fixed-assets.service.ts:16-18`; SQL crudo a `branches`/`vendor_bills` (`:439-450`) | Contratos/puertos en vez de entidades ajenas |
| 6 Calidad | 70 (62–76, media) | Código legible, comentarios con razones; lint sin errores del módulo (no medí warnings específicos) | Revisar warnings del módulo en `logs/nx-ltb.clean.log` |
| 7 Robustez | 65 (58–72, media) | Advisory lock por tenant (`depreciation.service.ts:347`), transacción única por corrida, listado paginado. Corrida síncrona en la request (tenant con miles de activos × meses) | Corrida en cola con progreso; límite de meses por corrida |
| 8 Seguridad (crítico) | 78 (70–84, alta) | qa-do-b sobre activo de finb: GET/schedule/PATCH/DELETE/dispose → 404; member → 403 en GET, preview y run; cuenta de otro tenant → 400 `account_not_found`; `organizationId` en body → rechazado por whitelist | RLS efectiva (entorno superusuario) y pruebas de autorización automatizadas |
| 9 Pruebas | 55 (45–62, media) | 2 specs (calendario y registro); no vi pruebas de SYD no múltiplo de 12, futuro, baja sin diario | Casos borde y E2E baja |
| 10 Operabilidad | 55 (48–62, media) | `audit_logs` registra CREATE/UPDATE vía save; updates por `em.update` en corrida no auditados; asientos de baja con `system_reason` NULL | Auditoría de corridas (quién, período, total) |
| 11 UX | 50 (35–60, baja) | Pantallas existen (lista, baja); humo Playwright: login OK, sin errores de consola propios; no logré abrir la ruta directa (redirige a overview) → no verificado | Prueba de pantalla completa |
| 12 Competitividad | 35 (28–42, media) | Frente a Odoo/NetSuite faltan prorrata configurable, libros múltiples, clases, NIIF 16 | Ver §9 |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas, básicas presentes | **No cumple** | FINB-10, FINB-16 |
| 2 Integridad | No cumple | FINB-13 (depreciación futura) |
| 3 AuthZ/aislamiento | Cumple | §4 eje 8 |
| 4 Validación servidor | Parcial | FINB-14 (500) |
| 5 Humo sin 500 | No cumple | FINB-14 |
| 6 Cumplimiento país | N/A (genérico) / No cumple para libro fiscal | FINB-16 |
| 7 Pruebas CI | Parcial (CI en rojo global) | GLOBAL-RESULTS |
| 8 Auditoría | Parcial | eje 10 |
| 9 Migraciones | Cumple (global) | schema-drift OK |
| 10 Observabilidad | Parcial | logs con tenant en corrida |
| 11 UI/traducciones | No verificado | — |
| 12 Documentación | No cumple | sin guía operativa del módulo |

## 6. Hallazgos
**FINB-10** · fixed-assets · eje 1 · Bug/funcionalidad rota · **Alta** · `fixed-assets.service.ts:334`. La baja exige el diario `ACT-FIJOS`, que ningún aprovisionamiento crea (`grep -rn "ACT-FIJOS" apps/backend/api/src` → solo este consumidor; diarios del tenant: VENTAS, COMPRAS, COBROS, PAGOS, BANCOS, CAJA, NOMINA, GENERAL, DEPREC, CIERRE, CONCIL). Paso: `POST /fixed-assets/{id}/dispose` en qa-do-finb → `400 fixed_assets.fixed_assets_journal_act_fijos_not`. Tras `POST /journals {"code":"ACT-FIJOS"}` funcionó. Forma correcta: provisionar el diario en el paquete fiscal o resolver por rol con respaldo a GENERAL. Impacto: bloquea la venta (flujo principal roto en todo tenant nuevo). Esfuerzo S.

**FINB-13** · eje 2 · Integridad · **Alta** · `fixed-assets.controller.ts:44-49`, `depreciation.service.ts:138-153`. No hay guarda de período ≤ hoy: el 07-11-2026 `POST /depreciation-runs {"period":"2026-11"}` contabilizó 21.000 con fecha 30-11 (mes aún no transcurrido) y `GET preview?period=2029-12` ofrece contabilizar 75.000 (25 meses futuros). Forma correcta: rechazar períodos posteriores al mes en curso (o requerir cierre). Impacto: riesgo operativo (gasto adelantado, activo subvaluado). S.

**FINB-11** · eje 2 · Bug de cálculo · Media · `depreciation-schedule.ts:201-216`. SYD con vida 18 meses: 12×100, 5×50 y **350** en el último mes (años = ceil(18/12) reparte el año 2 en 12 meses). DDB 12 meses: último mes 134,58 frente a 26,92 el anterior (sin cambio a lineal). Forma correcta: SYD por meses de vida reales; DDB con cambio a lineal cuando éste sea mayor. Deuda/riesgo. S.

**FINB-12** · eje 1/12 · Competitividad · Media · `depreciation-schedule.ts:148-152`, `fixed-assets.service.ts:318`. Convención fija de mes completo: alta el 31-01 deprecia enero completo (166,67); el mes de la baja nunca se deprecia. Sin opción diaria/medio mes. M.

**FINB-14** · eje 4 · Validación · Media · `dto/fixed-asset.dto.ts:44` (solo regex). `acquisitionDate":"2026-02-30"` → **HTTP 500** (`QueryFailedError: date/time field value out of range`, api.log). Usar validador de fecha real (`IsIsoDate`). S.

**FINB-15** · eje 1/2 · Integridad · Media · `fixed-assets.service.ts:57` ("registering posts nothing"). Registro 122.800 de costo frente a 1210 = 0 en el mayor; no hay informe de conciliación registro↔mayor ni vínculo obligatorio con la factura (vendorBillId opcional). M.

**FINB-16** · eje 1/3/12 · Capacidad básica ausente · Alta · módulo completo. Sin categorías/clases, libro fiscal ni libros múltiples (solo `isDefault` ledger, `depreciation.service.ts:195`), mejoras, deterioro/revaluación, baja parcial, transferencias entre sucursales, moneda del activo; la venta debita caja directamente sin factura/e-CF ni ITBIS (asiento ACT-FIJOS-2026-000001: 1120 D 600, 1210 C 1.000, 1220 D 598,13, 4900 C 198,13). L–XL.

**FINB-17** · eje 10 · Operabilidad · Baja · asientos de baja con `system_reason` NULL; depreciación previa a la baja genera un asiento por activo (DEPREC-2026-000005/6 el mismo día). S.

## 7. Camino mínimo a producción
1. FINB-10 diario de bajas (S). 2. FINB-13 guarda de período (S). 3. FINB-14 validación de fecha (S). 4. FINB-11 cálculo SYD/DDB (S). 5. Conciliación registro↔mayor y capitalización desde factura (M). 6. Libro fiscal DO como datos (M, verificar con contador). Retocar, no rehacer. Países: genérico; DO requiere 6.

## 8. Camino a 100
Libros múltiples/fiscal por país (+12, L); categorías y convenciones configurables (+8, M); mejoras/deterioro/revaluación (+6, M); venta vía factura con impuestos (+5, M); corridas en cola con auditoría (+4, M); NIIF 16 y activos en construcción (+5, L); pruebas borde/E2E (+4, S).

## 9. Competitividad
Básicas faltantes: libros fiscal/contable, categorías, prorrata configurable, baja parcial. Avanzadas: NIIF 16, componentes, inventario físico con QR. Diferenciador: calendario proyectado por activo y corridas idempotentes con recuperación de meses atrasados (mejor que muchos locales). Fuentes: documentación pública Odoo Assets / NetSuite FAM / D365 FA (confianza media, no re-verificada en esta sesión).

## 10. Fortalezas a preservar
Idempotencia por (activo, mes) + `depreciatedThrough`; lock por tenant; asiento por mes con desvío a mes abierto si el período está cerrado; bloqueo de campos de valoración tras depreciar (409); borrado prohibido si tiene depreciación (409); cambios de estimación prospectivos (vida 48 → recalcula 2.181,82/mes).

## 11. No verificado
Pantallas (rutas directas no resueltas en Playwright); comportamiento con período cerrado (no cerré períodos); cron mensual multi-tenant; rendimiento con miles de activos.
