# Ficha — accounting (períodos, ejercicios, cierres mensual/anual, ledgers, mapping, ajuste por inflación, revaluación, period-lock)

Familia FIN-A · Auditor: FIN · Fecha: 2026-11-07 · Tenant propio: qa-do-fin@virtex.test

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/accounting` — 4.994 líneas sin specs, 7 specs (`period-close`, `period-status`, `ledger-integrity`, `ledger-invariants`, `general-ledger`, `fiscal-calendar`…). Principales: `period-closing.service.ts` (543), `provisioning/tenant-bookkeeping.provisioner.ts` (466), `year-end-close.service.ts` (411), `ledgers.service.ts` (399), `result-transfer.service.ts` (266), `services/currency-revaluation.service.ts` (221), `inflation-adjustment.service.ts` (163).
- **Endpoints**: `/accounting` (reprovision, periods, fiscal-years, current-period, closing-checklist, close/reopen-period, close/reopen-module-period, lock/unlock-account-in-period), `/accounting/year-end-close` (readiness, POST, reopen), `/accounting/ledgers` (general-ledger, CRUD), `/accounting/ledger-mappings`, `/accounting/inflation-adjustment/run`. Todos con `@HasPermission`.
- **Tablas**: `accounting_periods`, `fiscal_years`, `account_period_locks`, `ledgers`, `ledger_mapping_rules`, `inflation_indices`.
- **Frontend**: `features/accounting/periods`, `closing` (checklist, annual-close), `ledger-list`, `ledger-form`, `general-ledger`; sin pantalla para inflación, ledger-mappings ni reprovision (grep en `apps/core/client-web/src` sin coincidencias de `inflation-adjustment`, `ledger-mappings`, `reprovision`).
- **Países**: todos; ajuste por inflación relevante para AR (y VE). **Núcleo**: sí.

## 2. Estándar de referencia
(a) Básicas: calendario fiscal, cierre mensual secuencial con checklist, bloqueo por módulo, reapertura auditada, cierre anual con traspaso de resultados, revaluación cambiaria al cierre, multi-libro. Avanzadas: ajuste por inflación (IAS 29 / RT 6 AR — verificar con contador local), cierre asistido, bloqueo por cuenta.
(b) Invariantes: no registrar en período cerrado; cierre en orden; resultado del ejercicio = traspaso a resultados acumulados; P&L a cero tras cierre; ejercicio cerrado no admite reapertura de períodos.
(c) Líderes (confianza media): SAP/D365 permiten abrir/cerrar por módulo y por cuenta; NetSuite tiene checklist de cierre y bloqueo AP/AR/GL; Odoo usa "lock dates". Ajuste por inflación integrado: localizaciones AR de Odoo y Tango/Bejerman (confianza baja, no verificado en esta sesión).
(d) Construcción: servicio transaccional con `FOR UPDATE` sobre el período, automatizaciones previas (depreciación, revaluación) en la misma transacción.

## 3. Resultado
- **Madurez: 57 (50–64, confianza media)**. Preparación comercial: 55. **Veredicto: Piloto controlado (DO/genérico); No listo para AR/VE** (ajuste por inflación no funcional).
- Eje más débil: 2 (cierre anual bloqueable, revaluación inoperante en la práctica).
- Críticos: ninguno; 3 altos.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
|1|Autenticidad (crítico)|58 (50–66, media)|Cierre mensual (11 períodos ene–nov, luego dic) y anual ejecutados con éxito. Inflación: sin índices cargables (0 filas `inflation_indices`, ningún servicio escribe `InflationIndex` salvo lectura), diario `AJU-INF` no aprovisionado (diarios: BANCOS CAJA CIERRE COBROS COMPRAS CONCIL DEPREC GENERAL NOMINA PAGOS VENTAS), sin UI.|Carga de índices, diario, UI e idempotencia del ajuste.|
|2|Corrección (crítico)|60 (52–68, alta)|Asiento de cierre `CIERRE-2026-000001` verificado a mano: 4100 D 50.100,34; 5100 H 20.000,11; 5300 H 7.530,00; 3300 H 22.570,23 = resultado del IS. Post en período cerrado → 403 (manual, AUDIT_ADJUSTMENT por el endpoint normal, borrador y reversión). Reabrir dic. con año cerrado → 403. Pero FIN-AC-01, FIN-AC-02, FIN-AC-03.|Ver hallazgos.|
|3|Multi-país|45 (35–55, media)|Calendario enero–diciembre para todos; inflación inoperante (AR); revaluación no aplica a cuentas aprovisionadas.|Calendario fiscal por país (p.ej. ejercicios no calendario), ajuste IAS 29 por capas.|
|4|Arquitectura|58 (50–65, media)|Lógica en servicios; pero `reprovision` en el controlador abre transacción y manipula entidades de organizaciones (`accounting.controller.ts:59-75`).|Mover a servicio; puertos hacia organizaciones.|
|5|Higiene|50 (42–58, media)|47 violaciones de frontera en `accounting/` (importa `users`, `organizations`, `organization-settings`); ciclos contabilidad↔plataforma/identidad/finanzas.|Puertos de lectura; romper ciclos.|
|6|Calidad|64 (58–70, media)|9 warnings lint; código legible.|—|
|7|Robustez|62 (55–70, media)|`SELECT … FOR UPDATE` al cerrar; cierre en orden; automatizaciones en la transacción.|Cierre de período con miles de asientos: medir.|
|8|Seguridad (crítico)|70 (60–78, media)|IDs ajenos (período, ejercicio, ledger, cuenta) → 404 en close/readiness/lock/general-ledger; mapping con cuenta ajena bloqueado por trigger BD (`FOREIGN_KEY_VIOLATION`), no por la app. qa-do-a-member → 403 (ejecutado).|Validación de pertenencia en `ledger-mapping.service.ts:60-70` antes de BD.|
|9|Pruebas|60 (52–68, media)|7 specs pasan; ninguna cubre cierre anual con regla de dimensión obligatoria ni inflación.|Casos de FIN-AC-01/02.|
|10|Operabilidad|64 (56–70, media)|Auditoría `recordWithManager` en cierre/reapertura.|Alertas de cierre fallido.|
|11|UX|58 (48–66, baja)|Pantallas periods/annual-close/checklist cargan sin errores (Playwright); barra inferior muestra "Period 2026-11 closed".|Inflación, mappings y reprovision sin UI.|
|12|Competitividad|52 (45–60, baja)|Cierre por módulo y por cuenta existe (≈ NetSuite/SAP); inflación ausente en la práctica.|IAS 29, cierre asistido.|

## 5. Compuertas
|#|Estado|Evidencia|
|---|---|---|
|1 Sin fachadas|No cumple para AR (inflación no operable); cumple DO|ver FIN-AC-04|
|2 Integridad|Cumple con reservas|FIN-AC-01, FIN-AC-03|
|3 AuthZ/aislamiento|Cumple (miembro 403 e IDOR negativo verificados)|IDOR negativo|
|4 Validación|Cumple|—|
|5 E2E|Cumple|Playwright sin errores|
|6 País|No cumple AR/VE; DO cumple genérico|—|
|7 CI|No cumple (global rojo)|GLOBAL-RESULTS|
|8 Auditoría|Cumple|audit_trail en cierre|
|9 Migraciones|Cumple|—|
|10 Observabilidad|Cumple|—|
|11 UI|Parcial|funciones sin UI|
|12 Docs|Parcial|—|

## 6. Hallazgos
**FIN-AC-01** · accounting + dimensions · Eje 2 · Bug · **Alta**
- Ubicación: `year-end-close.service.ts` (genera el asiento de cierre vía `JournalEntriesService`), `journal-entries.service.ts:939` `validateDimensionRules`.
- Qué: con una regla de dimensión obligatoria en una cuenta de resultados (5300), `readiness` responde `canClose:true` pero `POST /accounting/year-end-close` → 400 `journal_entries.account_code_p2_requires_mandatory_dimension` (5300). El cierre anual queda bloqueado hasta borrar la regla (lo hice: tras `DELETE /dimensions/rules/…` el cierre funcionó). Además las líneas de cierre no llevan dimensiones, así que el P&L por centro de costo no queda en cero.
- Forma correcta: el asiento de cierre (y el resto de asientos de sistema) debe saldar por combinación cuenta×dimensión y estar exento de la regla; `readiness` debe detectar el bloqueo.
- Impacto: bloquea el cierre anual de clientes con contabilidad analítica. Esfuerzo: M.

**FIN-AC-02** · accounting · Eje 2 · Integridad · **Media**
- `closePeriod` no comprueba que el período haya terminado: cerré "Noviembre 2026" el 2026-11-07 (y diciembre por adelantado). Sin advertencia de cierre anticipado. Forma correcta: exigir `endDate < hoy` o confirmación explícita con permiso. Esfuerzo: S.

**FIN-AC-03** · accounting/journal-entries/chart-of-accounts · Eje 2 · Integridad · **Alta**
- `currency-revaluation.service.ts:113` revalúa solo cuentas `isMultiCurrency=true`; el plan aprovisionado no tiene ninguna (`count=0`) y `JournalEntriesService.prepare` acepta asientos en USD sobre la cuenta 1120 no multimoneda (ejecutado: `QA-FIN-usd` 100,01 USD @58,5 y `QA-FIN-usd-2` @60,25). Al cerrar diciembre no se generó ningún asiento de revaluación (solo hay asientos de sistema de reversión). Resultado: diferencia cambiaria no reconocida en saldos en divisa.
- Forma correcta: rechazar divisa en cuentas no multimoneda o marcarlas automáticamente; aprovisionar bancos en divisa; checklist que alerte saldos en divisa sin revaluar.
- Impacto: estados financieros incorrectos para cualquier cliente con divisas (todo LatAm). Esfuerzo: S–M.

**FIN-AC-04** · accounting · Eje 1/3 · Funcionalidad no operable · **Alta (AR/VE)**
- `inflation-adjustment.service.ts:43-104`: requiere índice mensual por organización (`inflation_indices`, 0 filas, sin endpoint ni servicio de carga), diario `AJU-INF` inexistente en el aprovisionamiento, sin UI; el método es saldo×tasa mensual sin capas por fecha de origen (IAS 29/RT 6 reexpresan por fecha de incorporación — verificar con contador local) y no se ve control de doble ejecución por mes (grep `idempot|already|existing` sin coincidencias en el archivo).
- Forma correcta: índices oficiales versionados por país (INDEC FACPCE), cálculo por antigüedad de partidas, idempotencia por período, UI. Esfuerzo: L.

**FIN-AC-05** · accounting · Eje 8/4 · Seguridad (defensa en profundidad) · **Baja**
- `ledger-mapping.service.ts:60-70` inserta `sourceAccountId/targetAccountId` sin verificar que sean del tenant; lo detiene el trigger BD `tg_same_tenant_*` (400 FOREIGN_KEY_VIOLATION). Validar en la app con mensaje claro. Esfuerzo: S.

**FIN-AC-06** · accounting · Eje 4 · Arquitectura · **Media**
- `reprovision` (controlador, `accounting.controller.ts:59+`) contiene lógica de negocio y transacción sobre `Organization`/`OrganizationSettings`. Mover a servicio. Esfuerzo: S.

## 7. Camino mínimo a producción
DO/genérico: FIN-AC-03 (S–M) → FIN-AC-01 (M) → FIN-AC-02 (S) → pruebas de cierre anual con dimensiones y divisas (M). AR/VE: además FIN-AC-04 (L). Retocar.

## 8. Camino a 100
1. Revaluación efectiva (+6, M). 2. Cierre anual por dimensión y readiness fiel (+5, M). 3. Ajuste por inflación real (+6 AR, L). 4. Calendario fiscal configurable por país (+3, M). 5. UI para mappings/reprovision (+2, S). 6. Romper ciclos de módulos (+3, M).

## 9. Competitividad
Básicas: presentes (cierre secuencial, por módulo, por cuenta, anual con traspaso). Faltan: revaluación operativa, ajuste por inflación (bloquea venta en AR), cierre asistido con tareas. Fuentes: conocimiento general de producto (confianza media/baja).

## 10. Fortalezas
Cierre en orden con `FOR UPDATE`; re-chequeo de período al contabilizar; reapertura bloqueada con ejercicio cerrado; asiento de cierre correcto al centavo; IS del año excluye el asiento de cierre; auditoría transaccional.

## 11. No verificado
Reapertura de ejercicio (`/year-end-close/reopen`); cierre por módulo (AP/AR/INV); bloqueo de cuenta en período; miembro sin permisos (429); depreciación previa al cierre (sin activos).

> Actualización 13:47 UTC: Miembro sin permisos (qa-do-a-member) verificado: 403 en GET/POST de journal-entries, chart-of-accounts, periods, journals, ledgers, recurrentes, plantillas, dimensions, balanza, balance, close-period, year-end-close y analytical query. Pendiente solo el ataque iniciado desde qa-do-b (se hizo en sentido inverso: desde qa-do-fin con IDs de qa-do-b y de otros tenants → 404/400).
