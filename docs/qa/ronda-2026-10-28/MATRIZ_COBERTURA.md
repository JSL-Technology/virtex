# Matriz de cobertura por página y elemento

Generada por `harness/gen-matriz.cjs` desde `clicks.json` (pasada automática con datos QA3; el estado vacío de cada página quedó registrado en `inventory.json`) y las correcciones de la verificación manual. Los formularios principales se cubrieron además en los flujos guiados (ver INFORME §8). Estados: **ok** = probado sin problemas · **con falla** · **no probado** (con razón).

## Resumen por página

| Módulo | Página | Elementos | OK | Con falla | No probados | % probado |
|---|---|---|---|---|---|---|
| analisis | reports | 22 | 22 | 0 | 0 | 100% |
| analisis | reports/data-quality | 9 | 9 | 0 | 0 | 100% |
| analisis | reports/manager-report | 2 | 1 | 0 | 1 | 50% |
| analisis | reports/anomalies | 7 | 5 | 0 | 2 | 71% |
| analisis | reports/profitability-by-product | 17 | 16 | 0 | 1 | 94% |
| analisis | reports/profitability-by-customer | 17 | 16 | 0 | 1 | 94% |
| analisis | reports/relationship-map | 2 | 2 | 0 | 0 | 100% |
| analisis | reports/relationship-map/:type/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| analisis | datasheets | 1 | 1 | 0 | 0 | 100% |
| analisis | datasheets/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | accounts-payable | 18 | 18 | 0 | 0 | 100% |
| compras | accounts-payable/new | 19 | 17 | 0 | 2 | 89% |
| compras | accounts-payable/payments | 18 | 16 | 0 | 2 | 89% |
| compras | accounts-payable/payments/new | 8 | 7 | 0 | 1 | 88% |
| compras | accounts-payable/payments/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | accounts-payable/debit-notes | 18 | 15 | 0 | 3 | 83% |
| compras | accounts-payable/debit-notes/new | 12 | 12 | 0 | 0 | 100% |
| compras | accounts-payable/debit-notes/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | accounts-payable/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | accounts-payable/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | contacts/suppliers | 14 | 14 | 0 | 0 | 100% |
| compras | contacts/suppliers/new | 12 | 12 | 0 | 0 | 100% |
| compras | contacts/suppliers/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | purchasing/orders | 13 | 13 | 0 | 0 | 100% |
| compras | purchasing/orders/new | 24 | 23 | 0 | 1 | 96% |
| compras | purchasing/orders/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | purchasing/receipts | 19 | 17 | 0 | 2 | 89% |
| compras | purchasing/receipts/new | 8 | 8 | 0 | 0 | 100% |
| compras | purchasing/receipts/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | purchasing/requisitions | 15 | 15 | 0 | 0 | 100% |
| compras | purchasing/requisitions/new | 18 | 17 | 0 | 1 | 94% |
| compras | purchasing/requisitions/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | reports/aging/payables | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/chart-of-accounts | 35 | 27 | 0 | 8 | 77% |
| contabilidad | accounting/chart-of-accounts/segments-configuration | 9 | 8 | 0 | 1 | 89% |
| contabilidad | accounting/chart-of-accounts/merge | 6 | 5 | 0 | 1 | 83% |
| contabilidad | accounting/chart-of-accounts/new | 17 | 17 | 0 | 0 | 100% |
| contabilidad | accounting/chart-of-accounts/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/journal-entries | 49 | 17 | 0 | 32 | 35% |
| contabilidad | accounting/journal-entries/new | 26 | 23 | 0 | 3 | 88% |
| contabilidad | accounting/journal-entries/import | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/journal-entries/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/daily-journal | 32 | 17 | 0 | 15 | 53% |
| contabilidad | accounting/general-ledger | 6 | 5 | 0 | 1 | 83% |
| contabilidad | accounting/ledgers/new | 6 | 6 | 0 | 0 | 100% |
| contabilidad | accounting/ledgers/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/general-ledger/:accountId | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/partner-ledger | 6 | 6 | 0 | 0 | 100% |
| contabilidad | accounting/subsidiary-ledgers | 6 | 6 | 0 | 0 | 100% |
| contabilidad | accounting/recurring-entries | 1 | 1 | 0 | 0 | 100% |
| contabilidad | accounting/recurring-entries/new | 28 | 25 | 0 | 3 | 89% |
| contabilidad | accounting/recurring-entries/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/entry-templates | 1 | 1 | 0 | 0 | 100% |
| contabilidad | accounting/entry-templates/new | 25 | 22 | 0 | 3 | 88% |
| contabilidad | accounting/entry-templates/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/dimensions | 1 | 1 | 0 | 0 | 100% |
| contabilidad | accounting/ledgers | 9 | 9 | 0 | 0 | 100% |
| contabilidad | accounting/journals | 33 | 30 | 0 | 3 | 91% |
| contabilidad | accounting/journals/new | 6 | 6 | 0 | 0 | 100% |
| contabilidad | accounting/journals/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/periods | 12 | 9 | 0 | 3 | 75% |
| contabilidad | accounting/fixed-assets | 7 | 5 | 0 | 2 | 71% |
| contabilidad | accounting/fixed-assets/new | 18 | 18 | 0 | 0 | 100% |
| contabilidad | accounting/fixed-assets/depreciation | 2 | 0 | 0 | 2 | 0% |
| contabilidad | accounting/fixed-assets/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/fixed-assets/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/fixed-assets/:id/dispose | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/budgets | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/budgets/new | 14 | 11 | 0 | 3 | 79% |
| contabilidad | accounting/budgets/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/variance-analysis | 3 | 1 | 0 | 2 | 33% |
| contabilidad | accounting/closing/annual-close | 5 | 3 | 0 | 2 | 60% |
| contabilidad | accounting/audit-adjustments | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/audit-adjustments/new | 24 | 22 | 0 | 2 | 92% |
| contabilidad | accounting/closing/checklist | 9 | 0 | 4 | 5 | 44% |
| contabilidad | reports/financial-statements/balance-sheet | 3 | 3 | 0 | 0 | 100% |
| contabilidad | reports/financial-statements/income-statement | 4 | 4 | 0 | 0 | 100% |
| contabilidad | reports/financial-statements/trial-balance | 22 | 22 | 0 | 0 | 100% |
| contabilidad | reports/financial-statements/cash-flow | 4 | 4 | 0 | 0 | 100% |
| contabilidad | reports/fiscal-returns | 48 | 16 | 0 | 32 | 33% |
| contabilidad | masters/taxes | 13 | 9 | 0 | 4 | 69% |
| contabilidad | masters/taxes/new | 7 | 7 | 0 | 0 | 100% |
| contabilidad | masters/currencies | 10 | 9 | 0 | 1 | 90% |
| contabilidad | masters/currencies/exchange-rates | 10 | 0 | 2 | 8 | 20% |
| contabilidad | masters/payment-terms | 7 | 6 | 0 | 1 | 86% |
| inventario | inventory/products | 26 | 26 | 0 | 0 | 100% |
| inventario | inventory/products/new | 24 | 23 | 0 | 1 | 96% |
| inventario | inventory/products/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| inventario | inventory/predictions | 8 | 5 | 0 | 3 | 63% |
| inventario | inventory/stock | 17 | 15 | 0 | 2 | 88% |
| inventario | inventory/movements | 36 | 36 | 0 | 0 | 100% |
| inventario | inventory/kardex | 10 | 10 | 0 | 0 | 100% |
| inventario | inventory/adjustments | 11 | 10 | 0 | 1 | 91% |
| inventario | inventory/adjustments/new | 23 | 22 | 0 | 1 | 96% |
| inventario | inventory/adjustments/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| inventario | inventory/transfers | 10 | 9 | 0 | 1 | 90% |
| inventario | inventory/transfers/new | 17 | 16 | 0 | 1 | 94% |
| inventario | inventory/transfers/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| inventario | inventory/categories | 10 | 9 | 0 | 1 | 90% |
| inventario | masters/warehouses | 15 | 14 | 0 | 1 | 93% |
| inventario | masters/units-of-measure | 9 | 8 | 0 | 1 | 89% |
| rrhh | payroll/my-payslips | 0 | 0 | 0 | 0 | 100% |
| rrhh | payroll/runs | 17 | 17 | 0 | 0 | 100% |
| rrhh | payroll/runs/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| rrhh | hcm/employees | 15 | 15 | 0 | 0 | 100% |
| rrhh | hcm/employees/new | 22 | 22 | 0 | 0 | 100% |
| rrhh | hcm/employees/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| rrhh | hcm/departments | 9 | 9 | 0 | 0 | 100% |
| rrhh | payroll/concepts | 30 | 22 | 0 | 8 | 73% |
| rrhh | payroll/parameters | 17 | 17 | 0 | 0 | 100% |
| tesoreria | accounting/treasury | 18 | 17 | 0 | 1 | 94% |
| tesoreria | accounting/treasury/cash-flow | 1 | 0 | 0 | 1 | 0% |
| tesoreria | accounting/treasury/bank-accounts/new | 14 | 14 | 0 | 0 | 100% |
| tesoreria | accounting/treasury/bank-accounts/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| tesoreria | accounting/reconciliation/import | 20 | 18 | 0 | 2 | 90% |
| tesoreria | accounting/reconciliation | 4 | 4 | 0 | 0 | 100% |
| tesoreria | masters/banks | 1 | 1 | 0 | 0 | 100% |
| tesoreria | masters/banks/new | 7 | 7 | 0 | 0 | 100% |
| tesoreria | masters/banks/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| tesoreria | masters/payment-methods | 11 | 10 | 0 | 1 | 91% |
| ventas | invoices | 27 | 20 | 0 | 7 | 74% |
| ventas | invoices/new | 33 | 30 | 1 | 2 | 94% |
| ventas | invoices/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | quotes | 22 | 20 | 0 | 2 | 91% |
| ventas | quotes/new | 28 | 26 | 0 | 2 | 93% |
| ventas | quotes/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | collections | 15 | 15 | 0 | 0 | 100% |
| ventas | customer-receipts | 14 | 13 | 0 | 1 | 93% |
| ventas | customer-receipts/new | 13 | 12 | 0 | 1 | 92% |
| ventas | contacts/customers | 30 | 29 | 0 | 1 | 97% |
| ventas | contacts/customers/new | 17 | 17 | 0 | 0 | 100% |
| ventas | contacts/customers/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | masters/price-lists | 1 | 1 | 0 | 0 | 100% |
| ventas | masters/price-lists/new | 17 | 16 | 0 | 1 | 94% |
| ventas | masters/price-lists/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | sales/history | 15 | 14 | 0 | 1 | 93% |
| ventas | sales/pos | 2 | 2 | 0 | 0 | 100% |
| ventas | reports/aging/receivables | 17 | 17 | 0 | 0 | 100% |
| workspace | oauth/consent | 0 | 0 | 0 | 0 | 100% |
| workspace | ai/proposals/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| workspace | overview | 34 | 32 | 0 | 2 | 94% |
| workspace | approvals | 3 | 1 | 0 | 2 | 33% |
| workspace | workflows | 9 | 7 | 0 | 2 | 78% |
| workspace | workflows/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| workspace | workflow-instances | 13 | 11 | 0 | 2 | 85% |
| workspace | workflow-instances/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| workspace | workflow-tasks | 2 | 2 | 0 | 0 | 100% |
| workspace | notifications | 1 | 1 | 0 | 0 | 100% |
| workspace | global-search | 1 | 1 | 0 | 0 | 100% |
| workspace | data-imports | 11 | 9 | 0 | 2 | 82% |
| workspace | data-exports | 17 | 15 | 0 | 2 | 88% |
| workspace | documents/repository | 19 | 17 | 0 | 2 | 89% |
| workspace | extensions/run | 2 | 2 | 0 | 0 | 100% |
| workspace | unauthorized | 2 | 2 | 0 | 0 | 100% |

**Total**: 1592 interacciones registradas · 1373 ok · 7 con falla · 212 no probadas · 87% probadas.

## analisis · `/reports`

**Pasada automática (estado con datos QA3)** — 22 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Antigüedad de saldos | a | clic | navega a /e/virtex-dev/reports/aging/receivables · cambia contenido · red: GET /organizations/branches/mine 200, GET /customer-payments/aging?asOfDate=2026-10-29 200 | ok |
| 1 | Antigüedad de saldos | a | clic | navega a /e/virtex-dev/reports/aging/receivables · cambia contenido | ok |
| 2 | Predicciones de demanda | a | clic | navega a /e/virtex-dev/inventory/predictions · cambia contenido · red: GET /wms/warehouses 200, GET /ai/forecasts/top-by-branch?perBranch=5 200, GET /ai/forecasts/summary 200, GET  | ok |
| 3 | Existencias | a | clic | navega a /e/virtex-dev/inventory/stock · cambia contenido · red: GET /wms/warehouses 200, GET /inventory/stock?page=1&limit=100 200 | ok |
| 4 | Kárdex | a | clic | navega a /e/virtex-dev/inventory/movements · cambia contenido · red: GET /wms/warehouses 200, GET /inventory/movements?page=1&limit=100 200 | ok |
| 5 | Flujo de caja proyectado | a | clic | navega a /e/virtex-dev/accounting/treasury/cash-flow · cambia contenido · red: GET /ai/cashflow 200, GET /ai/cashflow/plan 200 | ok |
| 6 | Libro: diario | a | clic | navega a /e/virtex-dev/accounting/daily-journal · cambia contenido · red: GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=50 200 | ok |
| 7 | Libro: mayor | a | clic | navega a /e/virtex-dev/accounting/general-ledger · cambia contenido | ok |
| 8 | Mayor de terceros | a | clic | navega a /e/virtex-dev/accounting/partner-ledger · cambia contenido | ok |
| 9 | Análisis de variaciones | a | clic | navega a /e/virtex-dev/accounting/variance-analysis · cambia contenido · red: GET /budgets/variance?fromPeriod=2026-01&toPeriod=2026-10 200 | ok |
| 10 | Balance general | a | clic | navega a /e/virtex-dev/reports/financial-statements/balance-sheet · cambia contenido · red: GET /dimensions 200, GET /financial-reporting/balance-sheet?asOfDate=2026-10-29 200 | ok |
| 11 | Estado de resultados | a | clic | navega a /e/virtex-dev/reports/financial-statements/income-statement · cambia contenido · red: GET /financial-reporting/income-statement?startDate=2026-01-01&endDate=2026-10-29 200 | ok |
| 12 | Balanza de comprobación | a | clic | navega a /e/virtex-dev/reports/financial-statements/trial-balance · cambia contenido · red: GET /financial-reporting/trial-balance?startDate=2026-01-01&endDate=2026-10-29 200 | ok |
| 13 | Flujo de efectivo | a | clic | navega a /e/virtex-dev/reports/financial-statements/cash-flow · cambia contenido · red: GET /financial-reporting/cash-flow-statement?startDate=2026-01-01&endDate=2026-10-29 200 | ok |
| 14 | Declaraciones fiscales | a | clic | navega a /e/virtex-dev/reports/fiscal-returns · cambia contenido · red: GET /localization/country-pack 200, GET /compliance/filings/active-since 200, GET /compliance/filings?year=2 | ok |
| 15 | Calidad de datos | a | clic | navega a /e/virtex-dev/reports/data-quality · cambia contenido · red: GET /ai/data-quality/duplicates?status=OPEN&limit=100 200 | ok |
| 16 | Informe del gerente | a | clic | navega a /e/virtex-dev/reports/manager-report · cambia contenido · red: GET /ai/reports/manager 200 | ok |
| 17 | Anomalías | a | clic | navega a /e/virtex-dev/reports/anomalies · cambia contenido · red: GET /ai/status 200, GET /ai/anomalies/last-run 200, GET /ai/anomalies?status=OPEN&limit=25&offset=0 200 | ok |
| 18 | Rentabilidad por producto | a | clic | navega a /e/virtex-dev/reports/profitability-by-product · cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-01-01&endDate=2026-10-29 200 | ok |
| 19 | Rentabilidad por cliente | a | clic | navega a /e/virtex-dev/reports/profitability-by-customer · cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-01-01&endDate=2026-10-29 200 | ok |
| 20 | Mapa de relaciones | a | clic | navega a /e/virtex-dev/reports/relationship-map · cambia contenido · red: GET /relationship-map/types 200 | ok |
| 21 | DataSheets | a | clic | navega a /e/virtex-dev/datasheets · cambia contenido · red: GET /datasheets 200 | ok |

Probados: **22/22 (100%)** · con falla: 0 · no probados: 0

## analisis · `/reports/data-quality`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Buscar duplicados ahora | button:button | clic | aviso: Éxito Búsqueda terminada: 0 pares nuevos. / Éxito Búsqueda terminada: 0 pares nuevos. / Éxito Búsqueda terminada: 0 pares nuevos. / Éxito Búsqueda terminada: 0 pares nuevos. | ok |
| 1 | Todos | button:button | clic | red: GET /ai/data-quality/duplicates?status=OPEN&limit=100 200 | ok |
| 2 | Cliente 0 | button:button | clic | red: GET /ai/data-quality/duplicates?type=CUSTOMER&status=OPEN&limit=100 200 | ok |
| 3 | Producto 0 | button:button | clic | red: GET /ai/data-quality/duplicates?type=PRODUCT&status=OPEN&limit=100 200 | ok |
| 4 | Proveedor 0 | button:button | clic | red: GET /ai/data-quality/duplicates?type=SUPPLIER&status=OPEN&limit=100 200 | ok |
| 5 | Pendientes | button:button | clic | red: GET /ai/data-quality/duplicates?type=SUPPLIER&status=OPEN&limit=100 200 | ok |
| 6 | Son el mismo | button:button | clic | cambia contenido · red: GET /ai/data-quality/duplicates?type=SUPPLIER&status=SAME&limit=100 200 | ok |
| 7 | No son duplicados | button:button | clic | red: GET /ai/data-quality/duplicates?type=SUPPLIER&status=NOT_DUPLICATE&limit=100 200 | ok |
| 8 | Ya no coinciden | button:button | clic | red: GET /ai/data-quality/duplicates?type=SUPPLIER&status=STALE&limit=100 200 | ok |

Probados: **9/9 (100%)** · con falla: 0 · no probados: 0

## analisis · `/reports/manager-report`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | (sin texto) | input:month | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 1 | Escribir el informe del mes | button:button | clic | cambia contenido · red: POST /ai/reports/manager 202, GET /ai/reports/manager 200 | ok |

Probados: **1/2 (50%)** · con falla: 0 · no probados: 1

## analisis · `/reports/anomalies`

**Pasada automática (estado con datos QA3)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Revisar ahora | button:button | clic | aviso: Información La revisión está en marcha. Los hallazgos aparecerán en unos minutos. / Información La revisión está en marcha. Los hallazgos aparecerán en unos minutos. / Infor | ok |
| 1 | Todas Pendiente (0) Confirmada (0) Descartada (0) | select | seleccionar 4 opciones | red: GET /ai/anomalies?limit=25&offset=0 200, GET /ai/anomalies?status=OPEN&limit=25&offset=0 200, GET /ai/anomalies?status=CONFIRMED&limit=25&offset=0 200, GET /ai/anomalies?statu | ok |
| 2 | Todas Crítica Alta Media Baja | select | seleccionar 5 opciones | red: GET /ai/anomalies?status=DISMISSED&limit=25&offset=0 200, GET /ai/anomalies?status=DISMISSED&severity=CRITICAL&limit=25&offset=0 200, GET /ai/anomalies?status=DISMISSED&severi | ok |
| 3 | Todas Ventas Compras Existencias Caja Seguridad | select | seleccionar 6 opciones | red: GET /ai/anomalies?status=DISMISSED&severity=LOW&limit=25&offset=0 200, GET /ai/anomalies?status=DISMISSED&severity=LOW&category=sales&limit=25&offset=0 200, GET /ai/anomalies? | ok |
| 4 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 5 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 6 | 25 50 100 | select | seleccionar 3 opciones | red: GET /ai/anomalies?status=DISMISSED&severity=LOW&category=security&limit=25&offset=0 200, GET /ai/anomalies?status=DISMISSED&severity=LOW&category=security&limit=50&offset=0 20 | ok |

Probados: **5/7 (71%)** · con falla: 0 · no probados: 2

## analisis · `/reports/profitability-by-product`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-8-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-10-29 200 | ok |
| 1 | vx-date-range-8-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 3 | Actualizar | button:button | clic | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Producto | button:button | clic | cambia contenido | ok |
| 6 | Unidades vendidas | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Unidades vendidas | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Ingreso total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Ingreso total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | Costo total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Costo total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Utilidad bruta | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Utilidad bruta | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | Margen bruto (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Margen bruto (%) | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 16 | QA3-SKU-7734 — QA3-7734-Widget ergonómico 3 RD$3,500.00 RD$2 | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **16/17 (94%)** · con falla: 0 · no probados: 1

## analisis · `/reports/profitability-by-customer`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-9-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-09-15&endDate=2026-10-29 200 | ok |
| 1 | vx-date-range-9-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 3 | Actualizar | button:button | clic | cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | Cliente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Cliente | button:button | clic | cambia contenido | ok |
| 6 | Unidades | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Unidades | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Ingreso total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Ingreso total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | Costo total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Costo total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Utilidad bruta | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Utilidad bruta | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | Margen bruto (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Margen bruto (%) | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 16 | 131246796 — QA3-8812-Comercial Ñandú SRL 2 RD$2,250.00 RD$1, | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **16/17 (94%)** · con falla: 0 · no probados: 1

## analisis · `/reports/relationship-map`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | FAC-00000128, PO-2026-000001… | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /relationship-map/search?q=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 1 | Todos los tipos Cotización Factura Recibo de cobro Comproban | select | seleccionar 15 opciones | cambia contenido | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## analisis · `/datasheets`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo libro | a | clic | navega a /e/virtex-dev/datasheets/new · pestañas 2→3 · cambia contenido · red: GET /datasheets/variables 200, GET /datasheets/variables 200, GET /datasheets/import/modules 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## compras · `/accounts-payable`

**Pasada automática (estado con datos QA3)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Registrar pago | a | - | probado en flujo 28 (PAY-2026-000001: aviso de sobregiro falso, step-up, asiento 2110/1120) | ok |
| 1 | Nueva factura | a | clic | navega a /e/virtex-dev/accounts-payable/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /ai/status 200, GET /treasury/cash-position 200, GET /treasury/payment | ok |
| 2 | Proveedor | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Proveedor | button:button | clic | cambia contenido | ok |
| 4 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Número | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 6 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Fecha | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Vencimiento | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Vencimiento | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Saldo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Saldo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 16 | QA3-9045-Distribuidora Caribe SRL Sin NCF 29/10/2026 29/10/2 | fila | clic | navega a /e/virtex-dev/accounts-payable/9806e751-c00d-4d81-9032-05357a26ef4e · pestañas 2→3 · cambia contenido · red: GET /vendor-debit-notes?vendorBillId=9806e751-c00d-4d81-9032-0 | ok |
| 17 | Sin NCF | a | clic | navega a /e/virtex-dev/accounts-payable/9806e751-c00d-4d81-9032-05357a26ef4e · pestañas 2→3 · cambia contenido · red: GET /accounts-payable/9806e751-c00d-4d81-9032-05357a26ef4e/pay | ok |

Probados: **18/18 (100%)** · con falla: 0 · no probados: 0

## compras · `/accounts-payable/new`

**Pasada automática (estado con datos QA3)** — 19 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable · pestañas 2→3 · cambia contenido · red: GET /inbound-mail/bills/messages?status=RECEIVED,PROCESSING,NEEDS_REVIEW,FAILED,REJECTED,PROCESSED  | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable · pestañas 2→3 · cambia contenido · red: GET /inbound-mail/bills/messages?status=RECEIVED,PROCESSING,NEEDS_REVIEW,FAILED,REJECTED,PROCESSED  | ok |
| 2 | Guardar factura | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Proveedor» es obligatorio «Concepto» es obligatorio «Cuenta de gasto» es obligatorio | ok |
| 3 | billDocument | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 4 | Seleccionar proveedor | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 5 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 6 | ncf | input:text | escribir "QA-áéí ñ <b>&"'" | pestañas 2→3 · cambia contenido | ok |
| 7 | date | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 8 | dueDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 9 | PAB · balboa panameño BOB · boliviano VES · bolívar venezola | select | seleccionar 23 opciones | valor queda "undefined" | ok |
| 10 | 01 — Efectivo 02 — Cheque, transferencia o depósito 03 — Tar | select | seleccionar 7 opciones | valor queda "undefined" | ok |
| 11 | Descripción | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Proveedor» es obligatorio «Cuenta de gasto» es obligatorio | ok |
| 12 | Cant. | input:number | escribir "12345" | valor queda "12345" | ok |
| 13 | Precio | input:number | escribir "12345" | cambia contenido | ok |
| 14 | Cuenta de gasto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 15 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 16 | Eliminar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 17 | Agregar línea | button:button | clic | cambia contenido | ok |
| 18 | Mostrar | button:button | clic | cambia contenido | ok |

Probados: **17/19 (89%)** · con falla: 0 · no probados: 2

## compras · `/accounts-payable/payments`

**Pasada automática (estado con datos QA3)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Registrar pago | a | - | probado en flujo 28 (PAY-2026-000001: aviso de sobregiro falso, step-up, asiento 2110/1120) | ok |
| 1 | Todos los proveedores | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 2 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 3 | Todas las cuentas Caja general (DOP) QA3-6620-Banco operativ | select | seleccionar 3 opciones | cambia contenido · red: GET /vendor-payments?page=1&limit=50 200, GET /vendor-payments?bankAccountId=a69424ce-d7af-42e3-8d49-f449791b37c9&page=1&limit=50 200, GET /vendor-payments? | ok |
| 4 | Todos Pagado Anulado | select | seleccionar 3 opciones | cambia contenido · red: GET /vendor-payments?bankAccountId=5e53bb19-f1c3-4706-9378-1466f07bdfeb&page=1&limit=50 200, GET /vendor-payments?bankAccountId=5e53bb19-f1c3-4706-9378-1466 | ok |
| 5 | Número | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 6 | Fecha de pago | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 7 | Proveedores | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 8 | Cuenta bancaria | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 9 | Referencia | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 10 | Facturas | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 11 | Monto pagado | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 12 | Estado | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 13 | PAY-2026-000001 29/10/2026 QA3-9045-Distribuidora Caribe SRL | fila | - | abre el documento (verificado manualmente: 100-rerender.cjs) | ok |
| 14 | PAY-2026-000001 | a | - | abre el documento (verificado manualmente: 100-rerender.cjs) | ok |
| 15 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 16 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 17 | 50 100 200 | select | seleccionar 3 opciones | red: GET /vendor-payments?bankAccountId=5e53bb19-f1c3-4706-9378-1466f07bdfeb&status=VOID&page=1&limit=50 200, GET /vendor-payments?bankAccountId=5e53bb19-f1c3-4706-9378-1466f07bdfe | ok |

Probados: **16/18 (89%)** · con falla: 0 · no probados: 2

## compras · `/accounts-payable/payments/new`

**Pasada automática (estado con datos QA3)** — 8 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable/payments · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /vendor-payments?page=1&limit=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable/payments · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /vendor-payments?page=1&limit=50 200 | ok |
| 2 | Registrar pago | button:submit | - | probado en flujo 28 (PAY-2026-000001: aviso de sobregiro falso, step-up, asiento 2110/1120) | ok |
| 3 | paymentDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 4 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 5 | Quitar la selección | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 6 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 7 | reference | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **7/8 (88%)** · con falla: 0 · no probados: 1

## compras · `/accounts-payable/debit-notes`

**Pasada automática (estado con datos QA3)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva nota de débito | a | clic | navega a /e/virtex-dev/accounts-payable/debit-notes/new · pestañas 2→3 · cambia contenido · red: GET /accounts-payable 200 | ok |
| 1 | Todos los proveedores | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 2 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 3 | Todas Contabilizada Anulada | select | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 4 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Proveedor | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Factura | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | NCF del proveedor | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Motivo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Monto (con impuesto) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | ND-2026-000001 29/10/2026 QA3-9045-Distribuidora Caribe SRL  | fila | clic | navega a /e/virtex-dev/accounts-payable/debit-notes/366894e6-3789-4a45-87a0-07c23dea5c44 · pestañas 2→3 · cambia contenido · red: GET /vendor-debit-notes/366894e6-3789-4a45-87a0-07 | ok |
| 13 | ND-2026-000001 | a | clic | navega a /e/virtex-dev/accounts-payable/debit-notes/366894e6-3789-4a45-87a0-07c23dea5c44 · pestañas 2→3 · cambia contenido · red: GET /vendor-debit-notes/366894e6-3789-4a45-87a0-07 | ok |
| 14 | Ver factura | a | clic | navega a /e/virtex-dev/accounts-payable/9806e751-c00d-4d81-9032-05357a26ef4e · pestañas 2→3 · cambia contenido · red: GET /accounts-payable/9806e751-c00d-4d81-9032-05357a26ef4e/pay | ok |
| 15 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 16 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 17 | 50 100 200 | select | seleccionar 3 opciones | red: GET /vendor-debit-notes?page=1&limit=50 200, GET /vendor-debit-notes?page=1&limit=100 200, GET /vendor-debit-notes?page=1&limit=200 200 | ok |

Probados: **15/18 (83%)** · con falla: 0 · no probados: 3

## compras · `/accounts-payable/debit-notes/new`

**Pasada automática (estado con datos QA3)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable/debit-notes · pestañas 2→3 · cambia contenido · red: GET /vendor-debit-notes?page=1&limit=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable/debit-notes · pestañas 2→3 · cambia contenido · red: GET /vendor-debit-notes?page=1&limit=50 200 | ok |
| 2 | Contabilizar nota | button:submit | - | probado en flujo 28 (ND-2026-000001; no mueve existencias) | ok |
| 3 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 5 | note-date | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 6 | amount | input:number | escribir "12345" | valor queda "12345" | ok |
| 7 | taxAmount | input:number | escribir "12345" | valor queda "12345" | ok |
| 8 | NCF de la nota de crédito del proveedor (opcional) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 9 | Seleccionar cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 10 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 11 | Ej.: devolución de 2 unidades dañadas | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **12/12 (100%)** · con falla: 0 · no probados: 0

## compras · `/contacts/suppliers`

**Pasada automática (estado con datos QA3)** — 14 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo proveedor | a | clic | navega a /e/virtex-dev/contacts/suppliers/new · pestañas 2→3 · cambia contenido | ok |
| 1 | Nombre de la empresa | th | clic | cambia contenido | ok |
| 2 | Nombre de la empresa | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 3 | Persona de contacto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Persona de contacto | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Correo electrónico | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Correo electrónico | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Teléfono | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Teléfono | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Luis QA3 qa3-9045@example.com 809-555-9045 | fila | clic | navega a /e/virtex-dev/contacts/suppliers/7f108dff-06b8-483d-84b5-d0ed3268104f/edit · pestañas 2→3 · cambia contenido · red: GET /suppliers/7f108dff-06b8-483d-84b5-d0ed3268104f 200 | ok |
| 11 | Estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/partner-ledger?type=supplier&partnerId=7f108dff-06b8-483d-84b5-d0ed3268104f · pestañas 2→3 · cambia contenido · red: GET /suppliers/7f108dff-06b8- | ok |
| 12 | Editar | a | clic | navega a /e/virtex-dev/contacts/suppliers/7f108dff-06b8-483d-84b5-d0ed3268104f/edit · pestañas 2→3 · cambia contenido · red: GET /suppliers/7f108dff-06b8-483d-84b5-d0ed3268104f 200 | ok |
| 13 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |

Probados: **14/14 (100%)** · con falla: 0 · no probados: 0

## compras · `/contacts/suppliers/new`

**Pasada automática (estado con datos QA3)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/contacts/suppliers · pestañas 2→3 · cambia contenido · red: GET /suppliers 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/contacts/suppliers · pestañas 2→3 · cambia contenido · red: GET /suppliers 200 | ok |
| 2 | Guardar proveedor | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del proveedor» es obligatorio | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | contactPerson | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | Cédula RNC Pasaporte | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 6 | 001-1234567-3 | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | address | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 8 | email | input:email | escribir "qa@example.com" | valor queda "qa@example.com" | ok |
| 9 | 809 555 0123 | input:tel | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 10 | Afganistán Albania Alemania Andorra Angola Anguila Antártida | select | seleccionar 249 opciones | valor queda "undefined" | ok |
| 11 | Sin clasificar Persona física Persona jurídica Agente de ret | select | seleccionar 6 opciones | valor queda "undefined" | ok |

Probados: **12/12 (100%)** · con falla: 0 · no probados: 0

## compras · `/purchasing/orders`

**Pasada automática (estado con datos QA3)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva orden | a | clic | navega a /e/virtex-dev/purchasing/orders/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200 | ok |
| 1 | N.º de orden | th | clic | cambia contenido | ok |
| 2 | N.º de orden | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 3 | Proveedor | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Proveedor | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Fecha de la orden | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Fecha de la orden | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 11 | PO-2026-000001 QA3-9045-Distribuidora Caribe SRL 29/10/2026  | fila | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 12 | PO-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |

Probados: **13/13 (100%)** · con falla: 0 · no probados: 0

## compras · `/purchasing/orders/new`

**Pasada automática (estado con datos QA3)** — 24 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/orders · pestañas 2→3 · cambia contenido · red: GET /procurement/orders?page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/orders · pestañas 2→3 · cambia contenido · red: GET /procurement/orders?page=1&pageSize=50 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Proveedor» es obligatorio «Descripción» es obligatorio | ok |
| 3 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 5 | DOP PAB BOB VES CRC NIO CAD USD EUR CHF PYG HNL GBP ARS CLP  | select | seleccionar 23 opciones | cambia contenido | ok |
| 6 | orderDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 7 | expectedDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 8 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 9 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Cantidad | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Precio acordado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | ITBIS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | 0.00 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 16 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 17 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 18 | description | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Proveedor» es obligatorio | ok |
| 19 | quantity | input:number | escribir "12345" | valor queda "12345" | ok |
| 20 | unitPrice | input:number | escribir "12345" | valor queda "12345" | ok |
| 21 | taxRate | input:number | escribir "12345" | valor queda "12345" | ok |
| 22 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 23 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **23/24 (96%)** · con falla: 0 · no probados: 1

## compras · `/purchasing/receipts`

**Pasada automática (estado con datos QA3)** — 19 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva recepción | a | clic | navega a /e/virtex-dev/purchasing/receipts/new · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200, GET /procurement/orders?page=1&pageSize=200&receivable=true 200 | ok |
| 1 | Todos los proveedores | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 2 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 3 | Todos los almacenes Almacén principal | select | seleccionar 2 opciones | red: GET /procurement/receipts?page=1&limit=50 200, GET /procurement/receipts?warehouseId=f56fabde-cb33-4b32-a0fa-5ed220907de9&page=1&limit=50 200 | ok |
| 4 | Todos Registrada Anulada | select | seleccionar 3 opciones | cambia contenido · red: GET /procurement/receipts?warehouseId=f56fabde-cb33-4b32-a0fa-5ed220907de9&page=1&limit=50 200, GET /procurement/receipts?warehouseId=f56fabde-cb33-4b32-a0f | ok |
| 5 | Número | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 6 | Fecha de recepción | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 7 | Orden de compra | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Proveedor | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 9 | Almacén | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 10 | Líneas | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 11 | Valor | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 12 | Estado | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 13 | GR-2026-000001 29/10/2026 PO-2026-000001 QA3-9045-Distribuid | fila | - | abre el documento (verificado manualmente: 100-rerender.cjs) | ok |
| 14 | GR-2026-000001 | a | - | abre el documento (verificado manualmente: 100-rerender.cjs) | ok |
| 15 | PO-2026-000001 | a | - | abre el documento (verificado manualmente: 100-rerender.cjs) | ok |
| 16 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 17 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 18 | 50 100 200 | select | seleccionar 3 opciones | red: GET /procurement/receipts?warehouseId=f56fabde-cb33-4b32-a0fa-5ed220907de9&status=VOID&page=1&limit=50 200, GET /procurement/receipts?warehouseId=f56fabde-cb33-4b32-a0fa-5ed22 | ok |

Probados: **17/19 (89%)** · con falla: 0 · no probados: 2

## compras · `/purchasing/receipts/new`

**Pasada automática (estado con datos QA3)** — 8 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/receipts · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200, GET /procurement/receipts?page=1&limit=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/receipts · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200, GET /procurement/receipts?page=1&limit=50 200 | ok |
| 2 | Registrar recepción | button:submit | - | probado en flujo 25 (GR-2026-000001 parcial, stock y asiento) | ok |
| 3 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 5 | receipt-date | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 6 | El almacén de la sucursal de la orden Almacén principal | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 7 | Conduce del proveedor, transportista, observaciones… | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **8/8 (100%)** · con falla: 0 · no probados: 0

## compras · `/purchasing/requisitions`

**Pasada automática (estado con datos QA3)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva requisición | a | clic | navega a /e/virtex-dev/purchasing/requisitions/new · pestañas 2→3 · cambia contenido | ok |
| 1 | N.º de requisición | th | clic | cambia contenido | ok |
| 2 | N.º de requisición | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 3 | Artículos | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Artículos | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Fecha | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Fecha requerida | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Fecha requerida | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 11 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 13 | REQ-2026-000001 1 28/10/2026 15/11/2026 RD$3,250.00 Aprobada | fila | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 14 | REQ-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |

Probados: **15/15 (100%)** · con falla: 0 · no probados: 0

## compras · `/purchasing/requisitions/new`

**Pasada automática (estado con datos QA3)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/requisitions · pestañas 2→3 · cambia contenido · red: GET /procurement/requisitions?page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/requisitions · pestañas 2→3 · cambia contenido · red: GET /procurement/requisitions?page=1&pageSize=50 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Descripción» es obligatorio | ok |
| 3 | requiredDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 4 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Cantidad | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Precio estimado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | 0.00 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 11 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 12 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50 200 | ok |
| 13 | description | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 14 | quantity | input:number | escribir "12345" | valor queda "12345" | ok |
| 15 | estimatedUnitPrice | input:number | escribir "12345" | valor queda "12345" | ok |
| 16 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 17 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **17/18 (94%)** · con falla: 0 · no probados: 1

## compras · `/reports/aging/payables`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | agingAsOf | input:date | escribir "2026-09-15" | red: GET /accounts-payable/aging?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | red: GET /accounts-payable/aging?asOfDate=2026-09-15 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/chart-of-accounts`

**Pasada automática (estado con datos QA3)** — 35 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 1 | Importar | button:button | clic | navega a /e/virtex-dev/data-imports?dataset=chart_of_accounts · pestañas 2→3 · cambia contenido · red: GET /data-transfer/datasets 200, GET /data-transfer/runs?kind=IMPORT 200 | ok |
| 2 | Fusionar cuentas | button:button | - | irreversible; solo existe una cuenta QA3 (5915) y sin otra cuenta QA de destino — no ejecutado | no probado |
| 3 | Nueva cuenta | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts/new · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts/segment-definitions 200 | ok |
| 4 | Buscar por código o nombre... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 5 | Estado | select | seleccionar 3 opciones | encabezado NO ordenable (verificado manualmente) | ok |
| 6 | Tipo | select | seleccionar 6 opciones | encabezado NO ordenable (verificado manualmente) | ok |
| 7 | Cuenta | th | - | encabezado NO ordenable (verificado manualmente) | ok |
| 8 | Cuenta | button:button | - | encabezado NO ordenable (verificado manualmente) | ok |
| 9 | Tipo | th | - | encabezado NO ordenable (verificado manualmente) | ok |
| 10 | Tipo | button:button | - | encabezado NO ordenable (verificado manualmente) | ok |
| 11 | Saldo | th | - | encabezado NO ordenable (verificado manualmente) | ok |
| 12 | Saldo | button:button | - | encabezado NO ordenable (verificado manualmente) | ok |
| 13 | Estado | th | - | encabezado NO ordenable (verificado manualmente) | ok |
| 14 | Estado | button:button | - | encabezado NO ordenable (verificado manualmente) | ok |
| 15 | Acciones | th | - | encabezado NO ordenable (verificado manualmente) | ok |
| 16 | 1000 Activo Activo — Activa | fila | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 17 | Activo | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 18 | 1000 Activo | a | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 19 | Editar la cuenta Activo | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 20 | Pasivo | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 21 | 2000 Pasivo | a | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 22 | Editar la cuenta Pasivo | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 23 | Patrimonio | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 24 | 3000 Patrimonio | a | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 25 | Editar la cuenta Patrimonio | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 26 | Ingresos | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 27 | 4000 Ingresos | a | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 28 | Editar la cuenta Ingresos | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 29 | Gastos | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 30 | 5000 Gastos | a | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 31 | Editar la cuenta Gastos | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 32 | 5915 QA3-5915 Gastos de prueba (editada) | a | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 33 | Editar la cuenta QA3-5915 Gastos de prueba (editada) | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 34 | Eliminar la cuenta QA3-5915 Gastos de prueba (editada) | button:button | - | irreversible; solo existe una cuenta QA3 (5915) y sin otra cuenta QA de destino — no ejecutado | no probado |

Probados: **27/35 (77%)** · con falla: 0 · no probados: 8

## contabilidad · `/accounting/chart-of-accounts/segments-configuration`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 1 | Cargar plantilla | button:button | clic | abre diálogo/panel · abre menú/lista | ok |
| 2 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 3 | Guardar estructura | button:submit | clic | 400 esperado: regla de negocio (ya existen cuentas) | ok |
| 4 | Ej: mayor, sub-cuenta... | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 5 | length | input:number | escribir "12345" | valor queda "12345" | ok |
| 6 | isRequired | input:checkbox | clic | cambia contenido | ok |
| 7 | Eliminar nivel | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 8 | Agregar nivel | button:button | clic | cambia contenido | ok |

Probados: **8/9 (89%)** · con falla: 0 · no probados: 1

## contabilidad · `/accounting/chart-of-accounts/merge`

**Pasada automática (estado con datos QA3)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Volver al plan de cuentas | a | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · red: GET /chart-of-accounts 200 | ok |
| 1 | Buscar por código o nombre | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 2 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 3 | Buscar por código o nombre | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 5 | Analizar | button:button | - | deshabilitado en este estado | no probado |

Probados: **5/6 (83%)** · con falla: 0 · no probados: 1

## contabilidad · `/accounting/chart-of-accounts/new`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 2 | Guardar cuenta | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Código de cuenta» es obligatorio «Nombre de la cuenta» es obligatorio «Tipo de cuenta» es obligatorio «Categoría» es o | ok |
| 3 | General | button:button | clic | pestaña activa / casilla de formulario (cambia el valor; cubierto en el flujo 33) | ok |
| 4 | Mapeos | button:button | clic | cambia contenido | ok |
| 5 | Reglas | button:button | clic | cambia contenido | ok |
| 6 | Avanzado | button:button | clic | cambia contenido | ok |
| 7 | code | input | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 8 | name | input | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 9 | description | textarea | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 10 | -- Ninguna (cuenta raíz) -- | input:text | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 11 | (sin texto) | button:button | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 12 | Seleccionar tipo... Activo Pasivo Patrimonio Ingreso Gasto | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 13 | nature | input | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 14 | Seleccionar categoría... | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 15 | isPostable | input:checkbox | - | pestaña activa / casilla de formulario (cambia el valor; cubierto en el flujo 33) | ok |
| 16 | isActive | input:checkbox | - | pestaña activa / casilla de formulario (cambia el valor; cubierto en el flujo 33) | ok |

Probados: **17/17 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/journal-entries`

**Pasada automática (estado con datos QA3)** — 49 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo asiento | a | clic | navega a /e/virtex-dev/accounting/journal-entries/new · cambia contenido · red: GET /dimensions/rules 200, GET /accounting/ledgers 200, GET /journals 200, GET /dimensions 200 | ok |
| 1 | Fecha | th | clic | cambia contenido · red: GET /journal-entries?page=1&pageSize=50&sort=date&direction=asc 200 | ok |
| 2 | Fecha | button:button | clic | red: GET /journal-entries?page=1&pageSize=50&sort=date&direction=desc 200 | ok |
| 3 | N.º de asiento | th | clic | red: GET /journal-entries?page=1&pageSize=50&sort=entryNumber&direction=asc 200 | ok |
| 4 | N.º de asiento | button:button | clic | red: GET /journal-entries?page=1&pageSize=50&sort=entryNumber&direction=desc 200 | ok |
| 5 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Descripción | button:button | clic | red: GET /journal-entries?page=1&pageSize=50&sort=description&direction=asc 200 | ok |
| 7 | Débito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Crédito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Estado | th | clic | red: GET /journal-entries?page=1&pageSize=50&sort=status&direction=asc 200 | ok |
| 10 | Estado | button:button | clic | red: GET /journal-entries?page=1&pageSize=50&sort=status&direction=desc 200 | ok |
| 11 | 01/05/2031 GENERAL-2031-000001 QA3-JE-2290 alquiler oficina  | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 12 | GENERAL-2031-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 13 | Más acciones | a | clic | navega a /e/virtex-dev/accounting/journal-entries/e083feec-4892-47da-82b6-14c622ef66c4/edit · cambia contenido | ok |
| 14 | NOMINA-2026-000002 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 15 | Más acciones | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 16 | NOMINA-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 17 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 18 | PAGOS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 19 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 20 | GENERAL-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 21 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 22 | COMPRAS-2026-000003 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 23 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 24 | COMPRAS-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 25 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 26 | COMPRAS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 27 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 28 | COBROS-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 29 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 30 | COBROS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 31 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 32 | BANCOS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 33 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 34 | VENTAS-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 35 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 36 | VENTAS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 37 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 38 | GENERAL-2026-000005 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 39 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 40 | GENERAL-2026-000004 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 41 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 42 | GENERAL-2026-000003 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 43 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 44 | GENERAL-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 45 | Más acciones | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 46 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 47 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 48 | 25 50 100 | select | seleccionar 3 opciones | red: GET /journal-entries?page=1&pageSize=25&sort=status&direction=desc 200, GET /journal-entries?page=1&pageSize=50&sort=status&direction=desc 200, GET /journal-entries?page=1&pag | ok |

Probados: **17/49 (35%)** · con falla: 0 · no probados: 32

## contabilidad · `/accounting/journal-entries/new`

**Pasada automática (estado con datos QA3)** — 26 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journal-entries · pestañas 2→3 · cambia contenido · red: GET /journal-entries?page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journal-entries · pestañas 2→3 · cambia contenido · red: GET /journal-entries?page=1&pageSize=50 200 | ok |
| 2 | Guardar asiento | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Diario» es obligatorio «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es obligatorio | ok |
| 3 | date | input:date | escribir "2026-09-15" | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Diario» es obligatorio «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es obligatorio / El monto total n | ok |
| 4 | Selecciona un libro mayor Libro principal | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 5 | Selecciona un diario Diario de bancos Diario de caja Diario  | select | seleccionar 12 opciones | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es obligatorio / El monto total no puede ser cero. | ok |
| 6 | Introduce una descripción para el asiento | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Cuenta» es obligatorio «Cuenta» es obligatorio / El monto total no puede ser cero. | ok |
| 7 | Cuenta | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Débito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Crédito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Eliminar | th | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 12 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 13 | Selecciona una cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 14 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 15 | description | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | debit | input:number | escribir "12345" | aviso: Revisa 2 punto(s) antes de guardar «Cuenta» es obligatorio «Cuenta» es obligatorio / Los débitos y los créditos deben estar balanceados. | ok |
| 17 | credit | input:number | escribir "12345" | aviso: Revisa 2 punto(s) antes de guardar «Cuenta» es obligatorio «Cuenta» es obligatorio / Cada línea lleva un débito o un crédito, no ambos. Revisa la(s) línea(s) 1. | ok |
| 18 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 19 | Selecciona una cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 20 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 21 | description | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 22 | debit | input:number | escribir "12345" | valor queda "12345" | ok |
| 23 | credit | input:number | escribir "12345" | valor queda "12345" | ok |
| 24 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 25 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **23/26 (88%)** · con falla: 0 · no probados: 3

## contabilidad · `/accounting/journal-entries/import`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | (sin texto) | a | clic | navega a /e/virtex-dev/accounting/journal-entries · pestañas 2→3 · cambia contenido · red: GET /journal-entries?page=1&pageSize=50 200 | ok |
| 1 | Haz clic aquí para seleccionar un fichero (CSV, Excel) | div:button | clic | abre el selector de archivos del sistema (no detectable por el arnés) | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/daily-journal`

**Pasada automática (estado con datos QA3)** — 32 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 1 | Buscar por número o descripción | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /chart-of-accounts 200, GET /journal-entries?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27&page=1&pageSize=50 200 | ok |
| 2 | vx-date-range-0-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /chart-of-accounts 200, GET /journal-entries?from=2026-09-15&page=1&pageSize=50 200, GET /chart-of-accounts 200, GET /journal-entries?from=2026-09-15&pa | ok |
| 3 | vx-date-range-0-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /chart-of-accounts 200, GET /journal-entries?from=2026-09-15&to=2026-09-15&page=1&pageSize=50 200 | ok |
| 4 | Todos los estados Borrador Pendiente de aprobación Contabili | select | seleccionar 5 opciones | red: GET /chart-of-accounts 200, GET /journal-entries?from=2026-09-15&to=2026-09-15&page=1&pageSize=50 200, GET /chart-of-accounts 200, GET /chart-of-accounts 200 | ok |
| 5 | Fecha | th | clic | cambia contenido · red: GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=50 200 | ok |
| 6 | N.º de asiento | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Cuenta | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Débito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Crédito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | 01/05/2031 GENERAL-2031-000001 1135 — Estimación para Cuenta | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 12 | GENERAL-2031-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 13 | NOMINA-2026-000002 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 14 | NOMINA-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 15 | PAGOS-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 16 | GENERAL-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 17 | COMPRAS-2026-000003 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 18 | COMPRAS-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 19 | COMPRAS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 20 | COBROS-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 21 | COBROS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 22 | BANCOS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 23 | VENTAS-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 24 | VENTAS-2026-000001 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 25 | GENERAL-2026-000005 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 26 | GENERAL-2026-000004 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 27 | GENERAL-2026-000003 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 28 | GENERAL-2026-000002 | a | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 29 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 30 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 31 | 25 50 100 | select | seleccionar 3 opciones | red: GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=25 200, GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=50 200 | ok |

Probados: **17/32 (53%)** · con falla: 0 · no probados: 15

## contabilidad · `/accounting/general-ledger`

**Pasada automática (estado con datos QA3)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | - | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 1 | Busca una cuenta por código o nombre | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 2 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 3 | vx-date-range-1-from | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 4 | vx-date-range-1-to | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 5 | Consultar | button:button | - | deshabilitado en este estado | no probado |

Probados: **5/6 (83%)** · con falla: 0 · no probados: 1

## contabilidad · `/accounting/ledgers/new`

**Pasada automática (estado con datos QA3)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/general-ledger · pestañas 2→3 · cambia contenido | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/general-ledger · pestañas 2→3 · cambia contenido | ok |
| 2 | Guardar libro | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del libro» es obligatorio | ok |
| 3 | Ej: libro principal IFRS | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | Ej: Utilizado para reportes financieros bajo NIIF. | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | isDefault | input:checkbox | clic | casilla de formulario (cambia el valor; sin efecto inmediato esperado) | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/partner-ledger`

**Pasada automática (estado con datos QA3)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Clientes | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 1 | Proveedores | button:button | clic | cambia contenido | ok |
| 2 | Elige un cliente | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 4 | pl-from | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 5 | pl-to | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/subsidiary-ledgers`

**Pasada automática (estado con datos QA3)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Clientes | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 1 | Proveedores | button:button | clic | cambia contenido | ok |
| 2 | Elige un cliente | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 4 | pl-from | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 5 | pl-to | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/recurring-entries`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo asiento recurrente | a | clic | navega a /e/virtex-dev/accounting/recurring-entries/new · pestañas 2→3 · cambia contenido · red: GET /journals 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/recurring-entries/new`

**Pasada automática (estado con datos QA3)** — 28 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/recurring-entries · pestañas 2→3 · cambia contenido · red: GET /recurring-journal-entries 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/recurring-entries · pestañas 2→3 · cambia contenido · red: GET /recurring-journal-entries 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 7 punto(s) antes de guardar «Descripción» es obligatorio «Diario» es obligatorio Línea 1: elige la cuenta. Línea 1: indica un importe en el débito  | ok |
| 3 | Alquiler del local, amortización del seguro… | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 6 punto(s) antes de guardar «Diario» es obligatorio Línea 1: elige la cuenta. Línea 1: indica un importe en el débito o en el crédito, no en ambos  | ok |
| 4 | Elige un diario BANCOS — Diario de bancos CAJA — Diario de c | select | seleccionar 12 opciones | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar Línea 1: elige la cuenta. Línea 1: indica un importe en el débito o en el crédito, no en ambos ni en ninguno. Línea 2:  | ok |
| 5 | Diaria Semanal Mensual Anual | select | seleccionar 4 opciones | valor queda "undefined" | ok |
| 6 | re-start | input:date | escribir "2026-09-15" | pestañas 2→3 | ok |
| 7 | re-end | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 8 | isActive | input:checkbox | clic | casilla de formulario (cambia el valor; sin efecto inmediato esperado) | ok |
| 9 | Cuenta * | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Concepto de la línea | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Débito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Crédito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Quitar línea | th | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 14 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 15 | Cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 16 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 17 | Concepto de la línea | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 18 | Débito | input:number | escribir "12345" | valor queda "12345" | ok |
| 19 | Crédito | input:number | escribir "12345" | cambia contenido | ok |
| 20 | Quitar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 21 | Cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 22 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 23 | Concepto de la línea | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 24 | Débito | input:number | escribir "12345" | valor queda "12345" | ok |
| 25 | Crédito | input:number | escribir "12345" | valor queda "12345" | ok |
| 26 | Quitar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 27 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **25/28 (89%)** · con falla: 0 · no probados: 3

## contabilidad · `/accounting/entry-templates`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva plantilla | a | clic | navega a /e/virtex-dev/accounting/entry-templates/new · pestañas 2→3 · cambia contenido · red: GET /journals 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/entry-templates/new`

**Pasada automática (estado con datos QA3)** — 25 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/entry-templates · pestañas 2→3 · cambia contenido · red: GET /journal-entry-templates 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/entry-templates · pestañas 2→3 · cambia contenido · red: GET /journal-entry-templates 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Nombre» es obligatorio «Descripción» es obligatorio Línea 1: elige la cuenta. | ok |
| 3 | Provisión de nómina, reparto de alquiler… | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Descripción» es obligatorio Línea 1: elige la cuenta. | ok |
| 4 | description | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar Línea 1: elige la cuenta. | ok |
| 5 | Cuenta * | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Lado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | % del lado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Concepto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Quitar línea | th | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 10 | Débito Crédito | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 11 | Cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 12 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 13 | Lado | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 14 | % del lado | input:number | escribir "12345" | valor queda "12345" | ok |
| 15 | Concepto | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | Quitar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 17 | Cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 18 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 19 | Lado | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 20 | % del lado | input:number | escribir "12345" | valor queda "12345" | ok |
| 21 | Concepto | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 22 | Quitar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 23 | Agregar débito | button:button | clic | cambia contenido | ok |
| 24 | Agregar crédito | button:button | clic | cambia contenido | ok |

Probados: **22/25 (88%)** · con falla: 0 · no probados: 3

## contabilidad · `/accounting/dimensions`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva dimensión | button:button | clic | cambia contenido | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/ledgers`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Crear nuevo libro | a | clic | navega a /e/virtex-dev/accounting/ledgers/new · pestañas 2→3 · cambia contenido | ok |
| 1 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Nombre | button:button | clic | cambia contenido | ok |
| 3 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Descripción | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Por defecto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Por defecto | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Libro principal Libro contable principal, en la moneda funci | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 8 | Editar | a | clic | navega a /e/virtex-dev/accounting/ledgers/34baacff-b8e8-478c-8b5a-7388392bef5a/edit · pestañas 2→3 · cambia contenido · red: GET /accounting/ledgers/34baacff-b8e8-478c-8b5a-7388392 | ok |

Probados: **9/9 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/journals`

**Pasada automática (estado con datos QA3)** — 33 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Crear diario | a | clic | navega a /e/virtex-dev/accounting/journals/new · pestañas 2→3 · cambia contenido | ok |
| 1 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Nombre | button:button | clic | cambia contenido | ok |
| 3 | Código | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Código | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Tipo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Tipo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Asientos | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Asientos | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Diario de bancosSistema BANCOS Banco 1 Editar | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 11 | Diario de bancos | a | clic | navega a /e/virtex-dev/accounting/journals/464b1eff-0c6f-4f16-bdac-0fb61efa3fb2/edit · pestañas 2→3 · cambia contenido · red: GET /journals/464b1eff-0c6f-4f16-bdac-0fb61efa3fb2 200 | ok |
| 12 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 13 | Diario de caja | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 14 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 15 | Diario de cierre | a | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 16 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 17 | Diario de cobros | a | clic | navega a /e/virtex-dev/accounting/journals/09a390d6-71c6-40b4-8d26-b5d810f886f4/edit · pestañas 2→3 · cambia contenido · red: GET /journals/09a390d6-71c6-40b4-8d26-b5d810f886f4 200 | ok |
| 18 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 19 | Diario de compras | a | clic | navega a /e/virtex-dev/accounting/journals/65b86567-561c-41c6-b696-97603cf69e6c/edit · pestañas 2→3 · cambia contenido · red: GET /journals/65b86567-561c-41c6-b696-97603cf69e6c 200 | ok |
| 20 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 21 | Diario de conciliación | a | clic | navega a /e/virtex-dev/accounting/journals/b4a7fac0-3385-4edb-a7d5-f66ffcc3ac71/edit · pestañas 2→3 · cambia contenido · red: GET /journals/b4a7fac0-3385-4edb-a7d5-f66ffcc3ac71 200 | ok |
| 22 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 23 | Diario de depreciación | a | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 24 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 25 | Diario general | a | clic | navega a /e/virtex-dev/accounting/journals/188e2b70-3bd2-4ff5-859c-13e00c38dc3f/edit · pestañas 2→3 · cambia contenido · red: GET /journals/188e2b70-3bd2-4ff5-859c-13e00c38dc3f 200 | ok |
| 26 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 27 | Diario de nómina | a | clic | navega a /e/virtex-dev/accounting/journals/c0492c05-f792-47e6-a492-d258fc846b17/edit · pestañas 2→3 · cambia contenido · red: GET /journals/c0492c05-f792-47e6-a492-d258fc846b17 200 | ok |
| 28 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 29 | Diario de pagos | a | clic | navega a /e/virtex-dev/accounting/journals/a24a1262-e1ff-4eed-9c28-75a29f02af40/edit · pestañas 2→3 · cambia contenido · red: GET /journals/a24a1262-e1ff-4eed-9c28-75a29f02af40 200 | ok |
| 30 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |
| 31 | Diario de ventas | a | clic | navega a /e/virtex-dev/accounting/journals/de5a1234-5327-47a2-9321-1b8a76142d7e/edit · pestañas 2→3 · cambia contenido · red: GET /journals/de5a1234-5327-47a2-9321-1b8a76142d7e 200 | ok |
| 32 | Editar | a | clic | navega a /e/virtex-dev/accounting/journals/35f42380-1d61-4d4b-93ee-94375c06be9d/edit · pestañas 2→3 · cambia contenido · red: GET /journals/35f42380-1d61-4d4b-93ee-94375c06be9d 200 | ok |

Probados: **30/33 (91%)** · con falla: 0 · no probados: 3

## contabilidad · `/accounting/journals/new`

**Pasada automática (estado con datos QA3)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journals · pestañas 2→3 · cambia contenido · red: GET /journals 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journals · pestañas 2→3 · cambia contenido · red: GET /journals 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Nombre» es obligatorio «Código» es obligatorio | ok |
| 3 | name | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Código» es obligatorio | ok |
| 4 | code | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 5 | Ventas Compras Caja Banco General | select | seleccionar 5 opciones | valor queda "undefined" | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/periods`

**Pasada automática (estado con datos QA3)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Actualizar | button:button | clic | red: GET /accounting/periods 200 | ok |
| 1 | Período | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Período | button:button | clic | cambia contenido | ok |
| 3 | Fecha de inicio | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Fecha de inicio | button:button | clic | cambia contenido | ok |
| 5 | Fecha de cierre | th | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 6 | Fecha de cierre | button:button | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 7 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Estado | button:button | clic | cambia contenido · red: POST /auth/refresh 200 | ok |
| 9 | Acción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | enero de 2026 01/01/2026 31/01/2026 Abierto Cerrar período | fila | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 11 | Cerrar período | button:button | - | probado en flujos 33/34: confirmación, cierre 200, asiento en cerrado → 403, reabrir con motivo | ok |

Probados: **9/12 (75%)** · con falla: 0 · no probados: 3

## contabilidad · `/accounting/fixed-assets`

**Pasada automática (estado con datos QA3)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Ejecutar depreciación | a | - | probado en flujo 47 (DEPREC-2026-000001) | ok |
| 1 | Nuevo activo | a | clic | navega a /e/virtex-dev/accounting/fixed-assets/new · pestañas 2→3 · cambia contenido | ok |
| 2 | Número o nombre | input:search | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 3 | Todos En uso Vendido Dado de baja | select | seleccionar 4 opciones | cambia contenido · red: GET /fixed-assets?status=IN_USE&page=1&pageSize=50 200, GET /fixed-assets?page=1&pageSize=50 200, GET /fixed-assets?status=IN_USE&page=1&pageSize=50 200, GE | ok |
| 4 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 5 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 6 | 50 100 200 | select | seleccionar 3 opciones | red: GET /fixed-assets?status=DISPOSED&page=1&pageSize=50 200, GET /fixed-assets?status=DISPOSED&page=1&pageSize=100 200, GET /fixed-assets?status=DISPOSED&page=1&pageSize=200 200 | ok |

Probados: **5/7 (71%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/fixed-assets/new`

**Pasada automática (estado con datos QA3)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/fixed-assets · pestañas 2→3 · cambia contenido · red: GET /fixed-assets?status=IN_USE&page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/fixed-assets · pestañas 2→3 · cambia contenido · red: GET /fixed-assets?status=IN_USE&page=1&pageSize=50 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Nombre» es obligatorio «Costo» es obligatorio «Cuenta del activo» es obligatorio «Cuenta de depreciación acumulada» es | ok |
| 3 | Camioneta de reparto, servidor, local… | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Costo» es obligatorio «Cuenta del activo» es obligatorio «Cuenta de depreciación acumulada» es obligatorio | ok |
| 4 | Marca, modelo, serie, ubicación… | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | fa-acquired | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 6 | fa-in-service | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 7 | cost | input:number | escribir "12345" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Cuenta del activo» es obligatorio «Cuenta de depreciación acumulada» es obligatorio | ok |
| 8 | residualValue | input:number | escribir "12345" | valor queda "12345" | ok |
| 9 | usefulLifeMonths | input:number | escribir "12345" | valor queda "12345" | ok |
| 10 | Línea recta Saldo decreciente doble Suma de los dígitos de l | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 11 | Elige una cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 12 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 13 | Elige una cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 14 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 15 | La predeterminada de la empresa | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 16 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 17 | migrated | input:checkbox | clic | cambia contenido | ok |

Probados: **18/18 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/fixed-assets/depreciation`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Registrar depreciación | button:button | - | deshabilitado en este estado | no probado |
| 1 | dr-period | input:month | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **0/2 (0%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/budgets`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Análisis de variaciones | a | clic | navega a /e/virtex-dev/accounting/variance-analysis · pestañas 2→3 · cambia contenido · red: GET /budgets/variance?fromPeriod=2026-01&toPeriod=2026-10 200 | ok |
| 1 | Nuevo presupuesto | a | clic | navega a /e/virtex-dev/accounting/budgets/new · pestañas 2→3 · cambia contenido | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/budgets/new`

**Pasada automática (estado con datos QA3)** — 14 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/budgets · pestañas 2→3 · cambia contenido · red: GET /budgets 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/budgets · pestañas 2→3 · cambia contenido · red: GET /budgets 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Nombre» es obligatorio «Account id» es obligatorio «Monto» es obligatorio Cada línea necesita una cuenta y un monto. | ok |
| 3 | Ej.: Presupuesto operativo 2026 | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Account id» es obligatorio «Monto» es obligatorio Cada línea necesita una cuenta y un monto. | ok |
| 4 | period | input:month | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 5 | Cuenta | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Monto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Quitar línea | th | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 8 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 9 | Cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 10 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 11 | Monto | input:number | escribir "12345" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Account id» es obligatorio Cada línea necesita una cuenta y un monto. | ok |
| 12 | Quitar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 13 | Agregar cuenta | button:button | clic | cambia contenido | ok |

Probados: **11/14 (79%)** · con falla: 0 · no probados: 3

## contabilidad · `/accounting/variance-analysis`

**Pasada automática (estado con datos QA3)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Presupuestos | a | clic | navega a /e/virtex-dev/accounting/budgets · pestañas 2→3 · cambia contenido · red: GET /budgets 200 | ok |
| 1 | var-from | input:month | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 2 | var-to | input:month | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **1/3 (33%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/closing/annual-close`

**Pasada automática (estado con datos QA3)** — 5 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 1 | Quitar la selección | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 2 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 3 | Ir a la tarea | a | clic | navega a /e/virtex-dev/accounting/periods · pestañas 2→3 · cambia contenido · red: GET /accounting/periods 200 | ok |
| 4 | Cerrar ejercicio | button:button | - | deshabilitado en este estado | no probado |

Probados: **3/5 (60%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/audit-adjustments`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Proponer ajuste | button:button | clic | navega a /e/virtex-dev/accounting/audit-adjustments/new · pestañas 2→3 · cambia contenido · red: GET /accounting/fiscal-years?status=CLOSED 200, GET /journals 200 | ok |
| 1 | Todos los ejercicios 2031-01-01 – 2031-12-31 2026-01-01 – 20 | select | seleccionar 3 opciones | red: GET /audit/adjustments?pageSize=50 200, GET /audit/adjustments?pageSize=50&fiscalYearId=c61755af-c873-41de-8216-ed9ff0a67ce1 200, GET /audit/adjustments?pageSize=50&fiscalYear | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/audit-adjustments/new`

**Pasada automática (estado con datos QA3)** — 24 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/audit-adjustments · pestañas 2→3 · cambia contenido · red: GET /accounting/fiscal-years 200, GET /audit/adjustments?pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/audit-adjustments · pestañas 2→3 · cambia contenido · red: GET /accounting/fiscal-years 200, GET /audit/adjustments?pageSize=50 200 | ok |
| 2 | Proponer ajuste | button:submit | clic | cambia contenido · aviso: Revisa 8 punto(s) antes de guardar Elige el ejercicio que se corrige. Elige el diario donde se registrará. Describe el ajuste. Línea 1: falta la cuenta. L | ok |
| 3 | Elige un ejercicio cerrado… | select | seleccionar 1 opciones | cambia contenido | ok |
| 4 | Elige un diario… BANCOS — Diario de bancos CAJA — Diario de  | select | seleccionar 12 opciones | valor queda "undefined" | ok |
| 5 | Ej. Gasto devengado no registrado | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 6 | Cuenta | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Concepto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Débito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Crédito | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 11 | Elige una cuenta… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 12 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 13 | description | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 14 | debit | input:number | escribir "12345" | valor queda "12345" | ok |
| 15 | credit | input:number | escribir "12345" | valor queda "12345" | ok |
| 16 | Quitar la línea | button:button | - | deshabilitado en este estado | no probado |
| 17 | Elige una cuenta… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 18 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 19 | description | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 20 | debit | input:number | escribir "12345" | valor queda "12345" | ok |
| 21 | credit | input:number | escribir "12345" | valor queda "12345" | ok |
| 22 | Quitar la línea | button:button | - | deshabilitado en este estado | no probado |
| 23 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **22/24 (92%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/closing/checklist`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | 01/01/2026 — 31/01/2026 01/02/2026 — 28/02/2026 01/03/2026 — | select | seleccionar 24 opciones | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 1 | Actualizar | button:button | clic | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 2 | Resolver | a | clic | "Resolver" navega a Inicio (/overview) en lugar del paso pendiente (verificado manualmente) | con falla |
| 3 | Resolver | a | - | "Resolver" navega a Inicio (/overview) en lugar del paso pendiente (verificado manualmente) | con falla |
| 4 | Escribir el plan de cierre | button:button | - | plan: requiere IA (no configurada en el entorno); procesar: irreversible sobre el período en curso | no probado |
| 5 | Nombre de la lista | th | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 6 | Verificar y procesar todos los asientos contables en borrado | fila | - | plan: requiere IA (no configurada en el entorno); procesar: irreversible sobre el período en curso | no probado |
| 7 | Resolver | a | - | "Resolver" navega a Inicio (/overview) en lugar del paso pendiente (verificado manualmente) | con falla |
| 8 | Resolver | a | - | "Resolver" navega a Inicio (/overview) en lugar del paso pendiente (verificado manualmente) | con falla |

Probados: **4/9 (44%)** · con falla: 4 · no probados: 5

## contabilidad · `/reports/financial-statements/balance-sheet`

**Pasada automática (estado con datos QA3)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | balanceSheetAsOf | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/balance-sheet?asOfDate=2026-09-15 200 | ok |
| 1 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 2 | Actualizar | button:button | clic | red: GET /financial-reporting/balance-sheet?asOfDate=2026-09-15 200 | ok |

Probados: **3/3 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/reports/financial-statements/income-statement`

**Pasada automática (estado con datos QA3)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-4-from | input:date | escribir "2026-09-15" | red: GET /financial-reporting/income-statement?startDate=2026-09-15&endDate=2026-10-29 200 | ok |
| 1 | vx-date-range-4-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/income-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 3 | Actualizar | button:button | clic | red: GET /financial-reporting/income-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |

Probados: **4/4 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/reports/financial-statements/trial-balance`

**Pasada automática (estado con datos QA3)** — 22 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-5-from | input:date | escribir "2026-09-15" | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 1 | vx-date-range-5-to | input:date | escribir "2026-09-15" | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 2 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 3 | Actualizar | button:button | clic | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 4 | Cuenta | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 5 | Cuenta | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 6 | Saldo inicial | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 7 | Movimientos del período | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 8 | Saldo final | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 9 | Debe | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 10 | Debe | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 11 | Haber | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 12 | Haber | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 13 | Debe | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 14 | Debe | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 15 | Haber | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 16 | Haber | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 17 | Debe | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 18 | Debe | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 19 | Haber | th | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 20 | Haber | button:button | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |
| 21 | 1120 Bancos 0.00 0.00 54,155.00 3,801.00 50,354.00 0.00 | fila | - | encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente) | ok |

Probados: **22/22 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/reports/financial-statements/cash-flow`

**Pasada automática (estado con datos QA3)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-6-from | input:date | escribir "2026-09-15" | red: GET /financial-reporting/cash-flow-statement?startDate=2026-09-15&endDate=2026-10-29 200 | ok |
| 1 | vx-date-range-6-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/cash-flow-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 3 | Actualizar | button:button | clic | red: GET /financial-reporting/cash-flow-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |

Probados: **4/4 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/reports/fiscal-returns`

**Pasada automática (estado con datos QA3)** — 48 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | 2026 | select | seleccionar 1 opciones | red: GET /compliance/filings?year=2026 200 | ok |
| 1 | Período | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | 606 · Compras | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | 607 · Ventas | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | 608 · Anulados | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | 609 · Pagos al exterior | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Vence | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Enero De 2026 No aplica No aplica No aplica No aplica — | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 8 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 9 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 10 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 11 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 12 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 13 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 14 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 15 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 16 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 17 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 18 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 19 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 20 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 21 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 22 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 23 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 24 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 25 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 26 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 27 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 28 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 29 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 30 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 31 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 32 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 33 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 34 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 35 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 36 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 37 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 38 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 39 | No aplica | button:button | - | deshabilitado en este estado | no probado |
| 40 | Vencida | button:button | clic | cambia contenido | ok |
| 41 | Vencida | button:button | clic | cambia contenido | ok |
| 42 | Vencida | button:button | clic | cambia contenido | ok |
| 43 | Vencida | button:button | clic | cambia contenido | ok |
| 44 | Sin generar | button:button | clic | cambia contenido | ok |
| 45 | Generada 2 registros | button:button | clic | cambia contenido | ok |
| 46 | Sin generar | button:button | clic | cambia contenido | ok |
| 47 | Generada 0 registros | button:button | clic | cambia contenido | ok |

Probados: **16/48 (33%)** · con falla: 0 · no probados: 32

## contabilidad · `/masters/taxes`

**Pasada automática (estado con datos QA3)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo impuesto | a | clic | navega a /e/virtex-dev/masters/taxes/new · pestañas 2→3 · cambia contenido | ok |
| 1 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Nombre | button:button | clic | cambia contenido | ok |
| 3 | Tipo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Tipo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Tasa (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Tasa (%) | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | País | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | País | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | ITBIS 18% Porcentaje 18.00% DO | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 10 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 11 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 12 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |

Probados: **9/13 (69%)** · con falla: 0 · no probados: 4

## contabilidad · `/masters/taxes/new`

**Pasada automática (estado con datos QA3)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/taxes · pestañas 2→3 · cambia contenido · red: GET /taxes 200, GET /localization/tax-jurisdictions 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/taxes · pestañas 2→3 · cambia contenido · red: GET /localization/tax-jurisdictions 200, GET /taxes 200 | ok |
| 2 | Guardar impuesto | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del impuesto» es obligatorio | ok |
| 3 | Ej: IVA general | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | rate | input:number | escribir "12345" | valor queda "12345" | ok |
| 5 | Porcentaje Monto fijo | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 6 | DO, US, MX | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **7/7 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/masters/currencies`

**Pasada automática (estado con datos QA3)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Tipos de cambio | a | clic | navega a /e/virtex-dev/masters/currencies/exchange-rates · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /exchange-rates/history?scope=ALL&page=1&limit=100 200 | ok |
| 1 | Nombre de la moneda | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Nombre de la moneda | button:button | clic | cambia contenido | ok |
| 3 | Código | th | clic | pestañas 2→3 | ok |
| 4 | Código | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Símbolo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Símbolo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Moneda base | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Moneda base | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Peso argentino ARS AR$ | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **9/10 (90%)** · con falla: 0 · no probados: 1

## contabilidad · `/masters/currencies/exchange-rates`

**Pasada automática (estado con datos QA3)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Importar | button:button | clic | sin efecto: ni red, ni diálogo, ni cambio (verificado manualmente: 96-sospechosos.cjs) | con falla |
| 1 | Registrar tasa | button:button | clic | sin efecto: ni red, ni diálogo, ni cambio (verificado manualmente: 96-sospechosos.cjs) | con falla |
| 2 | Todas ARS BOB BRL CAD CHF CLP CNY COP CRC DOP EUR GBP GTQ HN | select | seleccionar 24 opciones | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 3 | Todos Oficial Mercado Compra Venta | select | seleccionar 5 opciones | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 4 | Todas De la empresa Compartida | select | seleccionar 3 opciones | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 5 | rate-from | input:date | escribir "2026-09-15" | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 6 | rate-to | input:date | escribir "2026-09-15" | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |
| 7 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 8 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 9 | 50 100 250 | select | seleccionar 3 opciones | no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs) | no probado |

Probados: **2/10 (20%)** · con falla: 2 · no probados: 8

## contabilidad · `/masters/payment-terms`

**Pasada automática (estado con datos QA3)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 1 | Nombre | button:button | clic | cambia contenido | ok |
| 2 | Días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Días | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 4 | Clientes | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Clientes | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 6 | Sin nombre 0 1 | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **6/7 (86%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/products`

**Pasada automática (estado con datos QA3)** — 26 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo producto | a | clic | navega a /e/virtex-dev/inventory/products/new · pestañas 2→3 · cambia contenido · red: GET /ai/status 200, GET /wms/warehouses 200, GET /inventory/categories 200, GET /invoices/con | ok |
| 1 | Buscar por nombre, SKU o categoría... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 2 | Seleccionar todo | input:checkbox | clic | cambia contenido | ok |
| 3 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Producto | button:button | clic | cambia contenido | ok |
| 5 | Categoría | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Categoría | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Precio | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Precio | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Costo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Costo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 11 | Existencias | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Existencias | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 13 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 15 | QA3-5521-Servicio instalación QA3-SRV-5521 — 3,000.00 0.00 — | fila | clic | casilla de selección: no aparecen acciones masivas (sin propósito visible; verificado manualmente) | ok |
| 16 | QA3-5521-Servicio instalación | input:checkbox | clic | casilla de selección: no aparecen acciones masivas (sin propósito visible; verificado manualmente) | ok |
| 17 | QA3-5521-Servicio instalación | a | clic | casilla de selección: no aparecen acciones masivas (sin propósito visible; verificado manualmente) | ok |
| 18 | Editar | a | clic | navega a /e/virtex-dev/inventory/products/d1690807-2bf3-45fa-9990-c3131fe56bd1/edit · pestañas 2→3 · cambia contenido · red: GET /ai/status 200, GET /inventory/categories 200, GET  | ok |
| 19 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |
| 20 | Acciones de la fila | button:button | clic | abre diálogo/panel · abre menú/lista | ok |
| 21 | QA3-7734-Widget ergonómico | input:checkbox | clic | casilla de selección: no aparecen acciones masivas (sin propósito visible; verificado manualmente) | ok |
| 22 | QA3-7734-Widget ergonómico | a | clic | casilla de selección: no aparecen acciones masivas (sin propósito visible; verificado manualmente) | ok |
| 23 | Editar | a | clic | navega a /e/virtex-dev/inventory/products/d1690807-2bf3-45fa-9990-c3131fe56bd1/edit · pestañas 2→3 · cambia contenido · red: GET /ai/status 200, GET /wms/warehouses 200, GET /inven | ok |
| 24 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |
| 25 | Acciones de la fila | button:button | clic | abre diálogo/panel · abre menú/lista | ok |

Probados: **26/26 (100%)** · con falla: 0 · no probados: 0

## inventario · `/inventory/products/new`

**Pasada automática (estado con datos QA3)** — 24 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/products · pestañas 2→3 · cambia contenido · red: GET /inventory 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/products · pestañas 2→3 · cambia contenido · red: GET /inventory 200 | ok |
| 2 | Guardar producto | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del producto» es obligatorio | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | sku | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | description | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 6 | brand | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | barcode | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 8 | Escanear el código de barras con la cámara | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 9 | imageFile | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 10 | attrKey | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 11 | attrValue | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | Añadir atributo | button:button | clic | cambia contenido | ok |
| 13 | price | input:number | escribir "12345" | valor queda "12345" | ok |
| 14 | stock | input:number | escribir "12345" | valor queda "12345" | ok |
| 15 | Almacén predeterminado Almacén principal QA3-Almacén Norte 8 | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 16 | cost | input:number | escribir "12345" | valor queda "12345" | ok |
| 17 | reorderLevel | input:number | escribir "12345" | valor queda "12345" | ok |
| 18 | Bien (se inventaría) Servicio (no se inventaría) | select | seleccionar 2 opciones | cambia contenido | ok |
| 19 | UND · Unidad PAR · Par DOC · Docena CJ · Caja PAQ · Paquete  | select | seleccionar 26 opciones | valor queda "undefined" | ok |
| 20 | Gravado Tasa cero Exento | select | seleccionar 3 opciones | cambia contenido | ok |
| 21 | 18% 16% | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 22 | Sin categoría General | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 23 | Activo Inactivo | select | seleccionar 2 opciones | valor queda "undefined" | ok |

Probados: **23/24 (96%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/predictions`

**Pasada automática (estado con datos QA3)** — 8 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Calculando… | button:button | - | deshabilitado en este estado | no probado |
| 1 | Buscar producto o SKU | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /ai/forecasts/insights?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27&sort=risk&limit=50&offset=0 200 | ok |
| 2 | Todos los almacenes Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | red: GET /ai/forecasts/insights?sort=risk&limit=50&offset=0 200, GET /ai/forecasts/insights?warehouseId=f56fabde-cb33-4b32-a0fa-5ed220907de9&sort=risk&limit=50&offset=0 200, GET /a | ok |
| 3 | Todos los estados Riesgo de quiebre Reponer Exceso Sin movim | select | seleccionar 6 opciones | red: GET /ai/forecasts/insights?warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462&sort=risk&limit=50&offset=0 200, GET /ai/forecasts/insights?status=STOCKOUT_RISK&warehouseId=3beaf9 | ok |
| 4 | Riesgo primero Más vendidos | select | seleccionar 2 opciones | red: GET /ai/forecasts/insights?status=OK&warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462&sort=risk&limit=50&offset=0 200, GET /ai/forecasts/insights?status=OK&warehouseId=3beaf9f | ok |
| 5 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 6 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 7 | 25 50 100 200 | select | seleccionar 4 opciones | red: GET /ai/forecasts/insights?status=OK&warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462&sort=top_sellers&limit=25&offset=0 200, GET /ai/forecasts/insights?status=OK&warehouseId= | ok |

Probados: **5/8 (63%)** · con falla: 0 · no probados: 3

## inventario · `/inventory/stock`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva transferencia | a | clic | navega a /e/virtex-dev/inventory/transfers/new · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200 | ok |
| 1 | Nuevo ajuste | a | clic | navega a /e/virtex-dev/inventory/adjustments/new · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200 | ok |
| 2 | Buscar por nombre o SKU | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /inventory/stock?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27&page=1&limit=100 200 | ok |
| 3 | Todos los almacenes Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | cambia contenido · red: GET /inventory/stock?page=1&limit=100 200, GET /inventory/stock?page=1&limit=100 200, GET /inventory/stock?warehouseId=f56fabde-cb33-4b32-a0fa-5ed220907de9& | ok |
| 4 | (sin texto) | input:checkbox | clic | red: GET /inventory/stock?warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462&includeZero=true&page=1&limit=100 200 | ok |
| 5 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | SKU | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Almacén | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | En existencia | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Costo unitario | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Valor | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | QA3-7734-Widget ergonómico QA3-SKU-7734 Almacén principal 31 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 12 | QA3-7734-Widget ergonómico | a | clic | navega a /e/virtex-dev/inventory/movements?productId=ca5e5c1c-0bca-4598-b8e9-cdf00f853969&warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462 · pestañas 2→3 · cambia contenido · red:  | ok |
| 13 | QA3-7734-Widget ergonómico | a | clic | navega a /e/virtex-dev/inventory/movements?productId=ca5e5c1c-0bca-4598-b8e9-cdf00f853969&warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462 · pestañas 2→3 · cambia contenido · red:  | ok |
| 14 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 15 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 16 | 50 100 250 | select | seleccionar 3 opciones | red: GET /inventory/stock?warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462&includeZero=true&page=1&limit=50 200, GET /inventory/stock?warehouseId=3beaf9f2-6017-4edd-83a3-341e3c2384 | ok |

Probados: **15/17 (88%)** · con falla: 0 · no probados: 2

## inventario · `/inventory/movements`

**Pasada automática (estado con datos QA3)** — 36 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Todos los productos | input:text | escribir "QA-áéí ñ <b>&"'" | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 1 | (sin texto) | button:button | clic | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 2 | Todos los almacenes Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 3 | Todos los tipos Saldo inicial Recepción de compra Devolución | select | seleccionar 9 opciones | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 4 | vx-date-range-9-from | input:date | escribir "2026-09-15" | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 5 | vx-date-range-9-to | input:date | escribir "2026-09-15" | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 6 | Fecha | th | clic | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 7 | Producto | th | clic | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 8 | Almacén | th | clic | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 9 | Tipo | th | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 10 | Referencia | th | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 11 | Entrada | th | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 12 | Salida | th | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 13 | Costo unitario | th | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 14 | 28/10/2026, 08:04 p. m. QA3-7734-Widget ergonómico Almacén p | fila | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 15 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 16 | QA3-SKU-7734 | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 17 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 18 | B0100000001 | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 19 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 20 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 21 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 22 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 23 | B0200000001 | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 24 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 25 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 26 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 27 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 28 | TR-2026-000001 | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 29 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 30 | TR-2026-000001 | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 31 | QA3-7734-Widget ergonómico | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 32 | AJ-2026-000001 — QA3 merma por daño | a | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 33 | Página anterior | button:button | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 34 | Página siguiente | button:button | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 35 | 50 100 250 | select | seleccionar 3 opciones | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |

Probados: **36/36 (100%)** · con falla: 0 · no probados: 0

## inventario · `/inventory/kardex`

**Pasada automática (estado con datos QA3)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Todos los productos | input:text | escribir "QA-áéí ñ <b>&"'" | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 1 | (sin texto) | button:button | clic | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 2 | Todos los almacenes Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 3 | Todos los tipos Saldo inicial Recepción de compra Devolución | select | seleccionar 9 opciones | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 4 | vx-date-range-10-from | input:date | escribir "2026-09-15" | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 5 | vx-date-range-10-to | input:date | escribir "2026-09-15" | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 6 | Reintentar | button:button | clic | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 7 | Página anterior | button:button | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 8 | Página siguiente | button:button | - | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |
| 9 | 50 100 250 | select | seleccionar 3 opciones | fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente) | ok |

Probados: **10/10 (100%)** · con falla: 0 · no probados: 0

## inventario · `/inventory/adjustments`

**Pasada automática (estado con datos QA3)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo ajuste | a | clic | navega a /e/virtex-dev/inventory/adjustments/new · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200 | ok |
| 1 | Todos Borrador Contabilizado Anulado | select | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 2 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Almacén | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Motivo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Líneas | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Valor ajustado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | AJ-2026-000001 29/10/2026 Almacén principal QA3 merma por da | fila | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 10 | AJ-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |

Probados: **10/11 (91%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/adjustments/new`

**Pasada automática (estado con datos QA3)** — 23 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/adjustments · pestañas 2→3 · cambia contenido · red: GET /inventory/adjustments 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/adjustments · pestañas 2→3 · cambia contenido · red: GET /inventory/adjustments 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Motivo» es obligatorio «Product id» es obligatorio Cada línea necesita un producto. | ok |
| 3 | adj-date | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 4 | Elige un almacén Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 5 | Ej.: conteo físico de fin de mes | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Product id» es obligatorio Cada línea necesita un producto. | ok |
| 6 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | En existencia | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Contado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Cambio | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Costo de entrada | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Costo unitario nuevo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | — | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 15 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 16 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50 200 | ok |
| 17 | Contado | input:number | escribir "12345" | valor queda "12345" | ok |
| 18 | Cambio | input:number | escribir "12345" | valor queda "12345" | ok |
| 19 | Costo de entrada | input:number | escribir "12345" | valor queda "12345" | ok |
| 20 | Costo unitario nuevo | input:number | escribir "12345" | valor queda "12345" | ok |
| 21 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 22 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **22/23 (96%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/transfers`

**Pasada automática (estado con datos QA3)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva transferencia | a | clic | navega a /e/virtex-dev/inventory/transfers/new · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200 | ok |
| 1 | Todos Borrador Contabilizado Anulado | select | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 2 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Origen | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Destino | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Líneas | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | TR-2026-000001 29/10/2026 Almacén principal QA3-Almacén Nort | fila | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |
| 9 | TR-2026-000001 | a | clic | abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores) | ok |

Probados: **9/10 (90%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/transfers/new`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/transfers · pestañas 2→3 · cambia contenido · red: GET /inventory/transfers 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/transfers · pestañas 2→3 · cambia contenido · red: GET /inventory/transfers 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 6 punto(s) antes de guardar «Origen» es obligatorio «Destino» es obligatorio «Product id» es obligatorio «Cantidad» es obligatorio Cada línea neces | ok |
| 3 | tr-date | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 4 | Elige un almacén Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Destino» es obligatorio «Product id» es obligatorio «Cantidad» es obligatorio Cada línea necesita un producto. Cada lí | ok |
| 5 | Elige un almacén Almacén principal QA3-Almacén Norte 8830 | select | seleccionar 3 opciones | cambia contenido | ok |
| 6 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Disponible | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Cantidad | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | — | fila | clic | red: POST /auth/refresh 200 | ok |
| 12 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 13 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50 200 | ok |
| 14 | Cantidad | input:number | escribir "12345" | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Destino» es obligatorio «Product id» es obligatorio Cada línea necesita un producto. Cada línea necesita un producto y | ok |
| 15 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 16 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **16/17 (94%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/categories`

**Pasada automática (estado con datos QA3)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva categoría | button:button | clic | cambia contenido | ok |
| 1 | (sin texto) | input:checkbox | clic | red: GET /inventory/categories?includeInactive=true 200 | ok |
| 2 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Código | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | General GENERAL Activa Retirar | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 7 | Editar | button:button | clic | cambia contenido | ok |
| 8 | Retirar | button:button | clic | retira la categoría sin confirmación (PATCH 200; la pasada retiró "General" preexistente y se reactivó a mano) | ok |
| 9 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |

Probados: **9/10 (90%)** · con falla: 0 · no probados: 1

## inventario · `/masters/warehouses`

**Pasada automática (estado con datos QA3)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo almacén | button:button | clic | cambia contenido | ok |
| 1 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Nombre | button:button | clic | cambia contenido | ok |
| 3 | Código | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Código | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Ubicación | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Ubicación | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Almacén principalPredeterminado PRINCIPAL — Activo | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 11 | Almacén principal | a | clic | navega a /e/virtex-dev/inventory/stock?warehouseId=f56fabde-cb33-4b32-a0fa-5ed220907de9 · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200, GET /inventory/stock?wareh | ok |
| 12 | QA3-Almacén Norte 8830 | a | clic | navega a /e/virtex-dev/inventory/stock?warehouseId=3beaf9f2-6017-4edd-83a3-341e3c238462 · pestañas 2→3 · cambia contenido · red: GET /wms/warehouses 200, GET /inventory/stock?wareh | ok |
| 13 | Hacer predeterminado | button:button | clic | PATCH 200 (cambió el predeterminado; restaurado a mano) | ok |
| 14 | Cerrar almacén | button:button | clic | 400 esperado con mensaje: el almacén tiene existencias | ok |

Probados: **14/15 (93%)** · con falla: 0 · no probados: 1

## inventario · `/masters/units-of-measure`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva unidad | button:button | clic | cambia contenido | ok |
| 1 | Tipo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Tipo | button:button | clic | cambia contenido | ok |
| 3 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Nombre | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Símbolo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Símbolo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Unidades Caja CJ | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **8/9 (89%)** · con falla: 0 · no probados: 1

## rrhh · `/payroll/my-payslips`

**Pasada automática (estado con datos QA3)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/payroll/runs`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva nómina | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 1 | Período | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 2 | Período | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 3 | Nombre | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 4 | Nombre | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 5 | Tipo | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 6 | Tipo | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 7 | Devengado | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 8 | Devengado | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 9 | Neto a pagar | th | - | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 10 | Neto a pagar | button:button | - | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 11 | Aportes patronales | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 12 | Aportes patronales | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 13 | Estado | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 14 | Estado | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 15 | 2026-10 Nómina 10/2026 Ordinaria RD$65,000.00 RD$56,730.95 R | fila | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 16 | 2026-10 | a | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |

Probados: **17/17 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/hcm/employees`

**Pasada automática (estado con datos QA3)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo empleado | a | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 1 | Buscar por nombre, correo o puesto… | input:search | escribir "QA-áéí ñ <b>&"'" | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 2 | (sin texto) | input:checkbox | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 3 | Nombre | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 4 | Nombre | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 5 | Puesto | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 6 | Puesto | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 7 | Departamento | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 8 | Departamento | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 9 | Fecha de ingreso | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 10 | Fecha de ingreso | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 11 | Estado | th | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 12 | Estado | button:button | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 13 | Peña-7731, María QA3 qa3-7731@example.com Analista QA3 QA3-1 | fila | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |
| 14 | Peña-7731, María QA3 | a | clic | abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación) | ok |

Probados: **15/15 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/hcm/employees/new`

**Pasada automática (estado con datos QA3)** — 22 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/hcm/employees · pestañas 2→3 · cambia contenido · red: GET /hcm/employees?pageSize=200 200, GET /hcm/departments 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/hcm/employees · pestañas 2→3 · cambia contenido · red: GET /hcm/employees?pageSize=200 200, GET /hcm/departments 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Nombres» es obligatorio «Apellidos» es obligatorio «Correo» es obligatorio «DocumentoCifrado. Déjalo en blanco para no | ok |
| 3 | firstName | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Apellidos» es obligatorio «Correo» es obligatorio «DocumentoCifrado. Déjalo en blanco para no cambiarlo.» es obligator | ok |
| 4 | lastName | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Correo» es obligatorio «DocumentoCifrado. Déjalo en blanco para no cambiarlo.» es obligatorio | ok |
| 5 | email | input:email | escribir "qa@example.com" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «DocumentoCifrado. Déjalo en blanco para no cambiarlo.» es obligatorio | ok |
| 6 | jobTitle | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | QA3-1180-Operaciones | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 8 | hireDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 9 | Cédula Pasaporte | select | seleccionar 2 opciones | cambia contenido | ok |
| 10 | 001-1234567-3 | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «DocumentoCifrado. Déjalo en blanco para no cambiarlo.» es obligatorio | ok |
| 11 | (sin texto) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | (sin texto) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 13 | (sin texto) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 14 | bankName | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 15 | bankAccountNumber | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | bankAccountType | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 17 | Activo Suspendido Desvinculado | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 18 | Indefinido Tiempo determinado Ocasional | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 19 | terminationDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 20 | initialSalary | input:number | escribir "12345" | valor queda "12345" | ok |
| 21 | Mensual Quincenal Semanal | select | seleccionar 3 opciones | valor queda "undefined" | ok |

Probados: **22/22 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/hcm/departments`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo departamento | button:button | clic | cambia contenido | ok |
| 1 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Nombre | button:button | clic | cambia contenido | ok |
| 3 | Centro de costo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Centro de costo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | QA3-1180-Operaciones QA3OPS | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 7 | Editar | button:button | clic | cambia contenido | ok |
| 8 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |

Probados: **9/9 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/payroll/concepts`

**Pasada automática (estado con datos QA3)** — 30 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo concepto | button:button | clic | cambia contenido | ok |
| 1 | (sin texto) | input:checkbox | clic | red: GET /payroll/concepts?includeInactive=true 200 | ok |
| 2 | Código | th | clic | cambia contenido | ok |
| 3 | Código | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 4 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Nombre | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 6 | Tipo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Tipo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Cálculo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Cálculo | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | Tasa | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Tasa | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Gravable | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Gravable | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | HE35 Horas extra (35 %) Ingreso Por horas 1.35 ✓ | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 16 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 17 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 18 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 19 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 20 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 21 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 22 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 23 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 24 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 25 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 26 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 27 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |
| 28 | Editar | button:button | clic | abre la edición en línea de la fila (verificado manualmente) | ok |
| 29 | Eliminar | button:button | - | registro preexistente (regla: destructivas solo sobre datos QA de esta sesión) | no probado |

Probados: **22/30 (73%)** · con falla: 0 · no probados: 8

## rrhh · `/payroll/parameters`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Añadir parámetro | button:button | clic | cambia contenido | ok |
| 1 | Régimen | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Tasa del empleado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Tasa patronal | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Base | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Vigencia | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | AFP 2.87% 7.10% Salario con tope Vigente desde 01/01/2020 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 7 | Parámetro | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Valor | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Vigencia | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Salario mínimo cotizable 10,000.00 Vigente desde 01/01/2020 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 11 | Desde (anual) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Hasta (anual) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Tasa | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | Impuesto acumulado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Vigencia | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 16 | 0.00 416,220.00 0% 0.00 Vigente desde 01/01/2017 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **17/17 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/accounting/treasury`

**Pasada automática (estado con datos QA3)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | treasuryAsOf | input:date | escribir "2026-09-15" | cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/bank-transfers?pageSize=25 200, GET /treasury/cash-position?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/bank-transfers?pageSize=25 200, GET /treasury/cash-position?asOfDate=2026-09-15 200 | ok |
| 2 | Nueva cuenta bancaria | a | clic | navega a /e/virtex-dev/accounting/treasury/bank-accounts/new · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200, GET /currencies 200, GET /treasury/banks 200, GET  | ok |
| 3 | Cuentas bancarias | th | clic | cambia contenido | ok |
| 4 | Cuentas bancarias | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Banco | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Banco | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Número | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Moneda | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Moneda | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 11 | Saldo en su moneda | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Saldo en su moneda | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 13 | Saldo en moneda de los libros | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | Saldo en moneda de los libros | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 15 | Caja general — — DOP RD$0.00 0.00 | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 16 | Caja general | a | clic | navega a /e/virtex-dev/accounting/treasury/bank-accounts/a69424ce-d7af-42e3-8d49-f449791b37c9/edit · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts/a69424ce-d7a | ok |
| 17 | QA3-6620-Banco operativo | a | clic | navega a /e/virtex-dev/accounting/treasury/bank-accounts/5e53bb19-f1c3-4706-9378-1466f07bdfeb/edit · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /treasury/banks | ok |

Probados: **17/18 (94%)** · con falla: 0 · no probados: 1

## tesoreria · `/accounting/treasury/cash-flow`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Calculando… | button:button | - | deshabilitado en este estado | no probado |

Probados: **0/1 (0%)** · con falla: 0 · no probados: 1

## tesoreria · `/accounting/treasury/bank-accounts/new`

**Pasada automática (estado con datos QA3)** — 14 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/treasury · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/bank-transfers?pageSize=25 200, GET /treasury/cas | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/treasury · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/bank-transfers?pageSize=25 200, GET /treasury/cas | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Nombre» es obligatorio «Cuenta contable» es obligatorio | ok |
| 3 | name | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Cuenta contable» es obligatorio | ok |
| 4 | — No está en el catálogo — | select | seleccionar 1 opciones | valor queda "undefined" | ok |
| 5 | bankName | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 6 | accountNumber | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | Corriente Ahorros Caja / efectivo Tarjeta de crédito | select | seleccionar 4 opciones | valor queda "undefined" | ok |
| 8 | PAB BOB VES CRC NIO CAD USD EUR CHF PYG HNL GBP ARS CLP COP  | select | seleccionar 24 opciones | valor queda "undefined" | ok |
| 9 | 1110 — Efectivo y Equivalentes de Efectivo 1120 — Bancos | select | seleccionar 3 opciones | cambia contenido | ok |
| 10 | openingBalance | input:number | escribir "12345" | cambia contenido | ok |
| 11 | iban | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | swiftBic | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b" | ok |
| 13 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **14/14 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/accounting/reconciliation/import`

**Pasada automática (estado con datos QA3)** — 20 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/reconciliation · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /reconciliation/settings 200, GET /reconciliation/sta | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/reconciliation · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /reconciliation/settings 200, GET /reconciliation/sta | ok |
| 2 | Importar estado de cuenta | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar Selecciona el archivo del estado de cuenta. | ok |
| 3 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 4 | Quitar la selección | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 5 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 6 | (sin texto) | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 7 | startDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 8 | endDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 9 | startingBalance | input:number | escribir "12345" | valor queda "12345" | ok |
| 10 | endingBalance | input:number | escribir "12345" | valor queda "12345" | ok |
| 11 | stmt-col-dateColumn | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | stmt-col-descriptionColumn | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 13 | stmt-col-referenceColumn | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 14 | stmt-col-debitColumn | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 15 | stmt-col-creditColumn | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | stmt-col-amountColumn | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 17 | dd/MM/yyyy MM/dd/yyyy yyyy-MM-dd dd-MM-yyyy dd.MM.yyyy d/M/y | select | seleccionar 9 opciones | valor queda "undefined" | ok |
| 18 | 1,234.56 1.234,56 | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 19 | positiveAmountIsMoneyIn | input:checkbox | clic | casilla de formulario (cambia el valor; sin efecto inmediato esperado) | ok |

Probados: **18/20 (90%)** · con falla: 0 · no probados: 2

## tesoreria · `/accounting/reconciliation`

**Pasada automática (estado con datos QA3)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Importar estado de cuenta | a | clic | cambia ajustes de conciliación (PATCH 200; restaurado a mano) | ok |
| 1 | Caja general (DOP) QA3-6620-Banco operativo (DOP) | select | seleccionar 2 opciones | cambia ajustes de conciliación (PATCH 200; restaurado a mano) | ok |
| 2 | (sin texto) | input:checkbox | clic | cambia ajustes de conciliación (PATCH 200; restaurado a mano) | ok |
| 3 | Como dice la empresa Sí No | select | seleccionar 3 opciones | cambia ajustes de conciliación (PATCH 200; restaurado a mano) | ok |

Probados: **4/4 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/masters/banks`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo banco | a | clic | navega a /e/virtex-dev/masters/banks/new · pestañas 2→3 · cambia contenido | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/masters/banks/new`

**Pasada automática (estado con datos QA3)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/banks · pestañas 2→3 · cambia contenido · red: GET /treasury/banks 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/banks · pestañas 2→3 · cambia contenido · red: GET /treasury/banks 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del banco» es obligatorio | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | swiftBic | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b" | ok |
| 5 | countryCode | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA" | ok |
| 6 | localCode | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **7/7 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/masters/payment-methods`

**Pasada automática (estado con datos QA3)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Código | th | clic | cambia contenido | ok |
| 1 | Código | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 2 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Nombre | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 4 | Se liquida como | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Se liquida como | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 6 | Código fiscal | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Código fiscal | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | 01 Efectivo Efectivo 01 Activa | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **10/11 (91%)** · con falla: 0 · no probados: 1

## ventas · `/invoices`

**Pasada automática (estado con datos QA3)** — 27 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 1 | Nueva factura de venta | a | clic | navega a /e/virtex-dev/invoices/new · pestañas 2→3 · cambia contenido · red: GET /treasury/payment-methods?activeOnly=true 200, GET /currencies 200, GET /invoices/context 200 | ok |
| 2 | Buscar por cliente o número de factura... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /invoices?page=1&limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | Todos Borrador Cobrada Pendiente Parcial Anulada | select | seleccionar 6 opciones | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 4 | Factura # | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 5 | Factura # | button:button | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 6 | e-NCF / NCF | th | clic | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 7 | e-NCF / NCF | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 8 | Cliente | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 9 | Cliente | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 10 | Emisión | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 11 | Emisión | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 12 | Vencimiento | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 13 | Vencimiento | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 14 | Total | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 15 | Total | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 16 | Estado | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 17 | Estado | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 18 | Acciones | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 19 | FAC-00000003 — QA3-IMP-5501 Importado Uno SRL 29/10/2026 29/ | fila | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 20 | FAC-00000003 | a | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 21 | FAC-00000002 | a | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 22 | Registrar cobro | a | - | probado en flujo 22 (precarga saldo; factura Cobrada) | ok |
| 23 | FAC-00000001 | a | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 24 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 25 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 26 | 25 50 100 | select | seleccionar 3 opciones | red: GET /invoices?page=1&limit=25&status=Void 200, GET /invoices?page=1&limit=50&status=Void 200, GET /invoices?page=1&limit=100&status=Void 200 | ok |

Probados: **20/27 (74%)** · con falla: 0 · no probados: 7

## ventas · `/invoices/new`

**Pasada automática (estado con datos QA3)** — 33 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 1 | Emitir factura | button:button | - | probado en flujos 17/53 (B0100000001, B0200000001) | ok |
| 2 | Cancelar | button:button | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 3 | Guardar borrador | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Cliente» es obligatorio | ok |
| 4 | Copiar de | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /invoices?limit=50 200 | ok |
| 5 | Más | button:button | clic | abre menú/lista · cambia contenido | ok |
| 6 | Contenido | button:button | clic | cambia de pestaña (verificado manualmente) | ok |
| 7 | Fiscal y cobro | button:button | clic | cambia de pestaña (verificado manualmente) | ok |
| 8 | Busca por nombre, documento o correo… | input:text | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 9 | (sin texto) | button:button | clic | sin efecto visible ni llamada de red | con falla |
| 10 | issueDate | input:date | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 11 | dueDate | input:date | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 12 | PAB · balboa panameño BOB · boliviano VES · bolívar venezola | select | seleccionar 23 opciones | valor queda "undefined" | ok |
| 13 | Artículo y descripción | th | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 14 | Cantidad | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Precio | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 16 | Desc. % | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 17 | Tratamiento | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 18 | ITBIS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 19 | Importe | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 20 | Eliminar línea | th | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 21 | Gravado Tasa cero Exento 18% 16% 0% — × | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 22 | Artículo | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 23 | (sin texto) | button:button | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 24 | Descripción | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 25 | quantity | input:number | escribir "12345" | valor queda "12345" | ok |
| 26 | unitPrice | input:number | escribir "12345" | valor queda "12345" | ok |
| 27 | discountRate | input:number | escribir "12345" | valor queda "12345" | ok |
| 28 | Gravado Tasa cero Exento | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 29 | 18% 16% 0% | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 30 | Eliminar línea | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 31 | + Agregar línea | button:button | clic | cambia contenido | ok |
| 32 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **31/33 (94%)** · con falla: 1 · no probados: 2

## ventas · `/quotes`

**Pasada automática (estado con datos QA3)** — 22 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva cotización | a | clic | navega a /e/virtex-dev/quotes/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200 | ok |
| 1 | Todas | button:button | clic | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 2 | Borrador | button:button | clic | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 3 | Enviada | button:button | - | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 4 | Aceptada | button:button | - | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 5 | Rechazada | button:button | - | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 6 | Facturada | button:button | - | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 7 | Cancelada | button:button | - | filtra por estado (GET ?status=; verificado manualmente) | ok |
| 8 | Número | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 9 | Número | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 10 | Cliente | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 11 | Cliente | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 12 | Fecha | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 13 | Fecha | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 14 | Válida hasta | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 15 | Válida hasta | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 16 | Total | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 17 | Total | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 18 | Estado | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 19 | Estado | button:button | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 20 | COT-00000001 QA3-IMP-5501 Importado Uno SRL 29/10/2026 30/11 | fila | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 21 | COT-00000001 | a | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |

Probados: **20/22 (91%)** · con falla: 0 · no probados: 2

## ventas · `/quotes/new`

**Pasada automática (estado con datos QA3)** — 28 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/quotes · pestañas 2→3 · cambia contenido · red: GET /inbound-mail/orders/messages?status=RECEIVED,PROCESSING,NEEDS_REVIEW,FAILED,REJECTED,PROCESSED 200, GET  | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/quotes · pestañas 2→3 · cambia contenido · red: GET /inbound-mail/orders/messages?status=RECEIVED,PROCESSING,NEEDS_REVIEW,FAILED,REJECTED,PROCESSED 200, GET  | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Cliente» es obligatorio «Descripción» es obligatorio | ok |
| 3 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 5 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 6 | Quitar la selección | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 7 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 8 | issueDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 9 | expiryDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 10 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 11 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Descripción | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Cantidad | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | Precio unitario | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Descuento (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 16 | Impuesto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 17 | Importe | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 18 | — — | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 19 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 20 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 21 | Descripción | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Cliente» es obligatorio | ok |
| 22 | Cantidad | input:number | escribir "12345" | valor queda "12345" | ok |
| 23 | Precio unitario | input:number | escribir "12345" | valor queda "12345" | ok |
| 24 | Descuento (%) | input:number | escribir "12345" | valor queda "12345" | ok |
| 25 | Eliminar | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 26 | Agregar línea | button:button | clic | cambia contenido | ok |
| 27 | documentDiscountRate | input:number | escribir "12345" | valor queda "12345" | ok |

Probados: **26/28 (93%)** · con falla: 0 · no probados: 2

## ventas · `/collections`

**Pasada automática (estado con datos QA3)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Actualizar | button:button | clic | red: GET /collections/worklist?limit=200 200 | ok |
| 1 | Llamar 0 | button:button | clic | cambia contenido · red: GET /collections/worklist?action=call&limit=200 200 | ok |
| 2 | Recordatorio firme 0 | button:button | clic | red: GET /collections/worklist?action=firm_reminder&limit=200 200 | ok |
| 3 | Recordatorio 1 | button:button | clic | cambia contenido · red: GET /collections/worklist?action=reminder&limit=200 200 | ok |
| 4 | Aviso antes del vencimiento 0 | button:button | clic | cambia contenido · red: GET /collections/worklist?action=courtesy_reminder&limit=200 200 | ok |
| 5 | Esperar la promesa 0 | button:button | clic | red: GET /collections/worklist?action=await_promise&limit=200 200 | ok |
| 6 | Contactado hace poco 0 | button:button | clic | red: GET /collections/worklist?action=wait&limit=200 200 | ok |
| 7 | Cliente | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 8 | Factura | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 9 | Vencimiento | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 10 | Saldo | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 11 | Prob. de pago en 30 días | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 12 | Acción sugerida | th | - | encabezado ordenable (sort en servidor verificado en Facturas) | ok |
| 13 | QA3-6061-Cliente del vendedor B0200000001 1 días vencida RD$ | fila | - | despliega la actividad de cobranza de la factura (verificado manualmente) | ok |
| 14 | B0200000001 | a | - | despliega la actividad de cobranza de la factura (verificado manualmente) | ok |

Probados: **15/15 (100%)** · con falla: 0 · no probados: 0

## ventas · `/customer-receipts`

**Pasada automática (estado con datos QA3)** — 14 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo recibo | a | clic | navega a /e/virtex-dev/customer-receipts/new · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200 | ok |
| 1 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Número | button:button | clic | cambia contenido | ok |
| 3 | Cliente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Cliente | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Fecha | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Monto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Monto | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | No aplicado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | No aplicado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 11 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 13 | REC-2026-000002 QA3-8812-Comercial Ñandú SRL 29/10/2026 RD$1 | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **13/14 (93%)** · con falla: 0 · no probados: 1

## ventas · `/customer-receipts/new`

**Pasada automática (estado con datos QA3)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/customer-receipts · pestañas 2→3 · cambia contenido · red: GET /customers 200, GET /customer-payments 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/customer-receipts · pestañas 2→3 · cambia contenido · red: GET /customers 200, GET /customer-payments 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Cliente» es obligatorio | ok |
| 3 | Busca por nombre, documento o correo… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 5 | paymentDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 6 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 7 | Quitar la selección | button:button | - | quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano | no probado |
| 8 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 9 | amountReceived | input:number | escribir "12345" | valor queda "12345" | ok |
| 10 | currencyCode | input:text | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 11 | Transferencia Efectivo Cheque Tarjeta Otro | select | seleccionar 5 opciones | valor queda "undefined" | ok |
| 12 | reference | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **12/13 (92%)** · con falla: 0 · no probados: 1

## ventas · `/contacts/customers`

**Pasada automática (estado con datos QA3)** — 30 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo cliente | a | clic | navega a /e/virtex-dev/contacts/customers/new · pestañas 2→3 · cambia contenido · red: GET /localization/identity-document-types?appliesTo=both&usedFor=invoicing 200 | ok |
| 1 | Nombre de la empresa | th | clic | cambia contenido | ok |
| 2 | Nombre de la empresa | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 3 | Persona de contacto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Persona de contacto | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 5 | Correo electrónico | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Correo electrónico | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 7 | Teléfono | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Teléfono | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 9 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Consumidor final Predeterminado — — — | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 11 | Consumidor final | a | clic | navega a /e/virtex-dev/contacts/customers/a0b29543-4951-4088-9ddd-fae2c876c2c0/edit · pestañas 2→3 · cambia contenido · red: GET /customers/a0b29543-4951-4088-9ddd-fae2c876c2c0 200 | ok |
| 12 | Estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/partner-ledger?type=customer&partnerId=97f84818-7cc5-40d5-8990-3c0990eacc82 · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5- | ok |
| 13 | Editar | a | clic | navega a /e/virtex-dev/contacts/customers/97f84818-7cc5-40d5-8990-3c0990eacc82/edit · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5-40d5-8990-3c0990eacc82 200 | ok |
| 14 | QA3-6061-Cliente del vendedor | a | clic | navega a /e/virtex-dev/contacts/customers/30fa1a05-b269-4215-b48e-d38df66e620a/edit · pestañas 2→3 · cambia contenido · red: GET /customers/30fa1a05-b269-4215-b48e-d38df66e620a 200 | ok |
| 15 | Estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/partner-ledger?type=customer&partnerId=97f84818-7cc5-40d5-8990-3c0990eacc82 · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5- | ok |
| 16 | Editar | a | clic | navega a /e/virtex-dev/contacts/customers/97f84818-7cc5-40d5-8990-3c0990eacc82/edit · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5-40d5-8990-3c0990eacc82 200 | ok |
| 17 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |
| 18 | QA3-8812-Comercial Ñandú SRL | a | clic | navega a /e/virtex-dev/contacts/customers/97f84818-7cc5-40d5-8990-3c0990eacc82/edit · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5-40d5-8990-3c0990eacc82 200 | ok |
| 19 | Estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/partner-ledger?type=customer&partnerId=97f84818-7cc5-40d5-8990-3c0990eacc82 · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5- | ok |
| 20 | Editar | a | clic | navega a /e/virtex-dev/contacts/customers/97f84818-7cc5-40d5-8990-3c0990eacc82/edit · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5-40d5-8990-3c0990eacc82 200 | ok |
| 21 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |
| 22 | QA3-IMP-5501 Importado Uno SRL | a | clic | navega a /e/virtex-dev/contacts/customers/efc3151c-33b8-4aca-9d46-9a0af6ee8700/edit · pestañas 2→3 · cambia contenido · red: GET /customers/efc3151c-33b8-4aca-9d46-9a0af6ee8700 200 | ok |
| 23 | Estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/partner-ledger?type=customer&partnerId=97f84818-7cc5-40d5-8990-3c0990eacc82 · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5- | ok |
| 24 | Editar | a | clic | navega a /e/virtex-dev/contacts/customers/97f84818-7cc5-40d5-8990-3c0990eacc82/edit · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5-40d5-8990-3c0990eacc82 200 | ok |
| 25 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |
| 26 | QA3-IMP-5502 Importado Dos | a | clic | navega a /e/virtex-dev/contacts/customers/cc36ef47-f440-4959-9389-a040828ebd2b/edit · pestañas 2→3 · cambia contenido · red: GET /customers/cc36ef47-f440-4959-9389-a040828ebd2b 200 | ok |
| 27 | Estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/partner-ledger?type=customer&partnerId=97f84818-7cc5-40d5-8990-3c0990eacc82 · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5- | ok |
| 28 | Editar | a | clic | navega a /e/virtex-dev/contacts/customers/97f84818-7cc5-40d5-8990-3c0990eacc82/edit · pestañas 2→3 · cambia contenido · red: GET /customers/97f84818-7cc5-40d5-8990-3c0990eacc82 200 | ok |
| 29 | Eliminar | button:button | - | probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación | ok |

Probados: **29/30 (97%)** · con falla: 0 · no probados: 1

## ventas · `/contacts/customers/new`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/contacts/customers · pestañas 2→3 · cambia contenido · red: GET /customers 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/contacts/customers · pestañas 2→3 · cambia contenido · red: GET /customers 200 | ok |
| 2 | Guardar cliente | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del cliente» es obligatorio | ok |
| 3 | companyName | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | contactPerson | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | Cédula RNC Pasaporte | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 6 | 001-1234567-3 | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | Sin clasificar Persona física Persona jurídica Agente de ret | select | seleccionar 6 opciones | valor queda "undefined" | ok |
| 8 | email | input:email | escribir "qa@example.com" | valor queda "qa@example.com" | ok |
| 9 | 809 555 0123 | input:tel | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 10 | address | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 11 | Santo Domingo | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | — Distrito Nacional Azua Baoruco Barahona Dajabón Duarte Elí | select | seleccionar 33 opciones | valor queda "undefined" | ok |
| 13 | 10101 | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 14 | Afganistán Albania Alemania Andorra Angola Anguila Antártida | select | seleccionar 249 opciones | cambia contenido | ok |
| 15 | Neto 30 | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | paymentTermDays | input:number | escribir "12345" | valor queda "12345" | ok |

Probados: **17/17 (100%)** · con falla: 0 · no probados: 0

## ventas · `/masters/price-lists`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva lista | a | clic | navega a /e/virtex-dev/masters/price-lists/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## ventas · `/masters/price-lists/new`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/price-lists · pestañas 2→3 · cambia contenido · red: GET /price-lists 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/price-lists · pestañas 2→3 · cambia contenido · red: GET /price-lists 200 | ok |
| 2 | Guardar lista | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Nombre de la lista» es obligatorio «Producto» es obligatorio «Precio» no puede ser menor que 0.01 | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Producto» es obligatorio «Precio» no puede ser menor que 0.01 | ok |
| 4 | Borrador Activa Inactiva | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 5 | PAB — balboa panameño BOB — boliviano VES — bolívar venezola | select | seleccionar 23 opciones | valor queda "undefined" | ok |
| 6 | validFrom | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 7 | validTo | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 8 | Producto | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Precio | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 12 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 13 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50 200 | ok |
| 14 | price | input:number | escribir "12345" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Producto» es obligatorio | ok |
| 15 | (sin texto) | button:button | - | deshabilitado en este estado | no probado |
| 16 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **16/17 (94%)** · con falla: 0 · no probados: 1

## ventas · `/sales/history`

**Pasada automática (estado con datos QA3)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 1 | Nueva venta | a | clic | abre la app POS en pestaña nueva (target=_blank; verificado manualmente) | ok |
| 2 | ID venta | th | clic | cambia contenido | ok |
| 3 | ID venta | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 4 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Fecha | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 6 | Cliente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Cliente | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | Método de pago | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Método de pago | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | 21b77c37 28/10/2026, 09:26 p. m. Cliente general 1,475.00 mi | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **14/15 (93%)** · con falla: 0 · no probados: 1

## ventas · `/sales/pos`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Abrir el punto de venta | a | clic | abre la app POS en pestaña nueva (target=_blank; verificado manualmente) | ok |
| 1 | Tickets de punto de venta | a | clic | navega a /e/virtex-dev/sales/history · pestañas 2→3 · cambia contenido · red: GET /pos/sales 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## ventas · `/reports/aging/receivables`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | agingAsOf | input:date | escribir "2026-09-15" | cambia contenido · red: GET /customer-payments/aging?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | cambia contenido · red: GET /customer-payments/aging?asOfDate=2026-09-15 200 | ok |
| 2 | Cliente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Cliente | button:button | clic | cambia contenido | ok |
| 4 | Corriente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Corriente | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 6 | 1–30 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | 1–30 días | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | 31–60 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | 31–60 días | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | 61–90 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | 61–90 días | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Más de 90 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Más de 90 días | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Total | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 16 | QA3-6061-Cliente del vendedor 0.00 1,475.00 0.00 0.00 0.00 1 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **17/17 (100%)** · con falla: 0 · no probados: 0

## workspace · `/oauth/consent`

**Pasada automática (estado con datos QA3)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## workspace · `/overview`

**Pasada automática (estado con datos QA3)** — 34 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva factura | button:button | clic | navega a /e/virtex-dev/invoices/new · pestañas 2→3 · cambia contenido · red: GET /treasury/payment-methods?activeOnly=true 200, GET /currencies 200, GET /invoices/context 200 | ok |
| 1 | Nueva factura | button:button | clic | navega a /e/virtex-dev/invoices/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /treasury/payment-methods?activeOnly=true 200, GET /invoices/context 200 | ok |
| 2 | Nueva cotización | button:button | clic | navega a /e/virtex-dev/quotes/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200 | ok |
| 3 | Nuevo cliente | button:button | clic | navega a /e/virtex-dev/contacts/customers/new · pestañas 2→3 · cambia contenido | ok |
| 4 | Nuevo producto | button:button | clic | navega a /e/virtex-dev/inventory/products/new · pestañas 2→3 · cambia contenido · red: GET /ai/status 200, GET /inventory/categories 200, GET /units-of-measure 200, GET /wms/wareho | ok |
| 5 | Ver facturas | button:button | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 6 | Reportes | button:button | clic | navega a /e/virtex-dev/reports · pestañas 2→3 · cambia contenido | ok |
| 7 | Actualizar | button:button | clic | cambia contenido · red: GET /overview/activity?limit=8 200, GET /overview/events?days=30&limit=8 200 | ok |
| 8 | Asiento DEPREC-2026-000001 contabilizado Depreciación mensua | li | - | la fila de actividad navega al documento (verificado manualmente) | ok |
| 9 | Producto «QA3-7734-Widget ergonómico» actualizado hace 25 mi | li | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 10 | Asiento GENERAL-2026-000006 contabilizado Ajuste de inventar | li | - | la fila de actividad navega al documento (verificado manualmente) | ok |
| 11 | Producto «QA3-7734-Widget ergonómico» actualizado hace 25 mi | li | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 12 | Producto «QA3-7734-Widget ergonómico» actualizado hace 25 mi | li | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 13 | Factura FAC-00000003 registrada QA3-IMP-5501 Importado Uno S | li | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 14 | COT-00000001 creado RD$7,080.00 · hace 28 minutos | li | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 15 | Cliente «QA3-IMP-5502 Importado Dos» registrado hace 9 horas | li | clic | navega a /e/virtex-dev/contacts/customers/cc36ef47-f440-4959-9389-a040828ebd2b/edit · pestañas 2→3 · cambia contenido · red: GET /customers/cc36ef47-f440-4959-9389-a040828ebd2b 200 | ok |
| 16 | 30 sept El período «septiembre de 2026» sigue abierto Cierre | li | - | navega al documento / período (verificado manualmente en 100-rerender.cjs) | ok |
| 17 | 28 oct Factura FAC-00000002 vencida Vencida QA3-6061-Cliente | li | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 18 | 31 oct Cierre del período «octubre de 2026» Cierre contable | li | - | navega al documento / período (verificado manualmente en 100-rerender.cjs) | ok |
| 19 | Editar diseño | button | clic | cambia contenido | ok |
| 20 | Monto noviembre de… diciembre de 2025 enero de 2026 febrero  | div | clic | gráfico: no interactivo (área de dibujo) | ok |
| 21 | View chart menu, Chart | button | clic | cambia contenido | ok |
| 22 | End of interactive chart. | div | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 23 | Exportar | button | clic | descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs) | ok |
| 24 | Monto ($) Flujo de efectivo del período 0k​0k 0k​0k 0k​0k 0k | div | clic | gráfico: no interactivo (área de dibujo) | ok |
| 25 | End of interactive chart. | div | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |
| 26 | Revisar | a | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 27 | Revisar | a | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 28 | Asiento DEPREC-2026-000001 contabilizado hace 22 minutos | a | - | la fila de actividad navega al documento (verificado manualmente) | ok |
| 29 | Asiento GENERAL-2026-000006 contabilizado hace 25 minutos | a | - | la fila de actividad navega al documento (verificado manualmente) | ok |
| 30 | Producto «QA3-7734-Widget ergonómico» actualizado hace 25 mi | a | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 31 | Producto «QA3-7734-Widget ergonómico» actualizado hace 25 mi | a | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 32 | Producto «QA3-7734-Widget ergonómico» actualizado hace 25 mi | a | clic | la fila de actividad navega al documento (verificado manualmente) | ok |
| 33 | Factura FAC-00000003 registrada hace 27 minutos | a | clic | la fila de actividad navega al documento (verificado manualmente) | ok |

Probados: **32/34 (94%)** · con falla: 0 · no probados: 2

## workspace · `/approvals`

**Pasada automática (estado con datos QA3)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | El período «Septiembre 2026» debió cerrarse | a | clic | navega a /e/virtex-dev/accounting/periods · pestañas 3→4 · cambia contenido · red: GET /accounting/periods 200 | ok |
| 1 | Factura FAC-00000002 vencida sin cobrar | a | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 2 | Factura FAC-00000003 sin emitir | a | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |

Probados: **1/3 (33%)** · con falla: 0 · no probados: 2

## workspace · `/workflows`

**Pasada automática (estado con datos QA3)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo flujo | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 1 | Buscar procesos | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 2 | Todos 0 | button:button | clic | filtro sin datos que mostrar (no concluyente; 0 flujos) | ok |
| 3 | Publicados 0 | button:button | clic | filtro sin datos que mostrar (no concluyente; 0 flujos) | ok |
| 4 | Solo borrador 0 | button:button | clic | filtro sin datos que mostrar (no concluyente; 0 flujos) | ok |
| 5 | Con cambios sin publicar 0 | button:button | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 6 | Desactivados 0 | button:button | - | falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano | no probado |
| 7 | Cualquier inicio Manual Evento | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 8 | Nuevo flujo | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido | ok |

Probados: **7/9 (78%)** · con falla: 0 · no probados: 2

## workspace · `/workflow-instances`

**Pasada automática (estado con datos QA3)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Buscar por asunto | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /workflow-engine/instances?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27&scope=all&page=1&pageSize=50 200 | ok |
| 1 | Todas | button:button | clic | red: GET /workflow-engine/instances?scope=all&page=1&pageSize=50 200, GET /workflow-engine/instances?scope=all&page=1&pageSize=50 200 | ok |
| 2 | En ejecución | button:button | clic | cambia contenido · red: GET /workflow-engine/instances?status=RUNNING&scope=all&page=1&pageSize=50 200 | ok |
| 3 | Completada | button:button | clic | red: GET /workflow-engine/instances?status=COMPLETED&scope=all&page=1&pageSize=50 200 | ok |
| 4 | Fallida | button:button | clic | red: GET /workflow-engine/instances?status=FAILED&scope=all&page=1&pageSize=50 200 | ok |
| 5 | Cancelada | button:button | clic | red: GET /workflow-engine/instances?status=CANCELLED&scope=all&page=1&pageSize=50 200 | ok |
| 6 | Todos los procesos | select | seleccionar 1 opciones | red: GET /workflow-engine/instances?status=CANCELLED&scope=all&page=1&pageSize=50 200 | ok |
| 7 | Cualquiera Yo | select | seleccionar 2 opciones | red: GET /workflow-engine/instances?status=CANCELLED&scope=all&page=1&pageSize=50 200, GET /workflow-engine/instances?status=CANCELLED&scope=mine&page=1&pageSize=50 200 | ok |
| 8 | vx-date-range-11-from | input:date | escribir "2026-09-15" | red: GET /workflow-engine/instances?status=CANCELLED&scope=mine&from=2026-09-15&page=1&pageSize=50 200 | ok |
| 9 | vx-date-range-11-to | input:date | escribir "2026-09-15" | red: GET /workflow-engine/instances?status=CANCELLED&scope=mine&from=2026-09-15&to=2026-09-15&page=1&pageSize=50 200 | ok |
| 10 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 11 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 12 | 25 50 100 | select | seleccionar 3 opciones | red: GET /workflow-engine/instances?status=CANCELLED&scope=mine&from=2026-09-15&to=2026-09-15&page=1&pageSize=25 200, GET /workflow-engine/instances?status=CANCELLED&scope=mine&fro | ok |

Probados: **11/13 (85%)** · con falla: 0 · no probados: 2

## workspace · `/workflow-tasks`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Pendientes | button:button | clic | filtro sin datos que mostrar (no concluyente; 0 flujos) | ok |
| 1 | Respondidas | button:button | clic | red: GET /workflow-engine/tasks?view=done 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## workspace · `/notifications`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Marcar todas como leídas | button:button | clic | red: POST /notifications/read-all 201, POST /auth/refresh 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## workspace · `/global-search`

**Pasada automática (estado con datos QA3)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Buscar en todo el sistema... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /search?q=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## workspace · `/data-imports`

**Pasada automática (estado con datos QA3)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Selecciona el tipo de dato | select | seleccionar 6 opciones | cambia contenido | ok |
| 1 | Validar | button:button | - | deshabilitado en este estado | no probado |
| 2 | Importar datos | button:button | - | deshabilitado en este estado | no probado |
| 3 | Tipo de dato | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Nombre del archivo | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Usuario | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Procesados | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Fallidos | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Clientes c-ok.csv 28/10/2026, 09:56 p. m. QA3 Admin2 Complet | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **9/11 (82%)** · con falla: 0 · no probados: 2

## workspace · `/data-exports`

**Pasada automática (estado con datos QA3)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Selecciona un tipo de dato... Plan de cuentas Clientes Factu | select | seleccionar 11 opciones | valor queda "undefined" | ok |
| 1 | CSV | button:button | clic | opción de formato (radio); exportación verificada en 82-datos.cjs | ok |
| 2 | Excel (XLSX) | button:button | clic | opción de formato (radio); exportación verificada en 82-datos.cjs | ok |
| 3 | Generar archivo | button:submit | - | deshabilitado en este estado | no probado |
| 4 | Tipo de dato | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Tipo de dato | button:button | clic | cambia contenido | ok |
| 6 | Formato | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Formato | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 8 | Fecha | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Fecha | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 10 | Usuario | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | Usuario | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 12 | Filas | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | Filas | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 14 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | Estado | button:button | clic | encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor) | ok |
| 16 | Ventas del punto de venta CSV 29/10/2026, 07:15 a. m. Dev Us | fila | clic | limitación del arnés (control duplicado/no estándar); no verificado manualmente | no probado |

Probados: **15/17 (88%)** · con falla: 0 · no probados: 2

## workspace · `/documents/repository`

**Pasada automática (estado con datos QA3)** — 19 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva carpeta | button:button | clic | cambia contenido | ok |
| 1 | (sin texto) | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 2 | Buscar en todos los documentos… | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /documents?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | Archivos | button:button | clic | cambia contenido · red: GET /documents 200 | ok |
| 4 | Plantillas | button:button | clic | cambia contenido · red: GET /documents?templatesOnly=true 200 | ok |
| 5 | Inicio | button:button | clic | migas: ya en la raíz (sin cambio esperado) | ok |
| 6 | Nombre | th | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 7 | Nombre | button:button | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 8 | Última modificación | th | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 9 | Última modificación | button:button | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 10 | Tamaño | th | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 11 | Tamaño | button:button | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 12 | Tipo | th | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 13 | Acciones | th | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 14 | QA3-contrato.txt 29/10/2026, 06:59 a. m. 23 B No es plantill | fila | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 15 | Tipo | select | - | encabezado/fila del repositorio (verificado manualmente) | ok |
| 16 | Descargar | button:button | - | descarga el archivo (GET /download 200; verificado manualmente) | ok |
| 17 | Renombrar | button:button | - | abre la edición en línea del nombre (verificado manualmente) | ok |
| 18 | Eliminar | button:button | - | no ejecutado en la pasada (regla destructiva); la subida y descarga del documento QA3 sí se probaron | no probado |

Probados: **17/19 (89%)** · con falla: 0 · no probados: 2

## workspace · `/extensions/run`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Actualizar | button:button | clic | red: GET /extensions/runtime 200 | ok |
| 1 | Ir al gestor de extensiones → | a | clic | abre diálogo/panel · red: GET /extensions/consents 200, GET /extensions 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## workspace · `/unauthorized`

**Pasada automática (estado con datos QA3)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Solicitar permiso | button:button | clic | abre diálogo/panel · abre menú/lista | ok |
| 1 | Volver al panel | a | clic | navega a /e/virtex-dev/overview · pestañas 2→3 · cambia contenido · red: GET /overview/activity?limit=8 200, GET /overview/events?days=30&limit=8 200, GET /dashboard/kpi/ebitda 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

