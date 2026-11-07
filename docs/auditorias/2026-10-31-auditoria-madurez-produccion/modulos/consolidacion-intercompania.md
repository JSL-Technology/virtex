# Ficha M05 — Consolidación e intercompañía (`consolidation`, `intercompany`)

Auditor: F4. 2026-11-01. Tenant qa-mx (sin subsidiarias).

## 1. Identificación
- **Backend**: `consolidation` (10 .ts, 2 specs con 18 casos, ~1.330 LOC, 3 endpoints: `POST /consolidation/run`, `GET/POST /consolidation/mapping`); `intercompany` (6 .ts, 0 specs, ~825 LOC, 4 endpoints: crear, listar, pendientes, reintentar). La consolidación se calcula al vuelo (no persiste asientos de eliminación): balance y resultados de cada miembro por `FinancialReportingService`, conversión con tasas de cierre/histórica/promedio (`ExchangeRateResolver`), eliminación de inversión, saldos intragrupo derivados de `intercompany_transactions` e interés minoritario (`nonControlling*`).
- **Frontend**: **sin UI**. Grep de `consolidation|intercompany` en `core/modules/manifests/*.ts` → 0; solo aparece en ajustes (`settings/organization/subsidiaries`, cuentas por defecto). Confirmado.
- **Plan**: `POST /consolidation/run` en qa-mx → 403 `saas.feature_disabled (group_consolidation)`. No se pudo ejecutar E2E.

## 2. Estándar de referencia
Consolidación multi-entidad con conversión NIC 21 (activos/pasivos al cierre, patrimonio histórico, resultados promedio, CTA en patrimonio), eliminaciones de saldos y transacciones intragrupo (ingresos/costos, utilidades no realizadas en inventario), interés no controlador, asientos de eliminación persistidos y auditables, intercompañía con contrapartida automática en la otra entidad. Líderes (confianza media): NetSuite OneWorld (intercompany journal + elimination subsidiary), D365 (consolidation online, intercompany accounting), BC (business units/consolidation).

## 3. Resultado
- **Madurez: 35** (25–45, confianza baja: no ejecutable por plan). **Preparación: 30 — No listo** (sin UI; flujo principal no verificable).
- **Eje más débil**: 1 Autenticidad (sin UI). **Críticos**: 0 verificados. **Altos**: 3.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad | 30 (20–40, media) | Solo API, sin pantallas; no se puede usar desde el producto | UI |
| 2 | Corrección | 45 (30–55, baja) | Conversión por tipo de tasa e interés minoritario en código; intragrupo de ingresos/gastos NO se elimina (`consolidation.service.ts:936-941`, `void revenueLines; void expenseLines`); hereda GL-01 vía `FinancialReportingService` | Eliminación de transacciones intragrupo; persistencia |
| 3 | País | 45 (baja) | NIC 21/NIIF 10 citadas; verificar con contador | — |
| 4 | Arquitectura | 50 (40–58, media) | Cálculo al vuelo sin snapshot: no se puede auditar una consolidación pasada | Persistir corrida |
| 5 | Higiene | 50 | Depende de financial-reporting, organizations, currencies, intercompany | — |
| 6 | Calidad | 55 | — | — |
| 7 | Robustez | 45 (baja) | Reintentos de intercompañía con `recordFailure`/`retry` | — |
| 8 | Seguridad | 62 (50–70, media) | Intercompañía qa-mx→qa-b (sin grupo común) → 403 `organizations_not_same_group`; mapeo valida `assertIsSubsidiaryOf` con log `[SECURITY]`; las subsidiarias solo se crean nuevas (no se puede vincular un tenant ajeno) | — |
| 9 | Pruebas | 35 (25–45, media) | 18 casos en consolidation; 0 en intercompany | — |
| 10 | Operabilidad | 40 | — | — |
| 11 | UX | 10 (alta) | Sin UI | — |
| 12 | Competitividad | 30 | — | — |

## 5. Compuertas
1 **No cumple** (sin UI) · 2 No verificado · 3 Cumple en lo probado (intercompañía entre grupos → 403) · 4 Cumple (DTO) · 5 No verificado · 6 No verificado · 7 Parcial · 8 No verificado.

## 6. Hallazgos
**CON-01** · Funcionalidad · **Alta** · Sin UI para consolidación ni intercompañía (manifiestos sin rutas). Esfuerzo M.

**CON-02** · Corrección · **Alta** · No se eliminan ingresos/gastos intragrupo ni utilidades no realizadas (`consolidation.service.ts:936-941`): el estado de resultados consolidado queda sobrestimado. Esfuerzo M.

**CON-03** · Arquitectura/auditoría · **Alta** · La consolidación no persiste asientos de eliminación ni snapshot; no es reproducible ni auditable. Esfuerzo M/L.

**CON-04** · Pruebas · **Media** · intercompany sin specs. Esfuerzo S.

## 7–8. Camino mínimo / a 100
UI (M) → CON-02 (M) → CON-03 (M/L) → tests (S); luego CTA/NIC 21 verificado con contador (+10).

## 9. Competitividad
Brecha grande frente a NetSuite OneWorld/D365; los locales (Alegra, Siigo) no lo ofrecen, así que podría ser diferenciador si se completa.

## 10. Fortalezas
Controles de grupo en intercompañía y en mapeos; conversión por tipo de tasa; interés minoritario modelado.

## 11. No verificado
Ejecución de la consolidación (feature deshabilitada en el plan), intercompañía entre empresas del mismo grupo, conversión de moneda. Cobertura ~25 %.

<!-- RESUMEN: modulo=consolidacion-intercompania; madurez=35; prep=30; veredicto=No listo; eje_debil=1 Autenticidad (sin UI); criticos=0; altos=3; camino_min=M -->
