# Ficha M02 — Asientos, mayor y cierre (`journal-entries` + `accounting`)

Auditor: familia F4 (Finanzas). Fecha: 2026-10-31. Tenant de prueba: qa-mx (MX); víctima IDOR: qa-b.

> **Hallazgo CRÍTICO abierto (integridad contable, no de seguridad):** modificar un asiento contabilizado (`PATCH /journal-entries/:id`) hace que el importe original se reste DOS veces en todos los saldos y reportes (balanza, balance, resultados, flujo, mayor, cierre anual, presupuestos, contabilidad electrónica MX). Lo reproduje por API y lo comprobé contra una balanza rehecha a mano con SQL. Ver `GL-01`.
> No encontré ruptura de partida doble en BD (0 asientos descuadrados entre 3.086 asientos de 6 organizaciones) ni huecos o duplicados de numeración. Sí encontré huecos en la inmutabilidad a nivel de BD (`GL-03`).

## 1. Identificación
- **Alcance backend**: `apps/backend/api/src/app/journal-entries` (57 archivos .ts, 10 specs, ~7.000 LOC, 32 endpoints en 6 controladores: asientos, diarios, plantillas, recurrentes, ajustes de auditoría, importación) y `apps/backend/api/src/app/accounting` (52 archivos, 7 specs, ~4.900 LOC, 22 endpoints: períodos, cierre/reapertura, cierre por módulo, bloqueo de cuenta por período, cierre anual, libros multi-GAAP, mapeos entre libros, ajuste por inflación, revaluación cambiaria). Tablas: `journal_entries`, `journal_entry_lines`, `journal_entry_line_valuations`, `journal_entry_sequences`, `journals`, `ledgers`, `ledger_mapping_rules`, `accounting_periods`, `fiscal_years`, `account_period_locks`, `recurring_journal_entries`, plantillas, lotes de importación, adjuntos.
- **Frontend**: `features/accounting/{journal-entries, journal-entry-form, journal-list, journal-form, daily-journal, general-ledger, partner-ledger, periods, closing, recurring, entry-templates, audit-adjustments, ledger-list, ledger-form}`.
- **Países**: los 19 declarados (motor contable genérico; el núcleo no tiene reglas por país salvo la numeración por año fiscal y el ajuste por inflación).
- **Dependencias**: chart-of-accounts, currencies (ExchangeRateResolver), workflows (aprobación), budgets (control), dimensions, audit, saas (límites), storage. Todos los subledgers lo usan vía `AccountingPostingPort` (`journal-entries/accounting-posting.port.ts`).
- **¿Núcleo para vender?** Sí: es el corazón del ERP.

## 2. Estándar de referencia (Paso 3)
- **Capacidades básicas**: asientos manuales y automáticos, partida doble exacta, numeración correlativa por diario/ejercicio, inmutabilidad + corrección por reversión, períodos con cierre/reapertura controlada y auditada, cierre anual (traspaso a resultados acumulados), libro diario, mayor, auxiliar por tercero, balanza, multimoneda con tasa histórica y revaluación, plantillas y recurrentes, importación, adjuntos.
- **Avanzadas**: multi-libro (multi-GAAP), aprobación con segregación de funciones, ventanas de cierre por subledger, bloqueo de cuenta por período, reversión automática de devengos, checklist de cierre.
- **Invariantes**: Σdebe = Σhaber por asiento y libro; asiento contabilizado inmutable (en BD); corrección por reversión; ningún reporte cuenta dos veces ni omite un asiento; numeración sin huecos; idempotencia de los asientos automáticos; un período cerrado no admite asientos (salvo excepción auditada); precisión decimal en `numeric`.
- **Cómo lo resuelven los líderes** (confianza media, conocimiento público de producto): NetSuite, Dynamics 365 F&O, Business Central y SAP B1 no permiten editar asientos contabilizados, solo revertirlos. Odoo permite "volver a borrador" salvo con fecha de bloqueo o hash de inalterabilidad. Siigo, Alegra y CONTPAQi permiten editar pólizas en período abierto y recalculan saldos (son menos estrictos). El auxiliar por tercero (NIT) es obligatorio de facto en CO (Siigo y Alegra lo traen). En MX la contabilidad electrónica exige catálogo con código agrupador SAT y balanza/pólizas en XML (confianza alta).
- **Construcción de referencia**: libro append-only; saldos derivados de las líneas (o snapshots verificables); triggers/permisos de BD que impidan UPDATE/DELETE; contador transaccional por serie; clave de idempotencia por hecho de negocio; bloqueo del período (FOR SHARE al contabilizar, FOR UPDATE al cerrar).

## 3. Resultado
- **Madurez: 38** (30–48, confianza media-alta: invariantes probados por API y SQL; hay un CRÍTICO de integridad abierto).
- **Preparación comercial: 45 — No listo** (la compuerta crítica 2 no se cumple por GL-01).
- **Eje más débil**: 2 Corrección e integridad.
- **Hallazgos críticos abiertos**: 1 (GL-01). Altos: 4 (GL-02, GL-03, GL-04, GL-06).
- El promedio simple de los ejes aplicables es ≈ 60. La madurez difiere en más de 15 puntos porque la topa el eje 2: un único defecto corrompe todos los reportes con una acción de usuario ordinaria.

## 4. Ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 62 (55–70, media) | Flujos reales: crear, reversar, modificar, cerrar, reabrir y cierre anual funcionan por API. Faltan el auxiliar por tercero (las líneas no tienen `partnerId`). Los asientos con fecha anterior al alta quedan bloqueados por `effectiveFrom` | Tercero por línea; saldos iniciales/histórico sin tocar cuentas; libro diario oficial exportable |
| 2 | Corrección e integridad | 38 (30–45, alta) | GL-01 (doble resta de modificados). El resto es muy sólido: cuadre exacto en centavos, trigger diferido de cuadre por libro, numeración sin huecos bajo concurrencia, reversión única por índice | Corregir GL-01 + test de integración que lo cubra; cerrar huecos GL-03; bloqueo de período (GL-04) |
| 3 | Multi-país | 50 (40–60, baja) | Numeración por año fiscal; ajuste por inflación; revaluación con tasa resuelta en servidor. Sin tercero (CO). XML SAT no verificado aquí | Tercero/NIT; formatos de libro diario por país; verificar con contador |
| 4 | Arquitectura | 72 (65–78, media) | Puerto `AccountingPostingPort`, `resolvePostingPeriod` único, saldos derivados de valoraciones, multi-libro | Un solo predicado "asiento vigente" compartido por todos los lectores |
| 5 | Higiene/fronteras | 60 (50–68, media) | `period-closing.service` importa el `JournalEntriesService` concreto; `chart-of-accounts` ↔ `journal-entries` mutuamente dependientes; budgets se inyecta como opcional para romper el ciclo | Contrato de lectura de saldos en un único servicio de dominio |
| 6 | Calidad de código | 68 (60–75, media) | Código cuidado y documentado; los comentarios extensos a veces sobre-afirman | Menos prosa defensiva, más tests |
| 7 | Robustez/rendimiento | 62 (55–70, media) | Con 30k líneas: balanza 0,05 s; flujo de efectivo 4,2 s. Sin bloqueo de período al contabilizar (carrera cierre/post) | Índices/agregados para el flujo; `FOR SHARE` del período |
| 8 | Seguridad/aislamiento | 72 (65–80, media) | IDOR desde qa-b (GET/reverse de asiento, cerrar período, mayor, balanza con `ledgerId` ajeno) → 404. Permisos con `@HasPermission`. POST manual sin idempotencia | Idempotencia en POST manual; pruebas con rol restringido (no ejecutadas) |
| 9 | Pruebas | 55 (45–65, media) | Las suites de integración `ledger-invariants`, `ledger-integrity`, `period-close` y `fiscal-calendar` corren con BD en CI (`ci.yml:58 DB_HOST`); 266 suites OK. Ninguna cubre "modificar asiento y leer balanza" (el spec que usa `Modified` lo escribe por SQL directo, `ledger-invariants.spec.ts:366`) | Test E2E modificar→reportes |
| 10 | Operabilidad | 60 (50–68, baja) | Auditoría del asiento en la misma transacción; logs pino; errores 409 genéricos (`UNIQUE_VIOLATION`) | Mensajes de negocio, métricas de cierre |
| 11 | UX | 55 (no verificada en navegador, baja) | Las pantallas existen; no ejecuté la UI | Verificación con Playwright |
| 12 | Competitividad | 58 (50–65, media) | Multi-libro, aprobación y cierre por subledger son diferenciadores; falta tercero | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin mocks, capacidades básicas | Cumple con reservas | Todo es real; falta el auxiliar por tercero |
| 2 | Integridad en escrituras críticas | **No cumple** | GL-01 |
| 3 | Autorización/aislamiento | Cumple (en lo probado) | 6 IDOR → 404 |
| 4 | Validación en servidor | Cumple | Descuadre, negativos, 3 decimales y cuenta no imputable → 400 |
| 5 | E2E sin 500 | Cumple (en lo probado) | Ningún 500 en M02 |
| 6 | Cumplimiento por país | No verificado | Sin tercero; numeración por año fiscal: verificar con contador |
| 7 | Pruebas en CI | Cumple con reserva | Integración con BD en CI; falta el caso GL-01 |
| 8 | Auditoría de negocio | Cumple | `recordWithManager` dentro de la transacción del asiento y de los cierres |
| 9 | Migraciones sin deriva | Cumple | Paso 2 global |
| 10 | Observabilidad | Parcial | Correlación no verificada |
| 11 | UI/traducciones | No verificado | — |
| 12 | Documentación | Parcial | Comentarios abundantes; sin manual operativo |

## 6. Hallazgos
**GL-01** — journal-entries / financial-reporting / accounting / budgets / compliance · Eje 2 · Categoría: integridad de datos · **Severidad: CRÍTICA**
- **Ubicación**: `journal-entries/journal-entries.service.ts`, `update()` (~líneas 1230–1295: revierte con `reverseWithin`, contabiliza el reemplazo y marca el original `status: MODIFIED`). Lectores que filtran solo `Posted`: `chart-of-accounts/account-balances.service.ts:164`, `journal-entries/services/journal-query.service.ts:124,203,252`, la vista `analytical_report_data` (`WHERE je.status = 'Posted'`), `budgets/*`, `compliance/reports/mx-electronic-accounting.ts`. En cambio `dashboard/dashboard-charts.service.ts:118,266` usa `IN ('Posted','Modified')`.
- **Qué está mal**: el original deja de contar (estado `Modified`) pero su reversión sí cuenta, así que el importe original se resta dos veces. Pasos: asiento `GENERAL-2026-000001` (D 1110 100.000 / C 3100 100.000) → `PATCH` con nuevas líneas por 5 → balanza 2026: `1110` con saldo ACREEDOR 100.005,50 (real: deudor 1.155,00), `3100` con saldo deudor 100.000 (real: 0), resultado −5,50 (real: +1.155). La balanza responde `isBalanced: true` porque el error es simétrico, así que nada alerta. El cierre anual (`CIERRE-2026-000001`) cerró `4100` por 1.571.302,42 cuando el saldo real era 1.570.141,92: deja un residuo en ingresos y descuadra Resultados Acumulados.
- **Forma correcta**: el original debe seguir contando (estado `Posted` + `modifiedToEntryId`, o incluir `Modified` en el predicado de "vigente"). Un solo predicado compartido por todos los lectores y un test de integración modificar→balanza.
- **Impacto**: bloquea la venta (estados financieros falsos). **Esfuerzo**: S (corrección) + M (unificar el predicado y los tests).

**GL-02** · Eje 1/3 · funcionalidad · **Alta** — Las cuentas se siembran con `effectiveFrom` = fecha de alta (qa-mx: 2026-10-31). `TemporalValidityGuard` (`financial-reporting/guards/temporal-validity.guard.ts`, aplicado solo en `POST /journal-entries`) rechaza cualquier asiento manual anterior: `POST` con fecha 2026-01-15 → 403 `account_code_not_valid_until_effective`. Un cliente que arranca a mitad de año no puede registrar su histórico ni sus ajustes sin editar las 56 cuentas. Además, el control vive solo en el guard HTTP y los subledgers no lo aplican (inconsistencia). **Forma correcta**: `effectiveFrom` nulo por defecto en la siembra y validación en el servicio. Esfuerzo S.

**GL-03** · Eje 2 · integridad · **Alta** — Huecos en los triggers de inmutabilidad (probado con `BEGIN … SET CONSTRAINTS ALL IMMEDIATE … ROLLBACK` sobre mis datos QA):
- (a) INSERT de líneas + valoraciones nuevas (cuadradas) en un asiento `Posted` → aceptado. `trg_journal_entry_valuations_immutable` es solo `BEFORE DELETE OR UPDATE`, y `trg_journal_entry_lines_have_valuation` solo exige que haya valoración.
- (b) UPDATE de `is_reversed`, `idempotency_key`, `system_reason`, `affects_opening_balance` → aceptado (`virtex_guard_posted_entry_update` no los lista).
- (c) `Posted → Void` sin reversión → aceptado.
- UPDATE de importes o fecha y DELETE sí se bloquean.
- **Forma correcta**: trigger `BEFORE INSERT` en líneas y valoraciones que rechace si el asiento ya está contabilizado; lista blanca (no negra) de columnas mutables. Esfuerzo S.

**GL-04** · Eje 7/2 · robustez · **Alta** — No se bloquea el período. `resolvePostingPeriod` (`accounting/period-status.ts`) lee con `findOne` sin `FOR SHARE`, y `closePeriod` (`accounting/period-closing.service.ts`) tampoco toma `FOR UPDATE`. Bajo READ COMMITTED, un asiento puede comprometerse en un período que se cerró entre su lectura y su commit. Mismo patrón en `closeFiscalYear` (dos cierres concurrentes). No lo ejecuté (requiere temporización fina): lo infiero del código. Esfuerzo S.

**GL-05** · Eje 8/2 · robustez · **Media** — `POST /journal-entries` (manual) no lleva `@Idempotent()` (`journal-entries.controller.ts:51`), a diferencia de reverse, year-end y fixed-assets: un doble envío crea dos asientos. Esfuerzo S.

**GL-06** · Eje 3 · multi-país/competitividad · **Alta** — No hay tercero por línea: grep de `partner|customerId|supplierId|thirdParty` en `journal-entry-line.entity.ts`, `journal-entry.entity.ts` y `general-ledger-query.dto.ts` → 0 coincidencias. El libro auxiliar por tercero (exigido en CO —NIT por movimiento— y estándar en Siigo/Alegra) no puede salir del mayor. Verificar con contador local. Esfuerzo M.

**GL-07** · Eje 2 · integridad · **Media** — Los ejercicios se auto-abren hasta 15 años atrás (`period-status.ts`, `AUTO_OPEN_YEARS_BACK = 15`) y siempre con calendario enero–diciembre (`ensureFiscalYearWithPeriods(…, '${year}-01-01', 12)`), aunque el tenant use año fiscal julio–junio: posibles ejercicios solapados. Además, un asiento automático (sin guard de vigencia) puede abrir un año anterior a uno ya cerrado y alterar aperturas sin pasar por reapertura. Esfuerzo S.

**GL-08** · Eje 2 · **Media** — Se permite cerrar períodos futuros (cerré nov/dic 2026 el 31-oct-2026) y el cierre anual de un año no terminado, sin advertencia. Esfuerzo S.

**GL-09** · Eje 7/10 · **Media** — 11 de los 15 servicios externos que contabilizan vía el puerto no pasan `idempotencyKey` (p. ej. `accounts-payable.service.ts`, `customer-payments.service.ts`, `treasury.service.ts`, `intercompany.service.ts`, `currency-revaluation.service.ts`, `fixed-assets/*`). Su idempotencia depende del estado del documento dentro de la transacción. Solo facturas, nómina, inventario, conciliación y recurrentes usan la clave única. Verificar caso por caso con cada familia. Esfuerzo M.

**GL-10** · Eje 7 · rendimiento · **Media** — Con 30.230 líneas en el tenant, el flujo de efectivo tarda 4,19 s frente a 0,04–0,05 s del resto de reportes; el listado de asientos devuelve las líneas incrustadas (325 KB por 50 asientos). Esfuerzo S/M.

**GL-11** · Eje 10 · **Baja** — Los conflictos de reversión concurrente devuelven 409 `UNIQUE_VIOLATION` genérico en vez de `entry_has_already_reversed`.

## 7. Camino mínimo a producción
1. GL-01: predicado único de "asiento vigente" + test de integración modificar→balanza/cierre (S/M, retocar; todos los países).
2. GL-03: cerrar los triggers (INSERT en asiento contabilizado; lista blanca de columnas) (S).
3. GL-04: `FOR SHARE` del período al contabilizar y `FOR UPDATE` al cerrar (S).
4. GL-02: no sembrar `effectiveFrom` y validar vigencia en el servicio (S).
5. GL-05: idempotencia en el POST manual (S).
6. GL-06: tercero por línea (M; CO prioritario).

## 8. Camino a 100
GL-01 (+20 eje 2) → GL-03/GL-04 (+8) → GL-06 tercero (+10 en ejes 1/3/12) → libros oficiales por país (diario/mayor exportables, XML SAT) (+8) → idempotencia uniforme en subledgers (+5) → rendimiento de flujo y listados (+4) → UI verificada (+5).

## 9. Competitividad
- **Básicas faltantes**: auxiliar por tercero; histórico previo a la alta.
- **Avanzadas presentes** (diferenciadores frente a Alegra/Siigo/CONTPAQi): multi-libro con reglas de mapeo, cierre por subledger, bloqueo de cuenta por período, aprobación con segregación de funciones, ajuste por inflación, revaluación con tasa resuelta en servidor, inmutabilidad en BD.
- **Frente a NetSuite/D365**: faltan intercompañía automática madura, asignaciones (allocations) y cierre "suave" por rol.

## 10. Fortalezas a preservar
Cuadre exacto en centavos en el servicio y trigger diferido por libro; numeración transaccional sin huecos (6 posts concurrentes → 000007–000012); reversión única por índice (4 reversiones concurrentes → 1×201 + 3×409); auditoría dentro de la transacción; cierre en orden; cierre anual y reapertura que revierte (`CIERRE-2026-000002`); tasa de cambio resuelta en servidor.

## 11. No verificado
UI (no ejecuté navegador); importación de asientos, plantillas y recurrentes por API; multimoneda por API (no hay tasas cargadas); revaluación y ajuste por inflación; aprobación con roles restringidos; contabilidad electrónica MX (otra familia). Datos dejados en qa-mx: asientos `QA-F4*`, 3.000 asientos `QAVOL-*` (SQL), cuenta 5901, dimensión "QA F4 Centro", presupuesto y 2 activos QA; períodos ene–oct 2026 cerrados, FY 2027 creado. Cobertura aproximada: ~45 % de archivos leídos (servicio principal, períodos, cierre, numeración, triggers) y ~35 % de endpoints ejecutados.

<!-- RESUMEN: modulo=asientos-mayor-y-cierre; madurez=38; prep=45; veredicto=No listo; eje_debil=2 Corrección e integridad; criticos=1; altos=4; camino_min=M -->
