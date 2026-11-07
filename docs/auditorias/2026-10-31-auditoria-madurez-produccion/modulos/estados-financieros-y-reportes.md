# Ficha M04 — Estados financieros y reportes (`financial-reporting`, `analytical-reporting`, `reports`, `bi`)

Auditor: F4. 2026-10-31/11-01. Tenant qa-mx.

> **CRÍTICO heredado (integridad)**: todos los reportes filtran `status = 'Posted'` (`chart-of-accounts/account-balances.service.ts:164`, `journal-query.service.ts:124,203,252`, vista `analytical_report_data`). Los asientos modificados (`Modified`) quedan fuera mientras su reversión sí cuenta, y el importe original se resta dos veces (ver GL-01 en M02). Balanza, balance, resultados y flujo cuadran entre sí (`isBalanced:true`) y aun así son falsos. El dashboard sí suma `Modified` (`dashboard-charts.service.ts:118`), así que las pantallas muestran cifras distintas.

## 1. Identificación
- **Backend**: `financial-reporting` (8 .ts, 1 spec, ~1.470 LOC, 4 endpoints: balance, resultados, balanza, flujo; guard `TemporalValidityGuard`; `comparative-reporting.service.ts`, herramientas copiloto); `analytical-reporting` (6 .ts, 0 specs, 3 endpoints: query, refresh-view, synchronize-view; vista materializada `analytical_report_data` refrescada por cron horario); `reports` (13 .ts, 2 specs, 4 endpoints: antigüedad, rentabilidad por producto/cliente, generate); `bi` (8 .ts, 1 spec, 1 endpoint `sales`).
- **Frontend**: `features/reports/{financial-statements, aging, profitability-by-product, profitability-by-customer, hub}`.
- **Países**: genérico; sin formatos oficiales por país en este módulo (los fiscales viven en compliance).
- **¿Núcleo?** Sí.

## 2. Estándar de referencia
- **Básicas**: balance, resultados, balanza de comprobación (saldos iniciales, movimientos, finales), flujo de efectivo (indirecto), comparativos por período, filtros por dimensión/libro, exportación (PDF/Excel), drill-down al asiento.
- **Avanzadas**: report builder, consolidado, presupuesto vs real, KPIs/BI, vistas analíticas.
- **Invariantes**: balanza = mayor; Activo = Pasivo + Patrimonio (+ resultado no cerrado); resultado del estado de resultados = variación del resultado en balance; flujo: caja inicial + variación = caja final; todos los reportes usan el mismo predicado de "asiento vigente".
- **Líderes** (confianza media): NetSuite/D365/BC ofrecen financial report builder con filas/columnas configurables y drill-down; Xero/QuickBooks traen reportes estándar con comparativos y exportación; Siigo/Alegra traen balance/PyG/balanza en formatos locales.

## 3. Resultado
- **Madurez: 40** (32–50, confianza media). **Preparación: 45 — No listo**.
- **Eje más débil**: 2. **Críticos**: 1 heredado (GL-01). **Altos**: 2.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad | 55 (45–62, media) | Los 4 estados responden con datos reales; filtro por dimensión funciona (`dimension=QA F4 Centro=VENTAS` → solo la línea etiquetada); `POST /analytical-reporting/query` mínimo válido → **500** | Analítica funcional; exportación (no verificada) |
| 2 | Corrección | 40 (30–50, alta) | Balanza rehecha a mano por SQL (valoraciones × cuentas): coincide en todas las cuentas salvo el importe de los asientos `Modified` (1110: 1.160,50 en débitos de nov.; apertura 100.000 vs 0). Estados coherentes entre sí: total balanza = balance; `unexplainedDifference:0` en flujo | GL-01; redondeo transversal `common/money.ts:77-84` (`toCents` en float: 1,25×18 % → 0,22, confirmado por otra familia) |
| 3 | Multi-país | 45 (35–55, baja) | Sin formatos oficiales por país aquí; nombres i18n por cuenta | Formatos locales (verificar con contador) |
| 4 | Arquitectura | 60 (50–68, media) | Saldos derivados en `AccountBalancesService` compartido | Predicado único de vigencia |
| 5 | Higiene | 55 (45–62, media) | Reportes dependen de chart-of-accounts para saldos | — |
| 6 | Calidad | 55 (45–62, media) | Analítica: `createQueryBuilder().from(view)` + `groupBy` reemplazado en cada dimensión (`qb.groupBy` no `addGroupBy`), `value: any` | Rehacer el query builder |
| 7 | Rendimiento | 60 (50–68, media) | Con 30.230 líneas: balanza 0,048 s, balance 0,041 s, resultados 0,042 s, **flujo 4,19 s**, mayor de una cuenta 0,046 s | Optimizar el flujo |
| 8 | Seguridad | 70 (60–78, media) | Balanza con `ledgerId` de qa-mx desde qa-b → 404; `@AuditAccess` en lecturas financieras | Probar roles restringidos |
| 9 | Pruebas | 40 (30–50, media) | 1 spec (flujo) en financial-reporting; 0 en analytical-reporting | Tests de cuadre cruzado con BD |
| 10 | Operabilidad | 40 (30–50, media) | El 500 de analítica se registra sin causa (`api4.log`: solo "500 INTERNAL_ERROR") | Log con causa |
| 11 | UX | N/V 50 | No ejecutada | — |
| 12 | Competitividad | 45 (35–55, media) | Sin report builder financiero verificable; BI mínimo (1 endpoint) | Builder de filas/columnas |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin mocks/básicas | Parcial | Estados reales; analítica con 500 |
| 2 | Integridad | **No cumple** | GL-01 propagado |
| 3 | Aislamiento | Cumple (probado en balanza y mayor) | 404 |
| 4 | Validación | Cumple | DTOs con whitelist |
| 5 | E2E sin 500 | **No cumple** | analítica 500 |
| 6 | País | No verificado | — |
| 7 | Pruebas CI | No cumple | Cobertura mínima |
| 8 | Auditoría | Cumple | `@AuditAccess` |

## 6. Hallazgos
**REP-01** · Integridad · **CRÍTICA (heredada de GL-01)** — predicado `Posted` en todos los lectores; ver M02. Esfuerzo S/M.

**REP-02** · Bug · **Alta** · `analytical-reporting/analytical-reporting.service.ts` `query()` — `POST /analytical-reporting/query {"ledgerId":<libro>,"dimensions":["account_code"],"measures":["debit"]}` → 500. Además la vista no tenía filas de qa-mx (0 filas con 30k líneas contabilizadas): la refresca un cron horario (`REFRESH MATERIALIZED VIEW CONCURRENTLY`), así que es obsoleta hasta 1 h. Causa probable (no confirmada en log): SELECT implícito `*` con GROUP BY. Esfuerzo S.

**REP-03** · Rendimiento · **Media** · flujo de efectivo 4,19 s con 30k líneas (el resto < 0,05 s). Esfuerzo S/M.

**REP-04** · Corrección · **Alta (transversal)** · redondeo en `common/money.ts:77-84` (`toCents` en float), confirmado por otra familia; afecta importes derivados (impuestos/conversiones) que alimentan los reportes. Esfuerzo S.

**REP-05** · Signos · **Baja** · el estado de resultados devuelve ingresos y gastos con signo contable (gasto −50, `netIncome` −50) y el balance devuelve el activo deudor como negativo (`amount:-100005.5` cuando la cuenta era acreedora). La convención no está documentada para el consumidor. Verificar con UI.

## 7. Camino mínimo
GL-01 (S) → REP-02 (S) → REP-04 (S) → tests de cuadre cruzado balanza=balance=resultados=flujo con BD (M).

## 8. Camino a 100
Corrección (+20) → report builder y exportaciones verificadas (+12) → formatos por país (+8) → BI real (+8) → rendimiento (+4).

## 9. Competitividad
Faltan report builder financiero, drill-down verificado y BI; existen comparativos (servicio) y filtros por dimensión, que Alegra no tiene.

## 10. Fortalezas
Un único servicio de saldos sobre valoraciones; los estados cuadran entre sí; filtros por dimensión y libro; auditoría de acceso.

## 11. No verificado
Report builder (`POST /reports/generate`), antigüedad, exportaciones PDF/Excel, UI, BI con datos de ventas (`/bi/sales` exige `dimensions`, no probé más). Rentabilidad por producto: 200 vacía (sin ventas en el tenant). Cobertura ~30 %.

<!-- RESUMEN: modulo=estados-financieros-y-reportes; madurez=40; prep=45; veredicto=No listo; eje_debil=2 Corrección; criticos=1; altos=2; camino_min=M -->
