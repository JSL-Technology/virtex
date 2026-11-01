# Ficha M01 — Plan de cuentas (`chart-of-accounts`)

Auditor: F4 (Finanzas). 2026-10-31/11-01. Tenants: qa-mx (principal), qa-b (víctima).

> ## ⚠️ HALLAZGO CRÍTICO DE SEGURIDAD — escritura y lectura entre tenants vía `parentId` (COA-01)
> Desde la sesión de qa-b, `POST /api/v1/chart-of-accounts` con `parentId` = cuenta `5000 Gastos` de qa-mx → **201**. Efectos verificados:
> 1. qa-mx ve la cuenta de qa-b dentro de su propio árbol: `GET /chart-of-accounts/<5000 de qa-mx>` lista en `children` a `5991 "QA-F4 idor parent"` con `organizationId` de qa-b.
> 2. qa-b lee datos de qa-mx: `GET /chart-of-accounts/<5991>` devuelve `parent` = la cuenta de qa-mx (code, name, organizationId). Con cualquier UUID de cuenta ajena se pueden leer así sus datos.
> Además, `POST /accounting/lock-account-in-period` acepta un `accountId` de otro tenant (200; crea una fila en qa-b que apunta a una cuenta de qa-mx). Los datos de prueba se limpiaron por SQL tras verificar.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/chart-of-accounts` (29 .ts, 5 specs, ~2.900 LOC, 19 endpoints: CRUD, árbol, bloqueo/desbloqueo, desactivación masiva, fusión, segmentos, historial, importación). Tablas: `accounts` (árbol closure-table, `accounts_closure`), `account_segments`, `account_segment_definitions`, `account_history`, `account_hierarchy_versions`. Saldos: `account-balances.service.ts`.
- **Frontend**: `features/accounting/{chart-of-accounts, account-form, merge-accounts}`.
- **Países**: los 19 declarados reciben el mismo plan genérico de 56 cuentas (verificado en qa-mx: idéntico número que DO/US/CO según ENTORNO).
- **Dependencias**: journal-entries (`JournalQueryService` para movimientos), audit, BullMQ (`account-jobs`), localization (paquete fiscal).
- **¿Núcleo para vender?** Sí.

## 2. Estándar de referencia
- **Básicas**: catálogo jerárquico con tipos/naturaleza, cuentas de control (CxC, CxP, inventario, impuestos) protegidas contra asientos manuales, bloqueo de cuentas con movimientos (no se borran, solo se inactivan), plan localizado por país (MX: código agrupador SAT, Anexo 24; CO: PUC Decreto 2650; DO: catálogo de uso común; PE: PCGE; CL: plan habitual SII), importación/exportación.
- **Avanzadas**: segmentos/dimensiones en el código, versiones de jerarquía, fusión/reclasificación con rastro, mapeo a estados por país.
- **Invariantes**: aislamiento total del árbol por tenant; tipo/naturaleza coherentes; una cuenta con movimientos no cambia de tipo ni se borra; la fusión no reescribe historia contabilizada.
- **Líderes** (confianza media): NetSuite y D365 traen plantillas por país y prohíben modificar cuentas con transacciones salvo campos descriptivos; Odoo usa paquetes de localización (l10n_mx con agrupador SAT, l10n_co con PUC); CONTPAQi/Siigo/Alegra traen el catálogo oficial. La fusión en Odoo existe (“merge accounts”, v17+) pero solo para cuentas compatibles y deja rastro.

## 3. Resultado
- **Madurez: 25** (18–35, confianza media-alta) — topada por el eje 8 (COA-01 crítico de seguridad).
- **Preparación: 30 — No listo** (compuertas 3 y 6 incumplidas).
- **Eje más débil**: 8 Seguridad y aislamiento. **Críticos**: 2 (COA-01, COA-03). **Altos**: 2.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad | 50 (40–58, media) | CRUD, árbol, bloqueo y naturaleza coherente reales; la fusión no funciona (COA-02) | Fusión correcta; plan por país |
| 2 | Corrección | 45 (35–55, media) | Valida tipo/categoría/naturaleza (`assertCategoryFitsType`, contra-cuentas). El padre puede ser de otro tenant; no detecta ciclos; `PATCH parentId` responde 200 sin efecto | Validar padre (tenant, ciclos); persistir cambios de jerarquía |
| 3 | Multi-país | 25 (15–35, media) | qa-mx (MX) recibió cuentas dominicanas: `2141 AFP por Pagar (TSS)`, `2142 SFS por Pagar (TSS)`, `2143 SRL e INFOTEP`, `2160 Propina Legal`, `5250 Aportes Patronales (TSS/INFOTEP)`; `fiscalGroupingCode` nulo en las 56 | Paquetes por país con código agrupador SAT, PUC, etc. (verificar con contador) |
| 4 | Arquitectura | 55 (45–62, media) | Closure-table de TypeORM; la fusión se encola en BullMQ y reescribe líneas | Reclasificación por asiento |
| 5 | Higiene | 50 (40–58, media) | Importa `JournalQueryService` y `JournalEntryLine` de journal-entries; `account-balances` vive aquí y lo usan reportes y cierre | Separar lectura de saldos |
| 6 | Calidad | 55 (45–62, media) | Mensajes en español sin i18n en `BadRequestException` (naturaleza) y en `batchDeactivate`; `as any` en el historial | i18n uniforme |
| 7 | Robustez | 55 (45–62, baja) | `findAllForOrg` sin paginación (aceptable para catálogos); el job de fusión reintenta 3 veces un fallo determinista | — |
| 8 | Seguridad | 20 (10–30, alta) | COA-01 verificado; lock de cuenta de otro tenant | Validar `organizationId` de cada FK recibida; relaciones del árbol filtradas por tenant |
| 9 | Pruebas | 40 (30–50, media) | 5 specs; ninguno cubre padre de otro tenant ni fusión con movimientos contabilizados | Tests de aislamiento y de fusión |
| 10 | Operabilidad | 45 (35–55, baja) | El fallo de la fusión solo se ve en Redis (`bull:account-jobs:1 failedReason`) y por WebSocket | Estado del job consultable por API |
| 11 | UX | N/V 50 (baja) | No ejecutada | — |
| 12 | Competitividad | 35 (25–45, media) | Segmentos y versiones de jerarquía existen; sin catálogos oficiales | Catálogos por país |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin mocks / básicas | No cumple | Fusión rota; plan no localizado |
| 2 | Integridad | No cumple | Padre entre tenants; la fusión intenta reescribir historia |
| 3 | Aislamiento | **No cumple** | COA-01 |
| 4 | Validación servidor | Parcial | Tipo/naturaleza sí; padre no |
| 5 | E2E sin 500 | Cumple (en lo probado) | — |
| 6 | Cumplimiento por país | **No cumple** | Cuentas DO en tenant MX; sin agrupador SAT |
| 7 | Pruebas CI | Parcial | — |
| 8 | Auditoría | Parcial | `account_history` en update; bloqueo/desbloqueo con `auditTrailService.record` sin organizationId ni transacción |
| 9–12 | — | Ver informe global | — |

## 6. Hallazgos
**COA-01** · Seguridad · **CRÍTICA** · `chart-of-accounts.service.ts` `createInTransaction` (usa `parentId` sin comprobar organización) y `findOne` (relaciones `children`, `parent` sin filtro de tenant); `accounting/period-closing.service.ts` `lockAccountInPeriod`. Pasos y efectos en el recuadro inicial. **Forma correcta**: comprobar que cada id referenciado pertenece al `organizationId` del usuario; filtrar las relaciones; RLS efectivo con un rol no superusuario. **Impacto**: bloquea la venta. **Esfuerzo**: S.

**COA-02** · Funcionalidad falsa/bug · **Alta** · `account-jobs.processor.ts` (bucle `manager.update(JournalEntryLine, …, { accountId: destinationAccountId })`). Cuenta QA 5901 con 1 asiento contabilizado → `merge/preview` sin bloqueos → `POST /chart-of-accounts/merge` 200 "Se inició la fusión…" → el job falla 3 veces con `No se puede modificar la línea … de un asiento contabilizado` (trigger de M02). La cuenta sigue activa. Funciona solo con cuentas sin movimientos contabilizados, justo cuando no hace falta, y la UI anuncia éxito. **Forma correcta**: asiento de reclasificación de saldo + inactivación/redirección del origen. Esfuerzo M.

**COA-03** · Multi-país · **CRÍTICA (cumplimiento)** · Siembra (`localization` / paquete fiscal): el plan de qa-mx es el genérico dominicano (TSS, INFOTEP, Propina Legal) sin código agrupador SAT. La contabilidad electrónica MX requiere catálogo con agrupador (verificar con contador). Esfuerzo L (catálogos por país).

**COA-04** · Bug · **Media** · `PATCH /chart-of-accounts/:id` con `parentId` → 200 pero el padre no cambia (probado en la cuenta 5900 de qa-b): `accountRepo.merge` sobre la entidad con la relación `parent` cargada pisa el `parentId`. No se detectan ciclos. Esfuerzo S.

**COA-05** · Integridad · **Media** · Siembra con `effectiveFrom` = fecha de alta (ver GL-02 en M02). Esfuerzo S.

**COA-06** · Auditoría · **Baja** · bloquear/desbloquear audita fuera de la transacción y sin organización (`auditTrailService.record(userId,'accounts',…)`).

## 7. Camino mínimo
COA-01 (S) → COA-03 en los países que se vendan primero (MX, CO, DO) (L) → COA-02 rehacer como reclasificación (M) → COA-04 (S).

## 8. Camino a 100
COA-01 (+25 eje 8) → catálogos oficiales por país con mapeo a estados y agrupador (+20) → fusión por reclasificación (+8) → tests de aislamiento (+5) → UX verificada.

## 9. Competitividad
Brecha básica: catálogos oficiales (Alegra/Siigo/CONTPAQi/Defontana los traen). Diferenciadores: segmentos, versiones de jerarquía, historial de cambios.

## 10. Fortalezas
Validación tipo↔categoría↔naturaleza con contra-cuentas; prohibido cambiar tipo/código; bloqueo para contabilizar aplicado también a subledgers (en el servicio de asientos); historial de cambios.

## 11. No verificado
UI; importación de catálogo (`coa-import`); segmentos multi-nivel; desactivación masiva. Cobertura: ~40 % de archivos y ~35 % de endpoints.

<!-- RESUMEN: modulo=plan-de-cuentas; madurez=25; prep=30; veredicto=No listo; eje_debil=8 Seguridad; criticos=2; altos=1; camino_min=L -->
