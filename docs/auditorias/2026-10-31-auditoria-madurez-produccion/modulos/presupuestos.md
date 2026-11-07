# Ficha M06 — Presupuestos y análisis de variaciones (`budgets`, `features/accounting/budgets`, `variance-analysis`)

Auditor: F4. 2026-11-01. Tenant qa-mx.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/budgets` (11 .ts, 1 spec `budgets.spec.ts`, ~990 LOC, 8 endpoints: CRUD, copia a períodos con factor, `variance`, `:id/vs-actual`). `budget-control.service.ts` lo consume `JournalEntriesService.enforceBudget` (asientos manuales) y AP (envío de facturas a aprobación). **No existe un módulo backend `variance-analysis`**: la pantalla `features/accounting/variance-analysis` consume `GET /budgets/variance` (`BudgetsService.variance`).
- **Frontend**: `features/accounting/budgets` (2 .ts) y `variance-analysis` (1 .ts).
- **Países**: N/A (genérico).

## 2. Estándar de referencia
- **Básicas**: presupuesto por cuenta/período (mensual/anual con reparto), por dimensión, real vs presupuesto, control (aviso o bloqueo), copia/ajuste.
- **Avanzadas**: versiones y escenarios, flujo de aprobación, presupuesto de compromisos (OC), forecast, importación desde Excel.
- **Líderes** (confianza media): BC con "G/L budgets" por dimensión; D365 Budgeting con control presupuestario por compromisos; NetSuite con presupuestos por clase/departamento y versiones; Xero/QBO con presupuestos simples.

## 3. Resultado
- **Madurez: 50** (42–58, confianza media). **Preparación: 52 — Piloto controlado (con reservas)**. Los "reales" heredan GL-01 (filtran `Posted`): la compuerta 2 se cumple solo cuando se corrija M02.
- **Eje más débil**: 12 Competitividad / 2 Corrección (por herencia). **Críticos**: 0 propios. **Altos**: 1.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad | 60 (50–68, media) | Presupuesto dic-2026 de 5600 por 100: asiento de 150 → 403 `entry_exceeds_budget_detail` (budgeted 100, actual 0); asiento de 80 → 201; `variance` → budgeted 100, actual 80, consumedRatio 0,8 | Versiones, reparto anual, importación |
| 2 | Corrección | 50 (40–58, media) | Cálculo correcto en la prueba; los reales filtran `Posted` (`budget-control.service.ts`, `budgets.service.ts`) → heredan GL-01 | Predicado común |
| 3 | País | N/A | — | — |
| 4 | Arquitectura | 58 (50–65, media) | Control aplicado solo a asientos `MANUAL` sin `systemReason`; AP también lo consulta | Política aviso/bloqueo configurable |
| 5 | Higiene | 55 (45–62, media) | Inyectado como `@Optional` en journal-entries para romper un ciclo | — |
| 6 | Calidad | 60 | — | — |
| 7 | Robustez | 55 (45–62, baja) | `checkBudget` dentro de la transacción del asiento, pero sin bloqueo: dos asientos concurrentes pueden pasar ambos el límite (no probado) | Bloqueo del presupuesto |
| 8 | Seguridad | 60 (50–68, baja) | IDOR no probado en budgets; lecturas por organización en código | Probar |
| 9 | Pruebas | 40 (30–50, media) | 1 spec | Integración control+asiento |
| 10 | Operabilidad | 55 | Mensaje de exceso con importes | — |
| 11 | UX | N/V 50 | — | — |
| 12 | Competitividad | 40 (30–50, media) | Solo mensual por cuenta/dimensión; sin versiones/escenarios ni compromisos de OC | — |

## 5. Compuertas
1 Cumple (real, sin mocks) · 2 Cumple con reserva (GL-01) · 3 No verificado por API (código filtra por organización) · 4 Cumple (formato `YYYY-MM` validado) · 5 Cumple en lo probado · 6 N/A · 7 Parcial · 8 No verificado.

## 6. Hallazgos
**BUD-01** · Integridad · **Alta (heredada)** · "real" = solo `Posted` → con asientos modificados el real queda subestimado y el control deja pasar gastos. Ver GL-01. Esfuerzo S.

**BUD-02** · Robustez · **Media** · Control sin bloqueo: carrera entre dos asientos que juntos exceden el presupuesto (inferido del código, no probado). Esfuerzo S.

**BUD-03** · Funcionalidad · **Media** · Bloqueo duro siempre (sin modo "aviso" ni tolerancia %); solo asientos manuales y facturas de AP (no OC/compromisos). Esfuerzo M.

**BUD-04** · Competitividad · **Media** · Sin versiones/escenarios, aprobación ni importación. Esfuerzo M/L.

## 7. Camino mínimo
GL-01 (S) → BUD-02 (S) → política aviso/bloqueo (M).

## 8. Camino a 100
Versiones/escenarios (+12) → compromisos de OC (+10) → importación y reparto anual (+8) → tests (+5).

## 9. Competitividad
Por encima de Alegra/Siigo (control duro integrado al asiento); por debajo de BC/D365/NetSuite.

## 10. Fortalezas
Control dentro de la transacción del asiento; presupuesto por dimensión; variance con detalle mensual.

## 11. No verificado
UI; copia con factor; presupuesto por dimensión en el control; IDOR. Cobertura ~35 %.

<!-- RESUMEN: modulo=presupuestos; madurez=50; prep=52; veredicto=Piloto controlado; eje_debil=12 Competitividad; criticos=0; altos=1; camino_min=M -->
