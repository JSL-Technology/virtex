# Ficha: `bi` + `dashboard` + `overview` + `reports` (no financieros) — familia IA

⚠️ CRÍTICO: **IA-B01** — el KPI "EBITDA" del tablero principal devuelve la utilidad neta (`dashboard.service.ts:184-196`): cifra financiera mal calculada presentada como real a todos los inquilinos.

## 1. Identificación
- **Backend:** `bi/` (7 archivos, 434 líneas; `GET /bi/sales` + seeder de `dim_time`), `dashboard/` (16 archivos, 1.161 líneas; 16 rutas `GET /dashboard/*`: summary, sales-trend, expense-breakdown, budget-vs-actual, invoice-status, top-products, low-stock, alerts, 9 `kpi/*`, consolidated-cash-flow-waterfall), `overview/` (4, 480; `GET /overview/activity|events`), `reports/` (11, 1.107; `GET /reports/aging`, `profitability/by-product|by-customer`, `POST /reports/generate`). Copiloto: `dashboard.copilot-tools.ts`.
- **Frontend:** `features/dashboard` (24 archivos, 2.743 líneas; widgets embebidos en `/e/<org>/overview`), `features/overview` (460), `features/reports` (1.113; hub, rentabilidad), menú `analisis.manifest.ts` (basePath `reports`: hub, data-quality, manager-report, anomalies, profitability-by-product/customer, relationship-map).
- **Pruebas:** `dashboard-charts.spec.ts`, `overview.spec.ts`, `profitability.spec.ts`, `reports.service.spec.ts`, `bi` 1 spec — con BD real; **pasan** (15 suites/118 tests junto con ai, `DB_HOST`→`virteex_test`).
- **Países:** todos (cifras en moneda base). **¿Núcleo?** Sí: el tablero es la primera pantalla.

## 2. Estándar de referencia
- (a) Básicas: KPIs con período explícito y comparativo real, que concilian con contabilidad; ventas/cobros/inventario del día; antigüedad de saldos; rentabilidad por producto/cliente; filtros por fecha/sucursal; exportación. Avanzadas: cubo/BI ad hoc, tableros configurables, alertas.
- (b) Invariantes: un KPI dice lo que su nombre dice (EBITDA = utilidad operativa + D&A; margen neto sobre el período); anulados y notas de crédito no suman ventas; cifras = SQL de los documentos/libro; aislamiento por inquilino.
- (c) Líderes: QuickBooks/Xero muestran P&L y flujo con período seleccionable (alta, conocimiento público); NetSuite KPIs con comparativo de período configurable (media); Odoo tableros con filtros de fecha (alta). Definición de EBITDA: estándar financiero (alta).
- (d) Construcción: capa de métricas con definiciones únicas, período como parámetro, caché por inquilino con TTL e invalidación por evento.

## 3. Resultado
- **Madurez: 40 (33–48, confianza media).** Preparación comercial: 38. **Veredicto: No listo** (crítico abierto; compuerta 1 y 5 incumplidas).
- Eje más débil: 2 (corrección de KPIs).
- Críticos abiertos: IA-B01.

### Pruebas ejecutadas
- `qa-do-fac` (10 facturas Pending, 17.522,96 en SQL): `/dashboard/summary` → `pendingInvoices:10, pendingInvoicesAmount:17522.96` ✓ = SQL; `/dashboard/invoice-status` ✓; `sales-trend` nov-2026 17.522,96 ✓. `activeCustomers:1` = SQL (`ACTIVE` 1, `LEAD` 1) ✓.
- KPI que se mueve: qa-do-xflow crea cliente `QA-IA KPI Cliente` → nace `LEAD`, `activeCustomers` sigue 1 = SQL (coherente; no demuestra movimiento). Ventas: no se emitieron facturas (riesgo e-CF/DGII, aviso 14:05); el movimiento se evidencia con datos de FAC (ventas de nov = facturas reales).
- KPIs fac: `ebitda 14871.72` = utilidad neta; `netMargin 100`, `roe 100`, `roa 84.87`, `currentRatio 6.61`, `fcf 0 (periodStart 2026-01-01)`.
- `GET /reports/aging` (qa-do-fac, qa-do-tes) → **500** `TypeORMError: Relation with property path journalEntry in entity was not found` (`customer-payments.service.ts:157` desde `reports.service.ts:77`); sin facturas → 200 con mensaje en español fijo.
- `GET /bi/sales?dimensions=month&measures=total_amount` → **500** `relation "sales_cube_view" does not exist`; `dim_time` con 0 filas.
- Rentabilidad por cliente 2026 → 200, costo 0 y aviso "12 línea(s) … margen sobrestimado" (honesto ✓). Member: `/reports/aging` 403 ✓.
- `/overview/activity|events` sin `@HasPermission` pero filtrado por permiso de documento (`overview.service.ts:21-80`, pruebas `overview.spec.ts:167,265`) ✓.
- UI (Playwright, qa-do-fac): tablero muestra EBITDA "RD$14,871…." truncado y subtítulos "vs presupuesto", "vs año anterior", "vs trimestre anterior" **sin cifra comparativa** (la API no la devuelve); 13 llamadas `/dashboard/*` 200; error de consola 403 `ai/copilot/charts/pinned` en cada página (IA-01).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 45 (38–52, media) | Los widgets que eran literales ahora leen la API (comentarios `financial-ratios.ts:31`, `recent-activity.ts:17` verificados contra el código); pero BI es código muerto que da 500, `/reports/aging` duplicado roto, comparativos de KPI rotulados sin dato. | Retirar o reparar BI y aging; comparativos reales. |
| 2 Corrección | 35 (28–44, media) | EBITDA = utilidad neta (IA-B01); "Ventas de hoy" suma anuladas y notas de crédito en positivo (IA-B03); KPIs de saldo acumulado sin período mientras FCF es año en curso (IA-B04); `CURRENT_DATE` del servidor, no zona del inquilino. Montos en `number`. | Capa de métricas con período y definiciones; pruebas por KPI. |
| 3 Multi-país | 55 (45–62, baja) | Moneda base y `total_in_base_currency`; mensaje fijo en español en aging (`reports.service.ts`); zona horaria no considerada. | i18n de mensajes; zona horaria por org. |
| 4 Arquitectura | 50 (42–58, media) | `dashboard.service.ts` mezcla ratios con caché; quick ratio carga todos los productos en memoria (`dashboard.service.ts:126-127`) y mezcla inventario operativo con saldo contable; `CacheModule.register()` local en `dashboard.module.ts:17` (memoria por instancia, no Redis). | Servicio de métricas sobre `account_balances`; caché compartida. |
| 5 Higiene | 45 (38–52, media) | Módulo `reportes`: dashboard 11 private-import + 11 forbidden-dependency, overview 7+4 + 5 foreign-entity-registration, reports 2+2+2; ciclo `plataforma ↔ reportes` (`shared/permissions.ts:22`). | Consumir contratos de contabilidad/ventas. |
| 6 Calidad código | 58 (50–65, media) | Lint: bi 5, dashboard 1, reports 9, features/dashboard 30 warnings; `getAgingReport(): Promise<any>`; comentarios "NEW/CHANGED … como en tu ejemplo" en `top-products-chart.ts:147,180`. | Limpiar. |
| 7 Robustez | 50 (42–58, media) | TTL `3600` con cache-manager 7 (ms) = 3,6 s en vez de 1 h (IA-B07); quick ratio O(productos) por petición; 13 peticiones por carga del tablero. | Endpoint agregado; TTL correcto. |
| 8 Seguridad | 72 (64–78, media) | Todas las rutas con permiso salvo overview (justificado y probado); BI con lista blanca de columnas y `organization_id` fijo (`bi.service.ts:95-125`); sin IDs en rutas de reportes → sin IDOR. | Pruebas de aislamiento en dashboard summary. |
| 9 Pruebas | 55 (46–62, media) | Integración con BD real para charts/overview/profitability; **sin pruebas** de `summary`, de los 9 KPI ni de `/reports/aging` (no detectaron el 500 ni EBITDA). | Pruebas por KPI con libro sembrado. |
| 10 Operabilidad | 55 (48–62, media) | Errores 500 registrados con stack; sin auditoría (lectura). | — |
| 11 UX | 52 (44–60, media) | Tablero configurable ("Editar diseño"), estados vacíos ("No hay presupuesto definido"); valor truncado; rótulos comparativos sin valor; hub ofrece IA fuera de plan. | Comparativos o quitar rótulos; formato compacto. |
| 12 Competitividad | 45 (36–52, baja) | Sin selector de período en KPIs, sin drill-down a asientos, BI ad hoc inexistente en la práctica; rentabilidad por producto/cliente presente. | Período/sucursal, drill-down, exportación. |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | **No cumple** | EBITDA falso; BI muerto; comparativos rotulados sin dato. |
| 2 Integridad | N/A (solo lectura) | — |
| 3 AuthZ/aislamiento | Cumple | Permisos por ruta; overview filtrado y probado; consultas con `organization_id`. |
| 4 Validación | Cumple | DTOs (fechas requeridas, whitelist). |
| 5 Humo sin 500 | **No cumple** | `/reports/aging` y `/bi/sales` → 500. |
| 6 País | N/A | — |
| 7 Pruebas CI | No cumple | KPIs sin pruebas; CI global en rojo. |
| 8 Auditoría | N/A | Lectura. |
| 9 Migraciones | No cumple (parcial) | `sales_cube_view` eliminada por `1726168695000-RefactorAnalyticalViewForDynamicDimensions.ts:9` y nunca recreada; la entidad sigue registrada. |
| 10 Observabilidad | Cumple | 500 con stack en log. |
| 11 UI | Cumple con reservas | IA-01; rótulos sin dato. |
| 12 Documentación | Cumple con reservas | Ayuda "informe-del-gerente"; sin definiciones de KPI para el usuario. |

## 6. Hallazgos
- **IA-B01** · dashboard (ejes 1, 2) · funcionalidad falsa/cálculo · **Crítica** · `dashboard.service.ts:184-196`, widget `kpi-ebitda` · `ebitda = netIncome`; no suma depreciación, amortización, intereses ni impuestos. En qa-do-fac EBITDA 14.871,72 = utilidad neta. Con activos fijos o deuda el número es falso. Correcto: utilidad operativa + D&A por categorías de cuenta del período. Bloquea la venta (CFO). S.
- **IA-B02** · reports (ejes 1, 7) · bug · **Alta** · `GET /reports/aging` → `customer-payments.service.ts:157` · 500 siempre que hay facturas pendientes (relación `payment.journalEntry` inexistente). La UI usa `/customer-payments/aging` (200 ✓), así que es un endpoint duplicado roto expuesto en la API pública. Correcto: eliminarlo o delegar en el servicio de AR. S.
- **IA-B03** · dashboard (eje 2) · bug · **Alta** · `dashboard-charts.service.ts:190-197` · `salesToday`/`sales_yesterday` filtran solo `status <> Draft`: cuentan facturas `Void` y suman `CreditNote` en positivo (la tendencia sí resta NC, `:90-96`). Correcto: excluir `Void`, restar NC; prueba. S.
- **IA-B04** · dashboard (eje 2) · cálculo · **Alta** · `dashboard.service.ts:47-116,163-316` · Margen neto, ROE, ROA, EBITDA usan saldos acumulados "a hoy" sin período (dependen de si hubo cierre anual), FCF usa año en curso; la UI rotula "vs año anterior/presupuesto/trimestre anterior" sin dato. ROE usa activos − pasivos (`:279`) en vez del patrimonio contable. Correcto: período explícito, comparativo calculado o rótulo eliminado. M.
- **IA-B05** · bi (ejes 1, 9) · funcionalidad muerta · **Alta** · `bi/bi.service.ts`, `entities/sales-cube-view.entity.ts`, migración `1726168695000…:9` · El cubo de ventas no existe en BD y `dim_time` está vacía: `GET /bi/sales` → 500. Ningún consumidor en frontend (grep `bi/sales` en `apps/core/client-web` sin resultados). Correcto: retirar el módulo o recrear la vista con prueba de integración. S/M.
- **IA-B06** · dashboard (ejes 4, 7) · rendimiento/diseño · **Media** · `dashboard.service.ts:126-128` · Quick ratio trae todos los productos (`inventoryService.findAll`) y resta `cost*stock` operativo de activos corrientes contables (mezcla de fuentes). Correcto: saldo de cuentas de inventario. S.
- **IA-B07** · dashboard (eje 7) · bug · **Baja** · `dashboard.service.ts` `cacheManager.set(...,3600)` × 9, `dashboard.module.ts:17` · cache-manager 7.2.9 usa ms: TTL 3,6 s, caché en memoria local. S.
- **IA-B08** · reports (ejes 3, 6) · i18n/contrato · **Baja** · `reports.service.ts` aging · Devuelve 200 con mensaje fijo en español en vez de lista vacía; `Promise<any>`. S.
- **IA-B09** · dashboard (eje 11) · UX · **Media** · widgets KPI · Valor truncado ("RD$14,871….") y rótulos comparativos sin cifra. S.

## 7. Camino mínimo a producción (todos los países)
1. IA-B01 EBITDA real o retirar el KPI (S). 2. IA-B03 ventas de hoy (S). 3. IA-B04 período explícito y comparativos reales o sin rótulo (M). 4. Retirar `/reports/aging` y `bi` muertos o repararlos (S). 5. Pruebas de integración de summary y 9 KPI contra libro sembrado (M). 6. Zona horaria del inquilino en "hoy" (S). Retocar la capa de KPIs; rehacer `getFinancialMetrics` como servicio de métricas por período.

## 8. Camino a 100
Capa de métricas con período/sucursal y definiciones documentadas (+15), pruebas KPI (+8), IA-B01/03 (+8), retirar código muerto (+4), drill-down a documentos/asientos (+5), BI ad hoc real o integración con herramienta externa vía export (+5), caché correcta (+2), limpieza de fronteras del módulo `reportes` (+4).

## 9. Competitividad
Básicas faltantes: selector de período en KPIs, comparativos reales, drill-down. Presentes: rentabilidad por producto/cliente con aviso de costo faltante, actividad/vencimientos filtrados por permiso, tablero configurable. Frente a QuickBooks/Xero/Odoo (alta) el tablero es inferior en confiabilidad de cifras.

## 10. Fortalezas
Overview filtrado por permiso documento a documento con pruebas; widgets ya sin literales; sales-trend resta notas de crédito y rellena meses; profitability excluye borradores/anulados con pruebas; BI con lista blanca de columnas (aunque muerto).

## 11. No verificado
Movimiento de "ventas de hoy" con una factura emitida en vivo (no se emitió por riesgo e-CF); budget-vs-actual con presupuesto; waterfall consolidado con subsidiarias; comportamiento en otros países (solo DO probado); `relationship-map`.
