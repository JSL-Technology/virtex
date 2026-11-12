# Ficha — `budgets` (presupuestos, control y análisis de variación) — Familia FIN-B

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/budgets/` (11 archivos, 1.549 líneas): `budgets.controller.ts` (7 endpoints: CRUD, `:id/copy`, `:id/vs-actual`, `variance`), `budgets.service.ts` (439), `budget-control.service.ts` (209, usado por `journal-entries.service.ts:880-930` y `accounts-payable.service.ts:627`). Tablas `budgets` (`UQ_budgets_org_period`), `budget_lines` (jsonb `dimensions`).
- **Frontend**: `features/accounting/budgets/`, `features/accounting/variance-analysis/variance-analysis.page.ts`, `data/budgets.service.ts`.
- **Pruebas**: `budgets.spec.ts` (557) — pasó en suite global.
- Países: genérico. Núcleo para vender: medio (exigido en mid-market).

## 2. Estándar de referencia
(a) Básicas: presupuesto anual con distribución mensual, versiones/escenarios (original, revisado, forecast), por centro de costo/dimensión, copia con factor, presupuesto vs real con variación y %, favorable/desfavorable por naturaleza, control presupuestario configurable (avisar/bloquear/sin control) con tolerancia, compromisos (OC). Avanzadas: aprobación, workflow, driver-based, importación Excel, rolling forecast.
(b) Invariantes: real = mayor del mismo rango y libro; solo meses presupuestados se comparan; el control nunca impide registrar ingresos.
(c) Líderes: NetSuite Budgets (por subsidiaria/departamento/clase, varias categorías), D365 Budget control (avisar/bloquear, tolerancias, ciclos), Odoo Budgets (posiciones y analíticas), Xero/QuickBooks (varios presupuestos por año) — confianza media.
(d) Construcción: encabezado (año, versión, estado) + líneas (cuenta, dimensión, mes).

## 3. Resultado
- **Madurez: 42 (36–48, confianza alta)**.
- **Preparación comercial: 38 — Veredicto: No listo** (compuertas 1 y 2 incumplidas).
- Eje más débil: 2 Corrección (control bloquea ingresos; variación mezcla meses sin presupuesto).
- Críticos: 0; altos: 3.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Completitud | 38 (30–45, alta) | CRUD, copia con factor (×1,05 → 13.125), vs-actual y variance reales contra el mayor. Un solo presupuesto por tenant y mes (FINB-22); sin año, versión, estado/aprobación, moneda | Modelo con versión/escenario/año |
| 2 Corrección | 40 (32–48, alta) | vs-actual Nov: 5500 real 3.000 = asiento DEPREC de nov ✓, difference −500, ratio 1,2. Pero ingreso sobre presupuesto bloqueado (FINB-20) y variance ene–dic suma reales de 11 meses sin presupuesto (FINB-21); dimensiones por igualdad exacta (FINB-23) | Ver hallazgos |
| 3 Multi-país | N/A | genérico, sin reglas por país | — |
| 4 Arquitectura | 55 (48–62, media) | Lógica en servicio; dos implementaciones casi idénticas de "real" (`budgets.service.ts:223-241` y `:366-387`, más `budget-control.service.ts:108-141`) | Un único cálculo de real |
| 5 Higiene | 55 (48–62, media) | Consulta directa a `JournalEntryLine`, `Ledger`, `Account` de otros módulos | Puerto de saldos de contabilidad |
| 6 Calidad | 62 (55–70, media) | Líneas vacías/residuos en controller (`budgets.controller.ts:30,37,79,90`), `UseGuards` importado sin uso | Limpieza |
| 7 Robustez | 58 (50–65, media) | Transacciones en create/update/copy; `findAll` sin paginación (bajo volumen) | Paginación |
| 8 Seguridad | 80 (72–86, alta) | qa-do-b: GET, vs-actual, PATCH, copy, DELETE → 404; listado vacío; member → 403 (GET, variance); cuenta de otro tenant en línea → 400 `budgets.account_not_found` | — |
| 9 Pruebas | 50 (42–58, media) | spec cubre cálculos; no detecta FINB-20/21 | Casos de ingreso y rango |
| 10 Operabilidad | 40 (32–48, alta) | Tras PATCH y DELETE, `audit_logs` solo tiene CREATE de budgets/budget_lines (FINB-24) | Auditoría |
| 11 UX | 45 (30–55, baja) | Pantallas existen; no ejercidas (rutas directas no resueltas); error de control expone clave `budgets.amount_exceeds_budget` como parámetro | — |
| 12 Competitividad | 30 (24–38, media) | Muy por debajo de NetSuite/D365/Odoo | §9 |

## 5. Compuertas
1 **No cumple** (FINB-22) · 2 **No cumple** (FINB-20, FINB-21) · 3 Cumple · 4 Cumple (decimales: 10000.555 → 400) · 5 Cumple (sin 500) · 6 N/A · 7 Parcial · 8 No cumple · 9 Cumple · 10 Parcial · 11 No verificado · 12 No cumple.

## 6. Hallazgos
**FINB-20** · budgets/journal-entries · eje 2 · Bug · **Alta** · `budget-control.service.ts:147-153`, `journal-entries.service.ts:~893-930`. El control trata ingresos igual que gastos: con presupuesto 4100 = 10.000, `POST /journal-entries` (Bancos D 20.000 / 4100 C 20.000, 10-11-2026) → **403 `journal_entries.entry_exceeds_budget_detail`**. Vender más de lo presupuestado impide contabilizar. Además el control es siempre bloqueo duro, sin modo aviso ni tolerancia ni configuración (grep `budget` en `organization-settings.entity.ts` sin resultados). Forma correcta: controlar solo gasto/consumo; modo none/warn/block con tolerancia por tenant. Impacto: riesgo operativo/bloquea. S–M.

**FINB-21** · eje 2 · Bug de cálculo · **Alta** · `budgets.service.ts:187-241`. `GET /budgets/variance?fromPeriod=2026-01&toPeriod=2026-12` con solo noviembre presupuestado: 5500 presupuesto 2.500 vs real **34.098,13** (todo ene–nov: 12.917,75+80,38+100+21.000), ratio 13,64. El real debe limitarse a los meses presupuestados (o mostrar real por mes). M.

**FINB-22** · eje 1/12 · Capacidad básica ausente · **Alta** · `entities/budget.entity.ts:29` (`UQ_budgets_org_period`), `budgets.service.ts:281-284`. Segundo presupuesto para 2026-11 → 409 `budgets.period_already_budgeted`. No hay escenarios, versiones, presupuestos por departamento/sucursal, ni presupuesto anual (cada mes es un documento). Rehacer modelo (año + versión + líneas por mes). L.

**FINB-23** · eje 2 · Semántica · Media · `budget-control.service.ts:123-137`, `budgets.service.ts:200-241`. Línea sin dimensiones solo cuenta reales con `dimensions = {}`: el gasto etiquetado con centro de costo queda fuera del presupuesto de la cuenta; la clave `JSON.stringify` depende del orden de claves frente al orden normalizado de jsonb (posible desajuste con ≥2 dimensiones). Evidencia por código (no ejecutado). M.

**FINB-24** · eje 10 · Auditoría · Media · `budgets.service.ts:121-133, 139` (update/delete por criterio). Cambios y borrados de presupuesto sin rastro. S.

**FINB-25** · eje 11 · Baja · `budgets.service.ts:86`: total del listado suma ingresos + gastos (13.125) — cifra sin significado. S.

## 7. Camino mínimo
1. FINB-20 (S). 2. FINB-21 (M). 3. FINB-22 rediseño de modelo con migración (L). 4. FINB-23/24 (M/S). Rehacer el modelo de datos; el cálculo de reales se reutiliza.

## 8. Camino a 100
Modelo año/versión/escenario/dimensión (+20, L); control configurable con compromisos de OC (+10, M); aprobación y workflow (+6, M); importación Excel (+5, S); forecast (+5, L); un solo cálculo de reales (+4, S).

## 9. Competitividad
Faltan básicas (múltiples presupuestos, versiones, anual). Diferenciador: control integrado al asiento manual y a CxP. Fuentes: conocimiento general de NetSuite/D365/Odoo (confianza media).

## 10. Fortalezas
Real tomado de valuaciones del libro por defecto y estados contables reales; signo por naturaleza de cuenta; aislamiento correcto; copia con factor.

## 11. No verificado
Pantallas; dimensiones en ejecución real; control en CxP (familia CMP).
