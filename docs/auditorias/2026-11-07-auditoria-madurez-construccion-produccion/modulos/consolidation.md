# Ficha — `consolidation` (consolidación multi-empresa) — Familia FIN-B

> ⚠️ CRÍTICO: FINB-30 — la eliminación inversión-patrimonio es solo informativa: la cuenta de inversión de la matriz y el patrimonio preadquisición de la subsidiaria permanecen y el goodwill se SUMA encima; el activo y el patrimonio consolidados quedan inflados (evidencia por lectura de código; no ejecutable en QA).

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/consolidation/` (10 archivos, 1.953 líneas): `consolidation.controller.ts` (`POST /consolidation/run`, `@CheckFeature('group_consolidation')`), `consolidation-mapping.controller.ts` (`GET /consolidation/mapping/:subsidiaryId`, `POST /consolidation/mapping`), `consolidation.service.ts` (966). Tabla `consolidation_maps`; usa `organization_subsidiaries`, `intercompany_transactions`, reportes de `financial-reporting`.
- **Frontend**: **ninguna pantalla** llama a `consolidation/run` ni a `consolidation/mapping` (`grep -rln "consolidation/run" apps/core/client-web/src` → vacío). Existe `features/settings/organization/subsidiaries/` (alta/edición de subsidiarias).
- **Pruebas**: `consolidation.spec.ts` (485), `consolidation-mapping.spec.ts` (134) — pasaron en suite global.
- Núcleo para vender: sí para grupos (enterprise).

## 2. Estándar de referencia
(a) Básicas: perímetro con % de control y fechas, mapeo de planes, conversión NIC 21 (cierre/promedio/histórica) con CTA acumulado, eliminación inversión-patrimonio con goodwill e interés minoritario (NIIF 10/3), eliminación de saldos y transacciones intragrupo (incl. ingresos/costos y margen no realizado), resultados persistidos y reproducibles, auditoría. Avanzadas: subconsolidaciones, método de participación, ajustes manuales de consolidación, rollforward.
(b) Invariantes: activos = pasivos + patrimonio consolidados; cada eliminación cuadra en ambos lados; ingresos intragrupo = costos intragrupo eliminados.
(c) Líderes: SAP Group Reporting, Oracle FCCS, NetSuite OneWorld (consolidación en tiempo real con eliminaciones automáticas), D365 Consolidation — confianza media.
(d) Construcción: corrida persistida (encabezado + líneas + asientos de eliminación) en un libro de consolidación.

## 3. Resultado
- **Madurez: 25 (18–35, confianza media** — no pude ejecutarla: todos los tenants QA están en plan Starter con `group_consolidation` deshabilitado y cuota `SUBSIDIARIES` 0).
- **Preparación comercial: 20 — Veredicto: No listo**.
- Eje más débil: 2 Corrección. Críticos: 1.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Completitud | 25 (18–32, media) | Endpoint sin UI; resultado no persistido (solo respuesta JSON); no se puede incorporar una empresa existente como subsidiaria (`organizations.service.ts:200-288` siempre crea una nueva) | UI, persistencia, adquisición de entidad existente |
| 2 Corrección | 20 (12–30, media) | FINB-30, FINB-31, FINB-32, FINB-34 | Eliminaciones reales |
| 3 Multi-país | 40 (30–50, baja) | Conversión por moneda funcional, sin país por defecto | — |
| 4 Arquitectura | 40 (32–48, media) | Servicio de 966 líneas con lectura de estados de otras empresas en una sola request síncrona | Corrida en cola, persistida |
| 5 Higiene | 40 (32–48, media) | Importa entidades de organizations, intercompany, currencies, financial-reporting directamente (`consolidation.module.ts`) | Puertos |
| 6 Calidad | 60 (52–68, media) | Legible, comentarios NIIF | — |
| 7 Robustez | 40 (30–50, baja) | N empresas × (balance + resultados + balance a adquisición) + tasa por mes, en la request | Asíncrono |
| 8 Seguridad | 65 (55–72, media) | Feature flag + `financials:consolidate`; member → 403 en run y mapping; finb → 403 `saas.feature_disabled`; mapping valida cuentas por empresa. El perímetro solo lo crea el dueño con step-up. Lee datos de otros tenants por diseño (`getBalanceSheet(member.organizationId)`) — aceptable solo dentro del grupo creado por el propio dueño | Prueba real de perímetro |
| 9 Pruebas | 40 (30–50, baja) | specs existen; no detectan FINB-30/31 | Caso numérico completo con goodwill |
| 10 Operabilidad | 30 (22–40, media) | Sin registro de corridas ni auditoría | — |
| 11 UX | 10 (5–20, alta) | Sin pantalla ni menú | Pantalla |
| 12 Competitividad | 20 (12–28, media) | Lejos de NetSuite OneWorld | — |

## 5. Compuertas
1 **No cumple** (sin UI, sin persistencia) · 2 **No cumple** (FINB-30/31) · 3 Parcial (no verificado en ejecución) · 4 Cumple (DTO) · 5 No verificado · 6 N/A · 7 No cumple · 8 No cumple · 9 Cumple · 10 No cumple · 11 No cumple · 12 No cumple.

## 6. Hallazgos
**FINB-30** · eje 2 · Cálculo contable incorrecto · **Crítica** · `consolidation.service.ts:442-452, 480, 772-825`. `eliminateInvestment` calcula `arising = acquisitionCost − parte de activos netos` y solo empuja una entrada informativa a `eliminations`; nunca reduce la línea de `investmentAccountId` en `assetLines` ni el patrimonio preadquisición de la subsidiaria en `equityLines`. Luego `totalAssets = Σ activos + goodwill` y `totalEquity = totalAssets − totalLiabilities`. Resultado: activo inflado en (costo de inversión + goodwill) y patrimonio igual (el "cuadre" es por construcción). Forma correcta: asiento de eliminación (D patrimonio sub preadq. + goodwill, C inversión, C/ D interés minoritario). Impacto: bloquea la venta. M. (Confianza media: lectura de código; no ejecutable en QA.)

**FINB-31** · eje 2 · Bug · **Alta** · `consolidation.service.ts:852-913` + `intercompany.service.ts:180-195, 314-329`. La eliminación intragrupo reduce `fromAccountId` en activos y `toAccountId` en pasivos, pero en intercompañía esas son las cuentas de **efectivo** (origen: C `fromAccountId`; destino: D `toAccountId`, que es activo); las cuentas CxC/CxP intragrupo (`defaultIntercompany*`) quedan sin eliminar y se rebaja caja. Además toma transacciones del período (flujos) en lugar de saldos pendientes a la fecha. M.

**FINB-32** · eje 2 · Capacidad ausente · Alta · `consolidation.service.ts:935-940` (`void revenueLines; void expenseLines`): ingresos/gastos intragrupo nunca se eliminan (NIIF 10.B86(c)). M.

**FINB-33** · eje 11 · UX · Alta · sin pantalla/menú (grep en client-web). M.

**FINB-34** · eje 2 · Media · `consolidation.service.ts:365-372, 592-595`: todo el patrimonio a tasa histórica de adquisición (incluye resultados posteriores), promedio = media simple de cierres mensuales; CTA no persistido (se recalcula cada vez, sin acumulado histórico). M.

**FINB-35** · eje 1 · Media · `organizations.service.ts:200-288`: solo se pueden crear subsidiarias nuevas; no se puede vincular una organización existente (adquisición). M.

## 7. Camino mínimo
1. FINB-30/31/32 rehacer motor de eliminaciones como asientos en libro de consolidación (L). 2. Persistir corridas (M). 3. UI (M). 4. Pruebas numéricas con goodwill/NCI/ME (M). Rehacer el motor; conservar conversión y mapeo.

## 8. Camino a 100
Motor de eliminaciones correcto (+25, L); corrida persistida/reproducible y auditada (+10, M); UI con drill-down (+10, M); CTA acumulado y tasas históricas por partida (+6, M); margen no realizado en inventario (+5, L); ajustes manuales (+4, S).

## 9. Competitividad
NetSuite OneWorld/D365/SAP consolidan en tiempo real con eliminaciones automáticas; aquí ninguna eliminación afecta las cifras. Fuentes: conocimiento general (confianza media).

## 10. Fortalezas
Estructura NIC 21 (cierre/promedio/histórica) explícita; advertencias útiles (cuentas sin mapear, entidad descuadrada, fin de control); NCI calculado; feature flag.

## 11. No verificado
Ejecución real (plan Starter en todos los tenants QA; cambiar plan implicaría Stripe/escritura directa en BD, prohibido). Confianza media en todo el módulo.
