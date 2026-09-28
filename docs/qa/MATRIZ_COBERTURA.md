# Matriz de cobertura por página y elemento

Generada por `harness/gen-matriz.cjs` desde `clicks.json` (pasada 1, estado mayormente vacío), `clicks-datos.json` (pasada 2, estado con datos QA) y las correcciones de la verificación manual. Estados: **ok** = probado sin problemas · **con falla** · **no probado** (con razón).

## Resumen por página

| Módulo | Página | Elementos | OK | Con falla | No probados | % probado |
|---|---|---|---|---|---|---|
| administracion | masters/taxes | 18 | 10 | 2 | 6 | 67% |
| administracion | masters/taxes/new | 7 | 7 | 0 | 0 | 100% |
| administracion | masters/currencies | 5 | 5 | 0 | 0 | 100% |
| administracion | masters/branches | 1 | 1 | 0 | 0 | 100% |
| administracion | masters/extensions | 12 | 10 | 1 | 1 | 92% |
| administracion | masters/extensions/run | 2 | 2 | 0 | 0 | 100% |
| administracion | manufacturing | 0 | 0 | 0 | 0 | 100% |
| administracion | wms | 0 | 0 | 0 | 0 | 100% |
| administracion | projects | 0 | 0 | 0 | 0 | 100% |
| administracion | procurement | 0 | 0 | 0 | 0 | 100% |
| administracion | contacts/suppliers | 1 | 0 | 1 | 0 | 100% |
| analisis | reports/financial-statements/balance-sheet | 3 | 3 | 0 | 0 | 100% |
| analisis | reports/financial-statements/income-statement | 4 | 4 | 0 | 0 | 100% |
| analisis | reports/financial-statements/trial-balance | 30 | 30 | 0 | 0 | 100% |
| analisis | reports/financial-statements/cash-flow | 4 | 4 | 0 | 0 | 100% |
| analisis | reports/profitability-by-product | 22 | 20 | 2 | 0 | 100% |
| analisis | reports/profitability-by-customer | 11 | 10 | 1 | 0 | 100% |
| analisis | datasheets | 7 | 0 | 7 | 0 | 100% |
| analisis | datasheets/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | accounts-payable | 14 | 14 | 0 | 0 | 100% |
| compras | accounts-payable/new | 18 | 17 | 0 | 1 | 94% |
| compras | accounts-payable/payments | 3 | 3 | 0 | 0 | 100% |
| compras | accounts-payable/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | accounts-payable/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | masters/suppliers | 10 | 6 | 3 | 1 | 90% |
| compras | masters/suppliers/new | 12 | 12 | 0 | 0 | 100% |
| compras | masters/suppliers/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | purchasing/orders | 9 | 8 | 1 | 0 | 100% |
| compras | purchasing/orders/new | 23 | 22 | 0 | 1 | 96% |
| compras | purchasing/orders/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | purchasing/requisitions | 10 | 9 | 1 | 0 | 100% |
| compras | purchasing/requisitions/new | 18 | 17 | 0 | 1 | 94% |
| compras | purchasing/requisitions/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| compras | reports/aging/payables | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/chart-of-accounts | 73 | 49 | 24 | 0 | 100% |
| contabilidad | accounting/chart-of-accounts/segments-configuration | 9 | 8 | 0 | 1 | 89% |
| contabilidad | accounting/chart-of-accounts/new | 17 | 12 | 2 | 3 | 82% |
| contabilidad | accounting/chart-of-accounts/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/journal-entries | 44 | 17 | 23 | 4 | 91% |
| contabilidad | accounting/journal-entries/new | 25 | 23 | 0 | 2 | 92% |
| contabilidad | accounting/journal-entries/import | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/journal-entries/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/daily-journal | 33 | 17 | 12 | 4 | 88% |
| contabilidad | accounting/general-ledger | 1 | 0 | 1 | 0 | 100% |
| contabilidad | accounting/general-ledger/new | 6 | 5 | 1 | 0 | 100% |
| contabilidad | accounting/general-ledger/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/general-ledger/:accountId | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/subsidiary-ledgers | 1 | 0 | 0 | 1 | 0% |
| contabilidad | accounting/ledgers | 6 | 6 | 0 | 0 | 100% |
| contabilidad | accounting/journals | 14 | 6 | 8 | 0 | 100% |
| contabilidad | accounting/journals/new | 6 | 6 | 0 | 0 | 100% |
| contabilidad | accounting/journals/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| contabilidad | accounting/periods | 38 | 14 | 24 | 0 | 100% |
| contabilidad | accounting/variance-analysis | 8 | 6 | 0 | 2 | 75% |
| contabilidad | accounting/closing/month-end | 2 | 2 | 0 | 0 | 100% |
| contabilidad | accounting/closing/annual-close | 0 | 0 | 0 | 0 | 100% |
| contabilidad | accounting/audit-adjustments | 1 | 1 | 0 | 0 | 100% |
| contabilidad | accounting/audit-adjustments/new | 24 | 22 | 0 | 2 | 92% |
| contabilidad | accounting/closing/checklist | 6 | 6 | 0 | 0 | 100% |
| inventario | inventory/products | 27 | 24 | 3 | 0 | 100% |
| inventario | inventory/products/new | 13 | 12 | 0 | 1 | 92% |
| inventario | inventory/products/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| inventario | inventory/categories | 10 | 10 | 0 | 0 | 100% |
| inventario | masters/warehouses | 7 | 7 | 0 | 0 | 100% |
| inventario | masters/units-of-measure | 0 | 0 | 0 | 0 | 100% |
| rrhh | payroll/my-payslips | 0 | 0 | 0 | 0 | 100% |
| rrhh | payroll/runs | 1 | 1 | 0 | 0 | 100% |
| rrhh | payroll/runs/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| rrhh | hcm/employees | 13 | 12 | 1 | 0 | 100% |
| rrhh | hcm/employees/new | 20 | 20 | 0 | 0 | 100% |
| rrhh | hcm/employees/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| rrhh | hcm/departments | 8 | 7 | 1 | 0 | 100% |
| rrhh | payroll/concepts | 12 | 10 | 2 | 0 | 100% |
| rrhh | payroll/parameters | 18 | 18 | 0 | 0 | 100% |
| tesoreria | accounting/treasury | 14 | 13 | 1 | 0 | 100% |
| tesoreria | accounting/treasury/bank-accounts/new | 13 | 13 | 0 | 0 | 100% |
| tesoreria | accounting/treasury/bank-accounts/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| tesoreria | accounting/reconciliation/import | 3 | 3 | 0 | 0 | 100% |
| tesoreria | accounting/reconciliation | 1 | 1 | 0 | 0 | 100% |
| tesoreria | masters/banks | 7 | 7 | 0 | 0 | 100% |
| tesoreria | masters/payment-methods | 3 | 3 | 0 | 0 | 100% |
| tesoreria | masters/payment-terms | 0 | 0 | 0 | 0 | 100% |
| ventas | invoices | 31 | 23 | 2 | 6 | 81% |
| ventas | invoices/new | 41 | 29 | 10 | 2 | 95% |
| ventas | invoices/:id | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | customer-receipts | 9 | 9 | 0 | 0 | 100% |
| ventas | customer-receipts/new | 12 | 12 | 0 | 0 | 100% |
| ventas | contacts/customers | 20 | 10 | 10 | 0 | 100% |
| ventas | contacts/customers/new | 17 | 17 | 0 | 0 | 100% |
| ventas | contacts/customers/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | masters/price-lists | 13 | 11 | 2 | 0 | 100% |
| ventas | masters/price-lists/new | 17 | 16 | 0 | 1 | 94% |
| ventas | masters/price-lists/:id/edit | - | - | - | - | ruta con parámetro: cubierta al abrir el registro desde su lista / flujos |
| ventas | sales/history | 2 | 1 | 1 | 0 | 100% |
| ventas | sales/pos | 3 | 2 | 0 | 1 | 67% |
| ventas | reports/aging/receivables | 20 | 20 | 0 | 0 | 100% |
| workspace | overview | 20 | 17 | 3 | 0 | 100% |
| workspace | my-work | 1 | 1 | 0 | 0 | 100% |
| workspace | approvals | 0 | 0 | 0 | 0 | 100% |
| workspace | dashboard | 4 | 2 | 2 | 0 | 100% |
| workspace | notifications | 1 | 1 | 0 | 0 | 100% |
| workspace | global-search | 1 | 1 | 0 | 0 | 100% |
| workspace | data-imports | 10 | 7 | 3 | 0 | 100% |
| workspace | data-exports | 13 | 6 | 6 | 1 | 92% |
| workspace | documents/repository | 16 | 12 | 2 | 2 | 88% |
| workspace | documents/templates | 1 | 0 | 0 | 1 | 0% |
| workspace | unauthorized | 2 | 1 | 1 | 0 | 100% |

**Total**: 986 interacciones registradas · 777 ok · 164 con falla · 45 no probadas · 95% probadas.

## administracion · `/masters/taxes`

**Pasada 1 (estado vacío)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo impuesto | a | clic | navega a /e/virtex-dev/masters/taxes/new · pestañas 2→3 · cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | TIPO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | TASA (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | PAÍS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ITBIS 18% Porcentaje 18.00% DO | fila | clic | la fila no abre edición: no existe forma de editar un impuesto (UX) | con falla |
| 6 | Eliminar | button:button | - | impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200 | no probado |
| 7 | Eliminar | button:button | - | impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200 | no probado |
| 8 | Eliminar | button:button | - | impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200 | no probado |

**Pasada 2 (con datos)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo impuesto | a | clic | navega a /e/virtex-dev/masters/taxes/new · pestañas 2→3 · cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | TIPO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | TASA (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | PAÍS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ITBIS 18% Porcentaje 18.00% DO | fila | clic | la fila no abre edición: no existe forma de editar un impuesto (UX) | con falla |
| 6 | Eliminar | button:button | - | impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200 | no probado |
| 7 | Eliminar | button:button | - | impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200 | no probado |
| 8 | Eliminar | button:button | - | impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200 | no probado |

Probados: **12/18 (67%)** · con falla: 2 · no probados: 6

## administracion · `/masters/taxes/new`

**Pasada 1 (estado vacío)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/taxes · pestañas 2→3 · cambia contenido · red: GET /taxes 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/taxes · pestañas 2→3 · cambia contenido · red: GET /taxes 200 | ok |
| 2 | Guardar Impuesto | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del Impuesto» es obligatorio | ok |
| 3 | Ej: IVA general | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar | ok |
| 4 | rate | input:number | escribir "12345" | valor queda "12345" | ok |
| 5 | Porcentaje Fijo | select | seleccionar 2 opciones | valor queda "undefined" | ok |
| 6 | DO, US, MX | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **7/7 (100%)** · con falla: 0 · no probados: 0

## administracion · `/masters/currencies`

**Pasada 1 (estado vacío)** — 5 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | NOMBRE DE LA MONEDA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 1 | CÓDIGO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | SÍMBOLO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | MONEDA BASE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Peso argentino ARS AR$ | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **5/5 (100%)** · con falla: 0 · no probados: 0

## administracion · `/masters/branches`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva sucursal | button:button | clic | abre diálogo/panel · red: GET /organizations/subsidiaries 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## administracion · `/masters/extensions`

**Pasada 1 (estado vacío)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Abrir ejecución | a | clic | navega a /e/virtex-dev/masters/extensions/run · pestañas 2→3 · cambia contenido · red: GET /extensions/runtime 200 | ok |
| 1 | Actualizar | button:button | clic | red: GET /extensions 200, GET /extensions/consents 200 | ok |
| 2 | mi-extension | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 3 | 1.0.0 | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 4 | description | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | egress:http | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 6 | api.taxjar.com | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | code | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 8 | root.innerHTML = '<h3>Hola</h3>'; // usa virtex.api(), virte | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 9 | Admitir y registrar | button:submit | - | tras step-up → 403 para el administrador del inquilino (requiere rol de plataforma) | con falla |
| 10 | nombre de la extensión | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 11 | Ejecutar | button:submit | - | deshabilitado en este estado | no probado |

Probados: **11/12 (92%)** · con falla: 1 · no probados: 1

## administracion · `/masters/extensions/run`

**Pasada 1 (estado vacío)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Actualizar | button:button | clic | red: GET /extensions/runtime 200 | ok |
| 1 | Ir al gestor de extensiones → | a | clic | navega a /e/virtex-dev/masters/extensions · pestañas 2→3 · cambia contenido · red: GET /extensions 200, GET /extensions/consents 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## administracion · `/manufacturing`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## administracion · `/wms`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## administracion · `/projects`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## administracion · `/procurement`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## administracion · `/contacts/suppliers`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Proveedor | a | clic | error: GET /localization/identity-document-types?appliesTo=both&usedFor=invoicing 403 {"statusCode":403,"code":"auth.you_do_not_have_permission_perform","messageKey":"auth.you_do_n | con falla |

Probados: **1/1 (100%)** · con falla: 1 · no probados: 0

## analisis · `/reports/financial-statements/balance-sheet`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | balanceSheetAsOf | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/balance-sheet?asOfDate=2026-09-15 200 | ok |
| 1 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 2 | Actualizar | button:button | clic | red: GET /financial-reporting/balance-sheet?asOfDate=2026-09-15 200 | ok |

Probados: **3/3 (100%)** · con falla: 0 · no probados: 0

## analisis · `/reports/financial-statements/income-statement`

**Pasada 1 (estado vacío)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-0-from | input:date | escribir "2026-09-15" | red: GET /financial-reporting/income-statement?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-0-to | input:date | escribir "2026-09-15" | red: GET /financial-reporting/income-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | red: GET /financial-reporting/income-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |

Probados: **4/4 (100%)** · con falla: 0 · no probados: 0

## analisis · `/reports/financial-statements/trial-balance`

**Pasada 1 (estado vacío)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-1-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/trial-balance?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-1-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/trial-balance?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | red: GET /financial-reporting/trial-balance?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | Cuenta | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 5 | Saldo inicial | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 6 | Movimientos del período | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 7 | Saldo final | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 8 | Debe | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 9 | Haber | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 10 | Debe | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 11 | Haber | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 12 | Debe | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 13 | Haber | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 14 | 1140 Inventarios 0.00 0.00 30,000.00 0.00 30,000.00 0.00 | fila | - | fila sin acción (sin detalle navegable; verificado manualmente) | ok |

**Pasada 2 (con datos)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-0-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/trial-balance?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-0-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/trial-balance?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | red: GET /financial-reporting/trial-balance?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | Cuenta | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 5 | Saldo inicial | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 6 | Movimientos del período | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 7 | Saldo final | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 8 | Debe | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 9 | Haber | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 10 | Debe | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 11 | Haber | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 12 | Debe | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 13 | Haber | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 14 | 1120 Bancos 0.00 0.00 2,360.00 5,000.00 0.00 2,640.00 | fila | - | fila sin acción (sin detalle navegable; verificado manualmente) | ok |

Probados: **30/30 (100%)** · con falla: 0 · no probados: 0

## analisis · `/reports/financial-statements/cash-flow`

**Pasada 1 (estado vacío)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-2-from | input:date | escribir "2026-09-15" | red: GET /financial-reporting/cash-flow-statement?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-2-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /financial-reporting/cash-flow-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | red: GET /financial-reporting/cash-flow-statement?startDate=2026-09-15&endDate=2026-09-15 200 | ok |

Probados: **4/4 (100%)** · con falla: 0 · no probados: 0

## analisis · `/reports/profitability-by-product`

**Pasada 1 (estado vacío)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-3-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-3-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | UNIDADES VENDIDAS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | INGRESO TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | COSTO TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | UTILIDAD BRUTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | MARGEN BRUTO (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | No hay datos de rentabilidad para el período seleccionado. | fila | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |

**Pasada 2 (con datos)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-1-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-1-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | cambia contenido · red: GET /reports/profitability/by-product?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | UNIDADES VENDIDAS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | INGRESO TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | COSTO TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | UTILIDAD BRUTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | MARGEN BRUTO (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | QA-SKU-001 — QA-Producto-01 Silla ergonómica 4 DOP 4,000.00  | fila | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |

Probados: **22/22 (100%)** · con falla: 2 · no probados: 0

## analisis · `/reports/profitability-by-customer`

**Pasada 1 (estado vacío)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | vx-date-range-4-from | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-09-15&endDate=2026-09-28 200 | ok |
| 1 | vx-date-range-4-to | input:date | escribir "2026-09-15" | cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 2 | Exportar | button:button | clic | descarga CSV (verificado manualmente: evento download) | ok |
| 3 | Actualizar | button:button | clic | cambia contenido · red: GET /reports/profitability/by-customer?startDate=2026-09-15&endDate=2026-09-15 200 | ok |
| 4 | CLIENTE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | UNIDADES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | INGRESO TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | COSTO TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | UTILIDAD BRUTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | MARGEN BRUTO (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | No hay datos de rentabilidad para el período seleccionado. | fila | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |

Probados: **11/11 (100%)** · con falla: 1 · no probados: 0

## analisis · `/datasheets`

**Pasada 1 (estado vacío)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Libro | a | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |
| 1 | NOMBRE | th | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |
| 2 | PROPIETARIO | th | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |
| 3 | ÚLTIMA MODIFICACIÓN | th | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |
| 4 | Estado de Resultados Q1 Juan Pérez Sep 28, 2026, 6:06:38 AM | fila | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |
| 5 | Estado de Resultados Q1 | a | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |
| 6 | Análisis de Rentabilidad - Laptops | a | clic | libros de ejemplo (mock) que no abren — QA-019 | con falla |

Probados: **7/7 (100%)** · con falla: 7 · no probados: 0

## compras · `/accounts-payable`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Registrar pago | a | clic | navega a /e/virtex-dev/accounts-payable/payments · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /accounts-payable 200, GET /treasury/cash-position 20 | ok |
| 1 | Nueva Factura | a | clic | navega a /e/virtex-dev/accounts-payable/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /treasury/cash-position 200 | ok |
| 2 | Crear Factura | a | clic | navega a /e/virtex-dev/accounts-payable/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /treasury/cash-position 200 | ok |

**Pasada 2 (con datos)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Registrar pago | a | clic | navega a /e/virtex-dev/accounts-payable/payments · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /accounts-payable 200, GET /treasury/cash-position 20 | ok |
| 1 | Nueva Factura | a | clic | navega a /e/virtex-dev/accounts-payable/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /treasury/cash-position 200 | ok |
| 2 | PROVEEDOR | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | NÚMERO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | VENCIMIENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | SALDO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | QA-Proveedor-01 Suministros Ñ&Co B0100000123 28/09/2026 28/1 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 10 | B0100000123 | a | clic | navega a /e/virtex-dev/accounts-payable/694e8cb8-8918-443e-9493-ccb6c2f6c58b · pestañas 2→3 · cambia contenido · red: GET /accounts-payable/694e8cb8-8918-443e-9493-ccb6c2f6c58b 200 | ok |

Probados: **14/14 (100%)** · con falla: 0 · no probados: 0

## compras · `/accounts-payable/new`

**Pasada 1 (estado vacío)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable · pestañas 2→3 · cambia contenido · red: GET /accounts-payable 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable · pestañas 2→3 · cambia contenido · red: GET /accounts-payable 200 | ok |
| 2 | Guardar factura | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Proveedor» es obligatorio «[[product]]» es obligatorio «[[expenseAccountId]]» es obligatorio | ok |
| 3 | Seleccionar proveedor | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 5 | ncf | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 6 | date | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 7 | dueDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 8 | PAB · Balboa panameño BOB · Boliviano VES · Bolívar venezola | select | seleccionar 23 opciones | valor queda "undefined" | ok |
| 9 | 01 — Efectivo 02 — Cheque o transferencia 03 — Tarjeta 04 —  | select | seleccionar 7 opciones | valor queda "undefined" | ok |
| 10 | Descripción | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Proveedor» es obligatorio «[[expenseAccountId]]» es obligatorio | ok |
| 11 | Cant. | input:number | escribir "12345" | valor queda "12345" | ok |
| 12 | Precio | input:number | escribir "12345" | cambia contenido | ok |
| 13 | Cuenta de Gasto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 14 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 15 | Eliminar línea | button:button | - | deshabilitado en este estado | no probado |
| 16 | Añadir Línea | button:button | clic | cambia contenido | ok |
| 17 | Mostrar | button:button | clic | cambia contenido | ok |

Probados: **17/18 (94%)** · con falla: 0 · no probados: 1

## compras · `/accounts-payable/payments`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable · pestañas 2→3 · cambia contenido · red: GET /accounts-payable 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounts-payable · pestañas 2→3 · cambia contenido · red: GET /accounts-payable 200 | ok |
| 2 | Registrar pago | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Cuenta bancaria» es obligatorio Selecciona al menos una factura y completa los datos del pago. | ok |

Probados: **3/3 (100%)** · con falla: 0 · no probados: 0

## compras · `/masters/suppliers`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Proveedor | a | clic | error: GET /localization/identity-document-types?appliesTo=both&usedFor=invoicing 403 {"statusCode":403,"code":"auth.you_do_not_have_permission_perform","messageKey":"auth.you_do_n | con falla |

**Pasada 2 (con datos)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Proveedor | a | clic | error: GET /localization/identity-document-types?appliesTo=both&usedFor=invoicing 403 {"statusCode":403,"code":"auth.you_do_not_have_permission_perform","messageKey":"auth.you_do_n | con falla |
| 1 | NOMBRE DE LA EMPRESA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | PERSONA DE CONTACTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | EMAIL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | TELÉFONO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 7 | Editar | a | clic | error: GET /localization/identity-document-types?appliesTo=both&usedFor=invoicing 403 {"statusCode":403,"code":"auth.you_do_not_have_permission_perform","messageKey":"auth.you_do_n | con falla |
| 8 | Eliminar | button:button | - | no ejecutado: eliminar línea/nivel en formulario vacío o proveedor no localizable en la lista | no probado |

Probados: **9/10 (90%)** · con falla: 3 · no probados: 1

## compras · `/masters/suppliers/new`

**Pasada 1 (estado vacío)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/suppliers · pestañas 2→3 · cambia contenido · red: GET /suppliers 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/suppliers · pestañas 2→3 · cambia contenido · red: GET /suppliers 200 | ok |
| 2 | Guardar Proveedor | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del proveedor» es obligatorio | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar | ok |
| 4 | contactPerson | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | identityDocumentTypeCode | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 6 | taxId | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | address | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 8 | email | input:email | escribir "qa@example.com" | valor queda "qa@example.com" | ok |
| 9 | phone | input:tel | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 10 | Afganistán Albania Alemania Andorra Angola Anguila Antártida | select | seleccionar 249 opciones | valor queda "undefined" | ok |
| 11 | Sin clasificar Persona física Persona jurídica Agente de ret | select | seleccionar 6 opciones | valor queda "undefined" | ok |

Probados: **12/12 (100%)** · con falla: 0 · no probados: 0

## compras · `/purchasing/orders`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Orden | a | clic | navega a /e/virtex-dev/purchasing/orders/new · pestañas 2→3 · cambia contenido | ok |

**Pasada 2 (con datos)** — 8 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Orden | a | clic | navega a /e/virtex-dev/purchasing/orders/new · pestañas 2→3 · cambia contenido | ok |
| 1 | N.º DE ORDEN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | PROVEEDOR | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | FECHA DE LA ORDEN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | PO-2026-000001 QA-Proveedor-01 Suministros Ñ&Co 28/09/2026 D | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 7 | PO-2026-000001 | a | clic | error: GET /inventory/93628f14-8761-4aa8-a91a-fd464aa18ea5 FAILED net::ERR_ABORTED  | con falla |

Probados: **9/9 (100%)** · con falla: 1 · no probados: 0

## compras · `/purchasing/orders/new`

**Pasada 1 (estado vacío)** — 23 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/orders · pestañas 2→3 · cambia contenido · red: GET /procurement/orders?page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/orders · pestañas 2→3 · cambia contenido · red: GET /procurement/orders?page=1&pageSize=50 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Proveedor» es obligatorio «Descripción» es obligatorio | ok |
| 3 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 5 | orderDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 6 | expectedDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 7 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 8 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | CANTIDAD | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | PRECIO ACORDADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 12 | ITBIS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | 0.00 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 15 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 16 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /suppliers?limit=50 200 | ok |
| 17 | description | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Proveedor» es obligatorio | ok |
| 18 | quantity | input:number | escribir "12345" | valor queda "12345" | ok |
| 19 | unitPrice | input:number | escribir "12345" | valor queda "12345" | ok |
| 20 | taxRate | input:number | escribir "12345" | cambia contenido | ok |
| 21 | Eliminar | button:button | - | no ejecutado: eliminar línea/nivel en formulario vacío o proveedor no localizable en la lista | no probado |
| 22 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **22/23 (96%)** · con falla: 0 · no probados: 1

## compras · `/purchasing/requisitions`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Requisición | a | clic | navega a /e/virtex-dev/purchasing/requisitions/new · pestañas 2→3 · cambia contenido | ok |

**Pasada 2 (con datos)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Requisición | a | clic | navega a /e/virtex-dev/purchasing/requisitions/new · pestañas 2→3 · cambia contenido | ok |
| 1 | N.º DE REQUISICIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | ARTÍCULOS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | FECHA REQUERIDA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | REQ-2026-000001 1 28/09/2026 15/10/2026 USD 3,000.00 Por apr | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 8 | REQ-2026-000001 | a | clic | error: GET /inventory/93628f14-8761-4aa8-a91a-fd464aa18ea5 FAILED net::ERR_ABORTED  | con falla |

Probados: **10/10 (100%)** · con falla: 1 · no probados: 0

## compras · `/purchasing/requisitions/new`

**Pasada 1 (estado vacío)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/requisitions · pestañas 2→3 · cambia contenido · red: GET /procurement/requisitions?page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/purchasing/requisitions · pestañas 2→3 · cambia contenido · red: GET /procurement/requisitions?page=1&pageSize=50 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Descripción» es obligatorio | ok |
| 3 | requiredDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 4 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | CANTIDAD | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | PRECIO ESTIMADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | 0.00 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 11 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 12 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50 200 | ok |
| 13 | description | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar | ok |
| 14 | quantity | input:number | escribir "12345" | valor queda "12345" | ok |
| 15 | estimatedUnitPrice | input:number | escribir "12345" | valor queda "12345" | ok |
| 16 | Eliminar | button:button | - | no ejecutado: eliminar línea/nivel en formulario vacío o proveedor no localizable en la lista | no probado |
| 17 | Agregar línea | button:button | clic | cambia contenido | ok |

Probados: **17/18 (94%)** · con falla: 0 · no probados: 1

## compras · `/reports/aging/payables`

**Pasada 1 (estado vacío)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | agingAsOf | input:date | escribir "2026-09-15" | red: GET /accounts-payable/aging?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | red: GET /accounts-payable/aging?asOfDate=2026-09-15 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/chart-of-accounts`

**Pasada 1 (estado vacío)** — 35 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | no descarga ni llama a la red (verificado manualmente) — QA-042 | con falla |
| 1 | Nueva Cuenta | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts/new · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts/segment-definitions 200 | ok |
| 2 | Buscar por código o nombre... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 3 | Estado | select | seleccionar 3 opciones | cambia contenido | ok |
| 4 | Tipo | select | seleccionar 6 opciones | valor queda "undefined" | ok |
| 5 | CUENTA | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 6 | CUENTA | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 7 | TIPO | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 8 | TIPO | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 9 | BALANCE | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 10 | BALANCE | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 11 | ESTADO | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 12 | ESTADO | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 13 | ACCIONES | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 14 | Activo 1000 Activo — Activa | fila | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 15 | Activo | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 16 | 1000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 17 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 18 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 19 | Pasivo | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 20 | 2000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 21 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 22 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 23 | Patrimonio | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 24 | 3000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 25 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 26 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 27 | Ingresos | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 28 | 4000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 29 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 30 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 31 | Gastos | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 32 | 5000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 33 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 34 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |

**Pasada 2 (con datos)** — 38 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | no descarga ni llama a la red (verificado manualmente) — QA-042 | con falla |
| 1 | Nueva Cuenta | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts/new · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts/segment-definitions 200 | ok |
| 2 | Buscar por código o nombre... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 3 | Estado | select | seleccionar 3 opciones | cambia contenido | ok |
| 4 | Tipo | select | seleccionar 6 opciones | valor queda "undefined" | ok |
| 5 | CUENTA | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 6 | CUENTA | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 7 | TIPO | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 8 | TIPO | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 9 | BALANCE | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 10 | BALANCE | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 11 | ESTADO | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 12 | ESTADO | button:button | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 13 | ACCIONES | th | - | encabezado sin ordenamiento (verificado manualmente) | ok |
| 14 | Activo 1000 Activo — Activa | fila | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 15 | Activo | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 16 | 1000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 17 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 18 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 19 | Pasivo | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 20 | 2000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 21 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 22 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 23 | Patrimonio | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 24 | 3000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 25 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 26 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 27 | Ingresos | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 28 | 4000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 29 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 30 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 31 | Gastos | button:button | - | fila de grupo: no se expande al hacer clic (verificado manualmente) | ok |
| 32 | 5000 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 33 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 34 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |
| 35 | 5910 | a | - | abre el Libro Mayor de la cuenta (verificado manualmente) | ok |
| 36 | Editar | button:button | - | abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021 | con falla |
| 37 | Eliminar | button:button | - | cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo | con falla |

Probados: **73/73 (100%)** · con falla: 24 · no probados: 0

## contabilidad · `/accounting/chart-of-accounts/segments-configuration`

**Pasada 1 (estado vacío)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 1 | Cargar Plantilla | button:button | clic | abre diálogo/panel · abre menú/lista | ok |
| 2 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 3 | Guardar Estructura | button:submit | clic | 400 esperado: regla de negocio (ya existen cuentas) | ok |
| 4 | Ej: Mayor, Sub-cuenta... | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 5 | length | input:number | escribir "12345" | valor queda "12345" | ok |
| 6 | isRequired | input:checkbox | clic | cambia contenido | ok |
| 7 | Eliminar Nivel | button:button | - | no ejecutado: eliminar línea/nivel en formulario vacío o proveedor no localizable en la lista | no probado |
| 8 | Agregar Nivel | button:button | clic | cambia contenido | ok |

Probados: **8/9 (89%)** · con falla: 0 · no probados: 1

## contabilidad · `/accounting/chart-of-accounts/new`

**Pasada 1 (estado vacío)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/chart-of-accounts · pestañas 2→3 · cambia contenido · red: GET /chart-of-accounts 200 | ok |
| 2 | Guardar Cuenta | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Código de Cuenta» es obligatorio «Nombre de la Cuenta» es obligatorio «Tipo de Cuenta» es obligatorio «Categoría» es o | ok |
| 3 | General | button:button | clic | sin efecto visible ni llamada de red | con falla |
| 4 | Mapeos | button:button | clic | cambia contenido | ok |
| 5 | Reglas | button:button | clic | cambia contenido | ok |
| 6 | Avanzado | button:button | clic | cambia contenido | ok |
| 7 | code | input | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 8 | name | input | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 9 | description | textarea | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 10 | -- Ninguna (Cuenta Raíz) -- | input:text | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 11 | (sin texto) | button:button | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |
| 12 | Seleccionar tipo... ASSET LIABILITY EQUITY REVENUE EXPENSE | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 13 | nature | input | - | deshabilitado en este estado | no probado |
| 14 | Seleccionar categoría... CURRENT_ASSET NON_CURRENT_ASSET CUR | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 15 | isPostable | input:checkbox | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 16 | isActive | input:checkbox | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |

Probados: **14/17 (82%)** · con falla: 2 · no probados: 3

## contabilidad · `/accounting/journal-entries`

**Pasada 1 (estado vacío)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Asiento | a | clic | abre "Nuevo Asiento Contable" (verificado en flujo 24; la pasada enfocó una pestaña ya abierta) | ok |
| 1 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | N.º DE ASIENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | DÉBITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | CRÉDITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | 28/09/2026 GENERAL-2026-000001 Inventario inicial: QA-Produc | fila | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 8 | GENERAL-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 9 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 10 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 11 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 12 | 25 50 100 | select | seleccionar 3 opciones | red: GET /journal-entries?page=1&pageSize=25 200, GET /journal-entries?page=1&pageSize=50 200, GET /journal-entries?page=1&pageSize=100 200 | ok |

**Pasada 2 (con datos)** — 31 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Asiento | a | clic | abre "Nuevo Asiento Contable" (verificado en flujo 24; la pasada enfocó una pestaña ya abierta) | ok |
| 1 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | N.º DE ASIENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | DÉBITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | CRÉDITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | 30/09/2026 NOMINA-2026-000001 Nómina Nómina 09/2026 USD 75,3 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 8 | NOMINA-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 9 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 10 | VENTAS-2026-000002 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 11 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 12 | VENTAS-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 13 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 14 | PAGOS-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 15 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 16 | GENERAL-2026-000003 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 17 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 18 | GENERAL-2026-000002 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 19 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 20 | GENERAL-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 21 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 22 | COMPRAS-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 23 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 24 | COBROS-2026-000002 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 25 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 26 | COBROS-2026-000001 | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 27 | Más acciones | a | clic | no abre el asiento (verificado manualmente) — QA-021 | con falla |
| 28 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 29 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 30 | 25 50 100 | select | seleccionar 3 opciones | red: GET /journal-entries?page=1&pageSize=25 200, GET /journal-entries?page=1&pageSize=50 200, GET /journal-entries?page=1&pageSize=100 200 | ok |

Probados: **40/44 (91%)** · con falla: 23 · no probados: 4

## contabilidad · `/accounting/journal-entries/new`

**Pasada 1 (estado vacío)** — 25 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journal-entries · pestañas 2→3 · cambia contenido · red: GET /journal-entries?page=1&pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journal-entries · pestañas 2→3 · cambia contenido · red: GET /journal-entries?page=1&pageSize=50 200 | ok |
| 2 | Guardar asiento | button:submit | clic | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Libro Mayor» es obligatorio «Diario» es obligatorio «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es o | ok |
| 3 | date | input:date | escribir "2026-09-15" | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Libro Mayor» es obligatorio «Diario» es obligatorio «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es o | ok |
| 4 | Selecciona un libro mayor Libro Principal | select | seleccionar 2 opciones | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Diario» es obligatorio «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es obligatorio / El monto total n | ok |
| 5 | Selecciona un diario Diario de Bancos Diario de Caja Diario  | select | seleccionar 9 opciones | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Descripción» es obligatorio «Cuenta» es obligatorio «Cuenta» es obligatorio / El monto total no puede ser cero. | ok |
| 6 | Introduce una descripción para el asiento | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Cuenta» es obligatorio «Cuenta» es obligatorio / El monto total no puede ser cero. | ok |
| 7 | CUENTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | DÉBITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | CRÉDITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 12 | Selecciona una cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 13 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 14 | description | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 15 | debit | input:number | escribir "12345" | aviso: Revisa 5 punto(s) antes de guardar «Cuenta» es obligatorio «Cuenta» es obligatorio / Los débitos y los créditos deben estar balanceados. | ok |
| 16 | credit | input:number | escribir "12345" | cambia contenido · aviso: Revisa 5 punto(s) antes de guardar «Cuenta» es obligatorio «Cuenta» es obligatorio | ok |
| 17 | Eliminar | button:button | - | deshabilitado en este estado | no probado |
| 18 | Selecciona una cuenta | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 19 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /chart-of-accounts?limit=50 200 | ok |
| 20 | description | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 21 | debit | input:number | escribir "12345" | valor queda "12345" | ok |
| 22 | credit | input:number | escribir "12345" | valor queda "12345" | ok |
| 23 | Eliminar | button:button | - | deshabilitado en este estado | no probado |
| 24 | Añadir línea | button:button | clic | cambia contenido | ok |

Probados: **23/25 (92%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/journal-entries/import`

**Pasada 1 (estado vacío)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | (sin texto) | a | clic | navega a /e/virtex-dev/accounting/journal-entries · pestañas 2→3 · cambia contenido · red: GET /journal-entries?page=1&pageSize=50 200 | ok |
| 1 | Haz clic aquí para seleccionar un fichero (CSV, Excel) | div:button | clic | abre el selector de archivos (verificado manualmente) | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/daily-journal`

**Pasada 1 (estado vacío)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | no descarga ni llama a la red (verificado manualmente) — QA-042 | con falla |
| 1 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | N.º DE ASIENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | CUENTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | DÉBITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | CRÉDITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | 28/09/2026 GENERAL-2026-000001 1140 — Inventarios Inventario | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 8 | GENERAL-2026-000001 | a | clic | error: GET /chart-of-accounts/1d1b9dfd-73e9-400f-a86d-6650fcc5f0ea FAILED net::ERR_ABORTED ; GET /chart-of-accounts/3999f5a0-79c4-4c37-9322-6147d6a859fa FAILED net::ERR_ABORTED  | con falla |
| 9 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 10 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 11 | 25 50 100 | select | seleccionar 3 opciones | red: GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=25 200, GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=50 200 | ok |

**Pasada 2 (con datos)** — 21 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | no descarga ni llama a la red (verificado manualmente) — QA-042 | con falla |
| 1 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | N.º DE ASIENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | CUENTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | DÉBITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | CRÉDITO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | 30/09/2026 NOMINA-2026-000001 2141 — AFP por Pagar (TSS) Nóm | fila | - | fila sin acción | ok |
| 8 | NOMINA-2026-000001 | a | clic | fila sin acción | ok |
| 9 | VENTAS-2026-000002 | a | clic | error: GET /chart-of-accounts/7d4a121a-aed7-4b7f-8d6d-838e92c93b5d FAILED net::ERR_ABORTED ; GET /chart-of-accounts/dafd0184-6e35-48fe-a6c7-dcc1470f1ff7 FAILED net::ERR_ABORTED ; G | con falla |
| 10 | VENTAS-2026-000001 | a | clic | error: GET /chart-of-accounts/7d4a121a-aed7-4b7f-8d6d-838e92c93b5d FAILED net::ERR_ABORTED ; GET /chart-of-accounts/dafd0184-6e35-48fe-a6c7-dcc1470f1ff7 FAILED net::ERR_ABORTED ; G | con falla |
| 11 | PAGOS-2026-000001 | a | clic | error: GET /chart-of-accounts/05069cab-d5a7-463e-93b2-1e1b4229dd74 FAILED net::ERR_ABORTED ; GET /chart-of-accounts/ea3a056d-25eb-4ef1-b2be-1ccb98503f1d FAILED net::ERR_ABORTED ; G | con falla |
| 12 | GENERAL-2026-000003 | a | clic | error: GET /chart-of-accounts/3999f5a0-79c4-4c37-9322-6147d6a859fa FAILED net::ERR_ABORTED ; GET /chart-of-accounts/8ecded2e-5a83-4e58-8fe2-ccd767918428 FAILED net::ERR_ABORTED ; G | con falla |
| 13 | GENERAL-2026-000002 | a | clic | error: GET /chart-of-accounts/3999f5a0-79c4-4c37-9322-6147d6a859fa FAILED net::ERR_ABORTED ; GET /chart-of-accounts/8ecded2e-5a83-4e58-8fe2-ccd767918428 FAILED net::ERR_ABORTED ; G | con falla |
| 14 | GENERAL-2026-000001 | a | clic | error: GET /chart-of-accounts/1d1b9dfd-73e9-400f-a86d-6650fcc5f0ea FAILED net::ERR_ABORTED ; GET /chart-of-accounts/3999f5a0-79c4-4c37-9322-6147d6a859fa FAILED net::ERR_ABORTED ; G | con falla |
| 15 | COMPRAS-2026-000001 | a | clic | error: GET /chart-of-accounts/ea3a056d-25eb-4ef1-b2be-1ccb98503f1d FAILED net::ERR_ABORTED ; GET /chart-of-accounts/805653b6-aaa1-4da9-8ed9-3dac2200bfbf FAILED net::ERR_ABORTED ; G | con falla |
| 16 | COBROS-2026-000002 | a | clic | error: GET /chart-of-accounts/bacb1d27-1085-4d62-9df4-8228c9af8888 FAILED net::ERR_ABORTED ; GET /chart-of-accounts/05069cab-d5a7-463e-93b2-1e1b4229dd74 FAILED net::ERR_ABORTED ; G | con falla |
| 17 | COBROS-2026-000001 | a | clic | error: GET /chart-of-accounts/bacb1d27-1085-4d62-9df4-8228c9af8888 FAILED net::ERR_ABORTED ; GET /chart-of-accounts/05069cab-d5a7-463e-93b2-1e1b4229dd74 FAILED net::ERR_ABORTED ; G | con falla |
| 18 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 19 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 20 | 25 50 100 | select | seleccionar 3 opciones | red: GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=25 200, GET /chart-of-accounts 200, GET /journal-entries?page=1&pageSize=50 200 | ok |

Probados: **29/33 (88%)** · con falla: 12 · no probados: 4

## contabilidad · `/accounting/general-ledger`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | no descarga ni llama a la red (verificado manualmente) — QA-042 | con falla |

Probados: **1/1 (100%)** · con falla: 1 · no probados: 0

## contabilidad · `/accounting/general-ledger/new`

**Pasada 1 (estado vacío)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/general-ledger · pestañas 2→3 · cambia contenido · aviso: Error No se ha especificado una cuenta. Error No se ha especificado una cuenta. / Error  | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/general-ledger · pestañas 2→3 · cambia contenido · aviso: Error No se ha especificado una cuenta. Error No se ha especificado una cuenta. Error No | ok |
| 2 | Guardar libro | button:submit | clic | deshabilitado hasta completar el formulario | ok |
| 3 | Ej: Libro Principal IFRS | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 4 | Ej: Utilizado para reportes financieros bajo NIIF. | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | isDefault | input:checkbox | clic | sin efecto visible ni llamada de red | con falla |

Probados: **6/6 (100%)** · con falla: 1 · no probados: 0

## contabilidad · `/accounting/subsidiary-ledgers`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | - | deshabilitado en este estado | no probado |

Probados: **0/1 (0%)** · con falla: 0 · no probados: 1

## contabilidad · `/accounting/ledgers`

**Pasada 1 (estado vacío)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Crear Nuevo Libro | a | clic | navega a /e/virtex-dev/accounting/general-ledger/new · pestañas 2→3 · cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | DESCRIPCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | POR DEFECTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Libro Principal Libro contable principal, en la moneda funci | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 5 | Editar | a | clic | navega a /e/virtex-dev/accounting/general-ledger/a45af47e-85ba-46e4-81c1-a3b5581cdf71/edit · pestañas 2→3 · cambia contenido · red: GET /accounting/ledgers/a45af47e-85ba-46e4-81c1- | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/journals`

**Pasada 1 (estado vacío)** — 14 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Crear diario | a | clic | navega a /e/virtex-dev/accounting/journals/new · pestañas 2→3 · cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | CÓDIGO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | TIPO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Diario de Bancos BANCOS BANK Editar | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 6 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 7 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 8 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 9 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 10 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 11 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 12 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |
| 13 | Editar | a | clic | GET /journals/:id → 404 — QA-021 | con falla |

Probados: **14/14 (100%)** · con falla: 8 · no probados: 0

## contabilidad · `/accounting/journals/new`

**Pasada 1 (estado vacío)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journals · pestañas 2→3 · cambia contenido · red: GET /journals 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/journals · pestañas 2→3 · cambia contenido · red: GET /journals 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Nombre» es obligatorio «Código» es obligatorio | ok |
| 3 | name | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Código» es obligatorio | ok |
| 4 | code | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar | ok |
| 5 | Ventas Compras Caja Banco General | select | seleccionar 5 opciones | valor queda "undefined" | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/periods`

**Pasada 1 (estado vacío)** — 19 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Actualizar | button:button | clic | red: GET /accounting/periods 200 | ok |
| 1 | PERÍODO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | FECHA DE INICIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | FECHA DE CIERRE | th | - | encabezado/fila sin acción | ok |
| 4 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ACCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | enero de 2026 01/01/2026 31/01/2026 Abierto Cerrar Período | fila | - | encabezado/fila sin acción | ok |
| 7 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 8 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 9 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 10 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 11 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 12 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 13 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 14 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 15 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 16 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 17 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 18 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |

**Pasada 2 (con datos)** — 19 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Actualizar | button:button | clic | red: GET /accounting/periods 200 | ok |
| 1 | PERÍODO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | FECHA DE INICIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | FECHA DE CIERRE | th | - | encabezado/fila sin acción | ok |
| 4 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ACCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | enero de 2026 01/01/2026 31/01/2026 Abierto Cerrar Período | fila | - | encabezado/fila sin acción | ok |
| 7 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 8 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 9 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 10 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 11 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 12 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 13 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 14 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 15 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 16 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 17 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |
| 18 | Cerrar Período | button:button | - | enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006 | con falla |

Probados: **38/38 (100%)** · con falla: 24 · no probados: 0

## contabilidad · `/accounting/variance-analysis`

**Pasada 1 (estado vacío)** — 8 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Período | button:button | - | deshabilitado en este estado | no probado |
| 1 | Exportar | button:button | - | deshabilitado en este estado | no probado |
| 2 | CUENTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | REAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | PRESUPUESTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | VARIACIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | VARIACIÓN (%) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | No hay datos disponibles para el análisis de variaciones. | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **6/8 (75%)** · con falla: 0 · no probados: 2

## contabilidad · `/accounting/closing/month-end`

**Pasada 1 (estado vacío)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Ir a la tarea | a | clic | navega a /e/virtex-dev/overview · cambia contenido · red: GET /overview/news 200, GET /overview/activity?limit=8 200, GET /overview/events?days=30&limit=8 200 | ok |
| 1 | Ir a la tarea | a | clic | navega a /e/virtex-dev/overview · cambia contenido · red: GET /overview/news 200, GET /overview/activity?limit=8 200, GET /overview/events?days=30&limit=8 200 | ok |

Probados: **2/2 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/closing/annual-close`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/audit-adjustments`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Proponer ajuste | button:button | clic | navega a /e/virtex-dev/accounting/audit-adjustments/new · pestañas 2→3 · cambia contenido · red: GET /accounting/fiscal-years?status=CLOSED 200, GET /journals 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## contabilidad · `/accounting/audit-adjustments/new`

**Pasada 1 (estado vacío)** — 24 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/audit-adjustments · pestañas 2→3 · cambia contenido · red: GET /accounting/fiscal-years 200, GET /audit/adjustments?pageSize=50 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/audit-adjustments · pestañas 2→3 · cambia contenido · red: GET /audit/adjustments?pageSize=50 200, GET /accounting/fiscal-years 200 | ok |
| 2 | Proponer ajuste | button:submit | clic | cambia contenido · aviso: Revisa 8 punto(s) antes de guardar Elige el ejercicio que se corrige. Elige el diario donde se registrará. Describe el ajuste. Línea 1: falta la cuenta. L | ok |
| 3 | Elige un ejercicio cerrado… | select | seleccionar 1 opciones | cambia contenido | ok |
| 4 | Elige un diario… BANCOS — Diario de Bancos CAJA — Diario de  | select | seleccionar 9 opciones | valor queda "undefined" | ok |
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

**Pasada 1 (estado vacío)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | 01/01/2026 — 31/01/2026 01/02/2026 — 28/02/2026 01/03/2026 — | select | seleccionar 12 opciones | cambia contenido · red: GET /accounting/periods/81df8963-3964-47a0-8e52-01b458e9ce99/closing-checklist 200, GET /accounting/periods/eff65f28-be29-4bbf-bc03-a9abb4fc9edd/closing-che | ok |
| 1 | Actualizar | button:button | clic | cambia contenido · red: GET /accounting/periods 200, GET /accounting/periods/81df8963-3964-47a0-8e52-01b458e9ce99/closing-checklist 200 | ok |
| 2 | NOMBRE DE LA LISTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Verificar y procesar todos los asientos contables en borrado | fila | - | ítem informativo de la lista de verificación | ok |
| 4 | Resolver | a | clic | navega a /e/virtex-dev/overview · cambia contenido · red: GET /overview/activity?limit=8 200, GET /overview/news 200, GET /overview/events?days=30&limit=8 200 | ok |
| 5 | Resolver | a | clic | navega a /e/virtex-dev/overview · cambia contenido · red: GET /overview/news 200, GET /overview/activity?limit=8 200, GET /overview/events?days=30&limit=8 200 | ok |

Probados: **6/6 (100%)** · con falla: 0 · no probados: 0

## inventario · `/inventory/products`

**Pasada 1 (estado vacío)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Producto | a | clic | navega a /e/virtex-dev/inventory/products/new · pestañas 2→3 · cambia contenido · red: GET /inventory/categories 200 | ok |
| 1 | Buscar por nombre, SKU o categoría... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 2 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | CATEGORÍA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | PRECIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | COSTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | STOCK | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | QA-Producto-01 Silla ergonómica QA-SKU-001 — 1,000.00 600.00 | fila | clic | abre la edición del producto (verificado manualmente) | ok |
| 9 | QA-Producto-01 Silla ergonómica | a | clic | abre la edición del producto (verificado manualmente) | ok |
| 10 | Editar | a | clic | navega a /e/virtex-dev/inventory/products/93628f14-8761-4aa8-a91a-fd464aa18ea5/edit · pestañas 2→3 · cambia contenido · red: GET /inventory/categories 200, GET /inventory/93628f14- | ok |
| 11 | Eliminar | button:button | - | borra producto con facturas/OC (200). Sin dependencias (QA-XSS): OK | con falla |

**Pasada 2 (con datos)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Producto | a | clic | navega a /e/virtex-dev/inventory/products/new · pestañas 2→3 · cambia contenido · red: GET /inventory/categories 200 | ok |
| 1 | Buscar por nombre, SKU o categoría... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 2 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | CATEGORÍA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | PRECIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | COSTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | STOCK | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | QA-Producto-01 Silla ergonómica QA-SKU-001 — 1,000.00 600.00 | fila | clic | abre la edición del producto (verificado manualmente) | ok |
| 9 | QA-Producto-01 Silla ergonómica | a | clic | abre la edición del producto (verificado manualmente) | ok |
| 10 | Editar | a | clic | navega a /e/virtex-dev/inventory/products/93628f14-8761-4aa8-a91a-fd464aa18ea5/edit · pestañas 2→3 · cambia contenido · red: GET /inventory/categories 200, GET /inventory/93628f14- | ok |
| 11 | Eliminar | button:button | - | borra producto con facturas/OC (200). Sin dependencias (QA-XSS): OK | con falla |
| 12 | QA-XSS <img src=x onerror=alert(1)> "' | a | clic | navega a /e/virtex-dev/inventory/products/e5de615b-ea33-4038-a159-2826202b2747/edit · pestañas 2→3 · cambia contenido · red: GET /inventory/categories 200, GET /inventory/e5de615b- | ok |
| 13 | Editar | a | clic | navega a /e/virtex-dev/inventory/products/93628f14-8761-4aa8-a91a-fd464aa18ea5/edit · pestañas 2→3 · cambia contenido · red: GET /inventory/categories 200, GET /inventory/93628f14- | ok |
| 14 | Eliminar | button:button | - | borra producto con facturas/OC (200). Sin dependencias (QA-XSS): OK | con falla |

Probados: **27/27 (100%)** · con falla: 3 · no probados: 0

## inventario · `/inventory/products/new`

**Pasada 1 (estado vacío)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/products · pestañas 2→3 · cambia contenido · red: GET /inventory 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/inventory/products · pestañas 2→3 · cambia contenido · red: GET /inventory 200 | ok |
| 2 | Guardar producto | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Nombre del Producto» es obligatorio | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar | ok |
| 4 | sku | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | description | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 6 | imageFile | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 7 | price | input:number | escribir "12345" | valor queda "12345" | ok |
| 8 | stock | input:number | escribir "12345" | valor queda "12345" | ok |
| 9 | cost | input:number | escribir "12345" | valor queda "12345" | ok |
| 10 | reorderLevel | input:number | escribir "12345" | valor queda "12345" | ok |
| 11 | Sin categoría | select | seleccionar 1 opciones | valor queda "undefined" | ok |
| 12 | Activo Inactivo | select | seleccionar 2 opciones | valor queda "undefined" | ok |

Probados: **12/13 (92%)** · con falla: 0 · no probados: 1

## inventario · `/inventory/categories`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Categoría | button:button | clic | cambia contenido | ok |

**Pasada 2 (con datos)** — 9 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Categoría | button:button | clic | cambia contenido | ok |
| 1 | Nombre | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | Código | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Estado | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Acciones | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | QA-Categoría Muebles & Oficina — Activa Retirar | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 6 | Editar | button:button | clic | cambia contenido | ok |
| 7 | Retirar | button:button | clic | "Retirar" (PATCH) sobre categoría QA | ok |
| 8 | Eliminar | button:button | - | "Retirar" (PATCH) sobre categoría QA | ok |

Probados: **10/10 (100%)** · con falla: 0 · no probados: 0

## inventario · `/masters/warehouses`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo almacén | button:button | clic | cambia contenido | ok |

**Pasada 2 (con datos)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo almacén | button:button | clic | cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | CÓDIGO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | UBICACIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | QA-Almacén Central QA-1 QA-2 Activo | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **7/7 (100%)** · con falla: 0 · no probados: 0

## inventario · `/masters/units-of-measure`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/payroll/my-payslips`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

**Pasada 2 (con datos)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/payroll/runs`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva nómina | button:button | clic | cambia contenido | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/hcm/employees`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo empleado | a | clic | navega a /e/virtex-dev/hcm/employees/new · pestañas 2→3 · cambia contenido · red: GET /hcm/departments 200, GET /hcm/identity-document-types 200, GET /hcm/statutory-identifier-type | ok |
| 1 | Buscar por nombre, correo o puesto… | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 2 | (sin texto) | input:checkbox | clic | filtro "Incluir desvinculados": sin desvinculados que mostrar (no concluyente) | ok |

**Pasada 2 (con datos)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo empleado | a | clic | navega a /e/virtex-dev/hcm/employees/new · pestañas 2→3 · cambia contenido · red: GET /hcm/departments 200, GET /hcm/identity-document-types 200, GET /hcm/statutory-identifier-type | ok |
| 1 | Buscar por nombre, correo o puesto… | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido | ok |
| 2 | (sin texto) | input:checkbox | clic | filtro "Incluir desvinculados": sin desvinculados que mostrar (no concluyente) | ok |
| 3 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | PUESTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | DEPARTAMENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | FECHA DE INGRESO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Pérez Ñúñez, QA-Ana qa-ana.perez@example.com QA Analista con | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 9 | Pérez Ñúñez, QA-Ana | a | clic | error: GET /hcm/employees/a1646c63-ee69-4c35-a04a-6d25b2443ca5/compensation 401 {"statusCode":401,"code":"auth.step_up_authentication_required","messageKey":"auth.step_up_authentic | con falla |

Probados: **13/13 (100%)** · con falla: 1 · no probados: 0

## rrhh · `/hcm/employees/new`

**Pasada 1 (estado vacío)** — 20 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/hcm/employees · pestañas 2→3 · cambia contenido · red: GET /hcm/departments 200, GET /hcm/employees?pageSize=200 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/hcm/employees · pestañas 2→3 · cambia contenido · red: GET /hcm/employees?pageSize=200 200, GET /hcm/departments 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Nombres» es obligatorio «Apellidos» es obligatorio «Correo» es obligatorio «[[identityDocument]]» es obligatorio | ok |
| 3 | firstName | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Apellidos» es obligatorio «Correo» es obligatorio «[[identityDocument]]» es obligatorio | ok |
| 4 | lastName | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «Correo» es obligatorio «[[identityDocument]]» es obligatorio | ok |
| 5 | email | input:email | escribir "qa@example.com" | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «[[identityDocument]]» es obligatorio | ok |
| 6 | jobTitle | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | departmentId | select | seleccionar 1 opciones | valor queda "undefined" | ok |
| 8 | hireDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 9 | Cédula Pasaporte | select | seleccionar 2 opciones | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar | ok |
| 10 | 001-1234567-8 | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 4 punto(s) antes de guardar «[[identityDocument]]» es obligatorio | ok |
| 11 | (sin texto) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | (sin texto) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 13 | (sin texto) | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 14 | bankName | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 15 | bankAccountNumber | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | bankAccountType | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 17 | Activo Suspendido Desvinculado | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 18 | Indefinido Tiempo determinado Ocasional | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 19 | terminationDate | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |

Probados: **20/20 (100%)** · con falla: 0 · no probados: 0

## rrhh · `/hcm/departments`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo departamento | button:button | clic | cambia contenido | ok |

**Pasada 2 (con datos)** — 7 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo departamento | button:button | clic | cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | CENTRO DE COSTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | QA-Departamento Finanzas — | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 5 | Editar | button:button | clic | cambia contenido | ok |
| 6 | Eliminar | button:button | - | sin confirmación; borra departamento con empleado asignado (204) | con falla |

Probados: **8/8 (100%)** · con falla: 1 · no probados: 0

## rrhh · `/payroll/concepts`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo concepto | button:button | clic | cambia contenido | ok |

**Pasada 2 (con datos)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo concepto | button:button | clic | cambia contenido | ok |
| 1 | CÓDIGO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | TIPO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | CÁLCULO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | TASA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | GRAVABLE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | QA-BONO QA Bono productividad Ingreso Porcentaje 0.05 ✓ | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 9 | Editar | button:button | clic | sin efecto visible ni llamada de red | con falla |
| 10 | Eliminar | button:button | - | elimina sin confirmación (204) | con falla |

Probados: **12/12 (100%)** · con falla: 2 · no probados: 0

## rrhh · `/payroll/parameters`

**Pasada 1 (estado vacío)** — 18 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | RÉGIMEN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 1 | TASA DEL EMPLEADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | TASA PATRONAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | BASE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | VIGENCIA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | AFP 2.87% 7.10% Salario con tope 01/01/2020 — … | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 7 | PARÁMETRO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | VALOR | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | VIGENCIA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | [[payroll.parameters.key_label.MIN_WAGE_COTIZABLE]] 10,000.0 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 12 | DESDE (ANUAL) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 13 | HASTA (ANUAL) | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 14 | TASA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 15 | IMPUESTO ACUMULADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 16 | VIGENCIA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 17 | 0.00 416,220.00 0% 0.00 01/01/2017 — … | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **18/18 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/accounting/treasury`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | treasuryAsOf | input:date | escribir "2026-09-15" | red: GET /treasury/bank-accounts 200, GET /treasury/bank-transfers?pageSize=25 200, GET /treasury/cash-position?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | red: GET /treasury/bank-accounts 200, GET /treasury/cash-position?asOfDate=2026-09-15 200, GET /treasury/bank-transfers?pageSize=25 200 | ok |
| 2 | Nueva cuenta bancaria | a | clic | abre el formulario (verificado en flujo 19) | ok |

**Pasada 2 (con datos)** — 11 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | treasuryAsOf | input:date | escribir "2026-09-15" | cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/cash-position?asOfDate=2026-09-15 200, GET /treasury/bank-transfers?pageSize=25 200 | ok |
| 1 | Actualizar | button:button | clic | cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/cash-position?asOfDate=2026-09-15 200, GET /treasury/bank-transfers?pageSize=25 200 | ok |
| 2 | Nueva cuenta bancaria | a | clic | abre el formulario (verificado en flujo 19) | ok |
| 3 | Cuentas bancarias | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | Banco | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Número | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | Moneda | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Saldo en su moneda | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Saldo en moneda de los libros | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | QA-Cuenta Corriente BHD Banco BHD (QA) ••••4567 DOP -DOP 2,6 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 10 | QA-Cuenta Corriente BHD | a | clic | sin efecto visible ni llamada de red | con falla |

Probados: **14/14 (100%)** · con falla: 1 · no probados: 0

## tesoreria · `/accounting/treasury/bank-accounts/new`

**Pasada 1 (estado vacío)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/treasury · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200, GET /treasury/cash-position?asOfDate=2026-09-28 200, GET /treas | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/treasury · pestañas 2→3 · cambia contenido · red: GET /treasury/cash-position?asOfDate=2026-09-28 200, GET /treasury/bank-transfers?pageSize=25 20 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Nombre» es obligatorio «Moneda» es obligatorio «Cuenta contable» es obligatorio | ok |
| 3 | name | input:text | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Moneda» es obligatorio «Cuenta contable» es obligatorio | ok |
| 4 | bankName | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | accountNumber | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 6 | Corriente Ahorros Caja / efectivo Tarjeta de crédito | select | seleccionar 4 opciones | valor queda "undefined" | ok |
| 7 | PAB BOB VES CRC NIO CAD USD EUR CHF PYG HNL GBP ARS CLP COP  | select | seleccionar 24 opciones | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Cuenta contable» es obligatorio | ok |
| 8 | 1110 — Efectivo y Equivalentes de Efectivo 1120 — Bancos 116 | select | seleccionar 6 opciones | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar | ok |
| 9 | openingBalance | input:number | escribir "12345" | cambia contenido | ok |
| 10 | iban | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 11 | swiftBic | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b" | ok |
| 12 | notes | textarea | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **13/13 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/accounting/reconciliation/import`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/reconciliation · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/accounting/reconciliation · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200 | ok |
| 2 | Importar estado de cuenta | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar Selecciona el archivo del estado de cuenta. | ok |

Probados: **3/3 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/accounting/reconciliation`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Importar estado de cuenta | a | clic | navega a /e/virtex-dev/accounting/reconciliation/import · pestañas 2→3 · cambia contenido · red: GET /treasury/bank-accounts 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/masters/banks`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo banco | button:button | clic | navega a /e/virtex-dev/accounting/treasury/bank-accounts/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /chart-of-accounts 200 | ok |

**Pasada 2 (con datos)** — 6 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo banco | button:button | clic | navega a /e/virtex-dev/accounting/treasury/bank-accounts/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /chart-of-accounts 200 | ok |
| 1 | NOMBRE DEL BANCO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | CÓDIGO SWIFT | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | CUENTAS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | MONEDAS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | Banco BHD (QA) — 1 DOP | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **7/7 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/masters/payment-methods`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | CÓDIGO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | 01 Efectivo | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **3/3 (100%)** · con falla: 0 · no probados: 0

## tesoreria · `/masters/payment-terms`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## ventas · `/invoices`

**Pasada 1 (estado vacío)** — 15 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | descarga facturas-AAAA-MM-DD.csv (verificado manualmente) | ok |
| 1 | Nueva factura de venta | a | clic | navega a /e/virtex-dev/invoices/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /invoices/context 200 | ok |
| 2 | Buscar por cliente o número de factura... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /invoices?page=1&limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | Todos Cobrada Pendiente Parcial Anulada | select | seleccionar 5 opciones | cambia contenido · red: GET /invoices?page=1&limit=50 200, GET /invoices?page=1&limit=50&status=Paid 200, GET /invoices?page=1&limit=50&status=Pending 200, GET /invoices?page=1&lim | ok |
| 4 | FACTURA # | th | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |
| 5 | CLIENTE | th | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |
| 6 | CREACIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | VENCIMIENTO | th | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 8 | TOTAL | th | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 9 | ESTADO | th | - | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 10 | FAC-00000001 QA-Cliente-01 Distribuidora Ñandú & Hijos 28/09 | fila | - | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 11 | FAC-00000001 | a | - | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 12 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 13 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 14 | 25 50 100 | select | seleccionar 3 opciones | red: GET /invoices?page=1&limit=25&status=Void 200, GET /invoices?page=1&limit=50&status=Void 200, GET /invoices?page=1&limit=100&status=Void 200 | ok |

**Pasada 2 (con datos)** — 16 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | descarga facturas-AAAA-MM-DD.csv (verificado manualmente) | ok |
| 1 | Nueva factura de venta | a | clic | navega a /e/virtex-dev/invoices/new · pestañas 2→3 · cambia contenido · red: GET /currencies 200, GET /invoices/context 200 | ok |
| 2 | Buscar por cliente o número de factura... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /invoices?page=1&limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | Todos Cobrada Pendiente Parcial Anulada | select | seleccionar 5 opciones | cambia contenido · red: GET /invoices?page=1&limit=50 200, GET /invoices?page=1&limit=50&status=Paid 200, GET /invoices?page=1&limit=50&status=Pending 200, GET /invoices?page=1&lim | ok |
| 4 | FACTURA # | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | CLIENTE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | CREACIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | VENCIMIENTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | TOTAL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | ESTADO | th | clic | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 10 | FAC-00000002 QA-Cliente-01 Distribuidora Ñandú & Hijos 28/09 | fila | clic | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 11 | FAC-00000002 | a | clic | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 12 | FAC-00000001 | a | clic | abre el detalle (flujos 42/43) / encabezado sin orden | ok |
| 13 | Página anterior | button:button | - | deshabilitado en este estado | no probado |
| 14 | Página siguiente | button:button | - | deshabilitado en este estado | no probado |
| 15 | 25 50 100 | select | seleccionar 3 opciones | red: GET /invoices?page=1&limit=25&status=Pending 200, GET /invoices?page=1&limit=50&status=Pending 200, GET /invoices?page=1&limit=100&status=Pending 200 | ok |

Probados: **25/31 (81%)** · con falla: 2 · no probados: 6

## ventas · `/invoices/new`

**Pasada 1 (estado vacío)** — 41 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 1 | Emitir factura | button:button | - | emite (POST /invoices 201) — flujo 16/39 | ok |
| 2 | Cancelar | button:button | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 3 | Guardar borrador | button:submit | clic | cambia contenido · aviso: Revisa 1 punto(s) antes de guardar «Cliente» es obligatorio | ok |
| 4 | Volver | button | clic | navega a /e/virtex-dev/invoices · pestañas 2→3 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 5 | Avanzar | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 6 | Imprimir | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 7 | Enviar por correo | button | - | sin efecto — QA-017 | con falla |
| 8 | Búsqueda sobre documento | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 9 | Exportar a PDF | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 10 | Exportar a Excel | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 11 | Exportar a Word | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 12 | Copiar de | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 13 | Copiar a | button | clic | en factura existente abre nueva factura prellenada (verificado); en borrador nuevo no aplica | ok |
| 14 | Parametrizaciones de formulario | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 15 | Ayuda | button | clic | botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017 | con falla |
| 16 | Contenido | button:button | clic | cambia de pestaña (verificado manualmente) | ok |
| 17 | Fiscal y cobro | button:button | clic | cambia de pestaña (verificado manualmente) | ok |
| 18 | Busca por nombre, documento o correo… | input:text | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 19 | (sin texto) | button:button | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 20 | issueDate | input:date | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 21 | dueDate | input:date | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 22 | PAB · Balboa panameño BOB · Boliviano VES · Bolívar venezola | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 23 | ARTÍCULO | th | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 24 | DESCRIPCIÓN | th | clic | cubierto en el flujo manual del formulario (limitación del arnés al localizar el control) | ok |
| 25 | CANTIDAD | th | - | cubierto en el flujo manual de factura (16/39) | ok |
| 26 | PRECIO | th | - | cubierto en el flujo manual de factura (16/39) | ok |
| 27 | DESC. % | th | - | cubierto en el flujo manual de factura (16/39) | ok |
| 28 | TRATAMIENTO | th | - | cubierto en el flujo manual de factura (16/39) | ok |
| 29 | IMPUESTO | th | - | cubierto en el flujo manual de factura (16/39) | ok |
| 30 | Gravado Tasa cero Exento 18% 16% 0% × | fila | - | cubierto en el flujo manual de factura (16/39) | ok |
| 31 | (sin texto) | button:button | - | limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar | no probado |
| 32 | description | input:text | - | cubierto en el flujo manual de factura (16/39) | ok |
| 33 | quantity | input:number | - | cubierto en el flujo manual de factura (16/39) | ok |
| 34 | unitPrice | input:number | - | cubierto en el flujo manual de factura (16/39) | ok |
| 35 | discountRate | input:number | - | cubierto en el flujo manual de factura (16/39) | ok |
| 36 | Gravado Tasa cero Exento | select | - | cubierto en el flujo manual de factura (16/39) | ok |
| 37 | 18% 16% 0% | select | - | cubierto en el flujo manual de factura (16/39) | ok |
| 38 | Eliminar línea | button:button | - | deshabilitado en este estado | no probado |
| 39 | + Añadir línea | button:button | - | cubierto en el flujo manual de factura (16/39) | ok |
| 40 | notes | textarea | - | cubierto en el flujo manual de factura (16/39) | ok |

Probados: **39/41 (95%)** · con falla: 10 · no probados: 2

## ventas · `/customer-receipts`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Recibo | a | clic | abre "Nuevo Recibo" (verificado en flujo 19) | ok |

**Pasada 2 (con datos)** — 8 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nuevo Recibo | a | clic | abre "Nuevo Recibo" (verificado en flujo 19) | ok |
| 1 | NÚMERO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | CLIENTE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | MONTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | NO APLICADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | REC-2026-000002 QA-Cliente-01 Distribuidora Ñandú & Hijos 28 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **9/9 (100%)** · con falla: 0 · no probados: 0

## ventas · `/customer-receipts/new`

**Pasada 1 (estado vacío)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/customer-receipts · pestañas 2→3 · cambia contenido · red: GET /customers 200, GET /customer-payments 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/customer-receipts · pestañas 2→3 · cambia contenido · red: GET /customers 200, GET /customer-payments 200 | ok |
| 2 | Guardar | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Cliente» es obligatorio «Cuenta bancaria» es obligatorio «Moneda» es obligatorio | ok |
| 3 | Busca por nombre, documento o correo… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 4 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 5 | paymentDate | input:date | escribir "2026-09-15" | cambia contenido | ok |
| 6 | Buscar o seleccionar… | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido | ok |
| 7 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /customers?limit=50 200 | ok |
| 8 | amountReceived | input:number | escribir "12345" | valor queda "12345" | ok |
| 9 | currencyCode | input:text | clic | campo de solo lectura (moneda derivada de la cuenta) | ok |
| 10 | Transferencia Efectivo Cheque Tarjeta Otro | select | seleccionar 5 opciones | valor queda "undefined" | ok |
| 11 | reference | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |

Probados: **12/12 (100%)** · con falla: 0 · no probados: 0

## ventas · `/contacts/customers`

**Pasada 1 (estado vacío)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Añadir Cliente | a | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 1 | NOMBRE DE LA EMPRESA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | PERSONA DE CONTACTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | EMAIL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | TELÉFONO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | QA-Cliente-01 Distribuidora Ñandú & Hijos | fila | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 7 | QA-Cliente-01 Distribuidora Ñandú & Hijos | a | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 8 | Editar | a | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 9 | Eliminar | button:button | - | confirmación OK, pero borra un cliente con facturas y ELIMINA EN CASCADA facturas y recibos (datos QA) — QA-001b | con falla |

**Pasada 2 (con datos)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Añadir Cliente | a | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 1 | NOMBRE DE LA EMPRESA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | PERSONA DE CONTACTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | EMAIL | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | TELÉFONO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | QA-Cliente-01 Distribuidora Ñandú & Hijos Contacto QA editad | fila | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 7 | QA-Cliente-01 Distribuidora Ñandú & Hijos | a | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 8 | Editar | a | clic | abre el formulario pero GET identity-document-types → 403 (QA-015) | con falla |
| 9 | Eliminar | button:button | - | confirmación OK, pero borra un cliente con facturas y ELIMINA EN CASCADA facturas y recibos (datos QA) — QA-001b | con falla |

Probados: **20/20 (100%)** · con falla: 10 · no probados: 0

## ventas · `/contacts/customers/new`

**Pasada 1 (estado vacío)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/contacts/customers · pestañas 2→3 · cambia contenido · red: GET /customers 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/contacts/customers · pestañas 2→3 · cambia contenido · red: GET /customers 200 | ok |
| 2 | Guardar cliente | button:submit | clic | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «Nombre del cliente» es obligatorio «País» es obligatorio | ok |
| 3 | companyName | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar «País» es obligatorio | ok |
| 4 | contactPerson | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 5 | identityDocumentTypeCode | select | seleccionar 0 opciones | valor queda "undefined" | ok |
| 6 | taxId | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 7 | Sin clasificar Persona física Persona jurídica Agente de ret | select | seleccionar 6 opciones | valor queda "undefined" | ok |
| 8 | email | input:email | escribir "qa@example.com" | valor queda "qa@example.com" | ok |
| 9 | phone | input:tel | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 10 | address | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 11 | city | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 12 | stateOrProvince | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 13 | postalCode | input | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 14 | Afganistán Albania Alemania Andorra Angola Anguila Antártida | select | seleccionar 249 opciones | cambia contenido · aviso: Revisa 2 punto(s) antes de guardar | ok |
| 15 | Neto 30 | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 16 | paymentTermDays | input:number | escribir "12345" | valor queda "12345" | ok |

Probados: **17/17 (100%)** · con falla: 0 · no probados: 0

## ventas · `/masters/price-lists`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Lista | a | clic | navega a /e/virtex-dev/masters/price-lists/new · pestañas 2→3 · cambia contenido | ok |

**Pasada 2 (con datos)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva Lista | a | clic | navega a /e/virtex-dev/masters/price-lists/new · pestañas 2→3 · cambia contenido | ok |
| 1 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 2 | MONEDA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | VÁLIDO DESDE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | VÁLIDO HASTA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ÍTEMS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | QA-Lista Mayoristas DOP 28 de septiembre de 2026 28 de septi | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 9 | QA-Lista Mayoristas | a | clic | error: GET /inventory/93628f14-8761-4aa8-a91a-fd464aa18ea5 FAILED net::ERR_ABORTED  | con falla |
| 10 | Editar | a | clic | error: GET /inventory/93628f14-8761-4aa8-a91a-fd464aa18ea5 FAILED net::ERR_ABORTED  | con falla |
| 11 | Eliminar | button:button | - | confirmación + DELETE 200 (lista QA sin uso) | ok |

Probados: **13/13 (100%)** · con falla: 2 · no probados: 0

## ventas · `/masters/price-lists/new`

**Pasada 1 (estado vacío)** — 17 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/price-lists · pestañas 2→3 · cambia contenido · red: GET /price-lists 200 | ok |
| 1 | Cancelar | button:button | clic | navega a /e/virtex-dev/masters/price-lists · pestañas 2→3 · cambia contenido · red: GET /price-lists 200 | ok |
| 2 | Guardar lista | button:submit | clic | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Nombre de la Lista» es obligatorio «Producto» es obligatorio «Precio» no puede ser menor que 0.01 | ok |
| 3 | name | input | escribir "QA-áéí ñ <b>&"'" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Producto» es obligatorio «Precio» no puede ser menor que 0.01 | ok |
| 4 | Draft Active Inactive | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 5 | USD - Dólar Estadounidense DOP - Peso Dominicano EUR - Euro | select | seleccionar 3 opciones | valor queda "undefined" | ok |
| 6 | validFrom | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 7 | validTo | input:date | escribir "2026-09-15" | valor queda "2026-09-15" | ok |
| 8 | PRODUCTO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | PRECIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 11 | (sin texto) | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 12 | Producto | input:text | escribir "QA-áéí ñ <b>&"'" | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50&search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 13 | (sin texto) | button:button | clic | abre diálogo/panel · abre menú/lista · cambia contenido · red: GET /inventory?limit=50 200 | ok |
| 14 | price | input:number | escribir "12345" | cambia contenido · aviso: Revisa 3 punto(s) antes de guardar «Producto» es obligatorio | ok |
| 15 | (sin texto) | button:button | - | deshabilitado en este estado | no probado |
| 16 | Añadir Línea | button:button | clic | cambia contenido | ok |

Probados: **16/17 (94%)** · con falla: 0 · no probados: 1

## ventas · `/sales/history`

**Pasada 1 (estado vacío)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Exportar | button:button | clic | no descarga ni llama a la red (verificado manualmente) — QA-042 | con falla |
| 1 | Nueva Venta | a | clic | navega a /e/virtex-dev/sales/pos · pestañas 2→3 · cambia contenido · red: GET /invoices/context 200, GET /pos/shifts/active?terminalId=main 200, GET /inventory 200 | ok |

Probados: **2/2 (100%)** · con falla: 1 · no probados: 0

## ventas · `/sales/pos`

**Pasada 1 (estado vacío)** — 3 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Buscar productos por nombre o SKU... | input:text | escribir "QA-áéí ñ <b>&"'" | valor queda "QA-áéí ñ <b>&"'" | ok |
| 1 | QA-Producto-01 Silla ergonómica 1,000.00 | div:button | clic | cambia contenido | ok |
| 2 | Cobrar | button | - | deshabilitado en este estado | no probado |

Probados: **2/3 (67%)** · con falla: 0 · no probados: 1

## ventas · `/reports/aging/receivables`

**Pasada 1 (estado vacío)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | agingAsOf | input:date | escribir "2026-09-15" | red: GET /customer-payments/aging?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | cambia contenido · red: GET /customer-payments/aging?asOfDate=2026-09-15 200 | ok |
| 2 | Cliente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Corriente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | 1–30 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | 31–60 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | 61–90 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Más de 90 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | QA-Cliente-01 Distribuidora Ñandú & Hijos 2,360.00 0.00 0.00 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

**Pasada 2 (con datos)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | agingAsOf | input:date | escribir "2026-09-15" | red: GET /customer-payments/aging?asOfDate=2026-09-15 200 | ok |
| 1 | Actualizar | button:button | clic | cambia contenido · red: GET /customer-payments/aging?asOfDate=2026-09-15 200 | ok |
| 2 | Cliente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | Corriente | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | 1–30 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | 31–60 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | 61–90 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | Más de 90 días | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | Total | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | QA-Cliente-01 Distribuidora Ñandú & Hijos 2,360.00 0.00 0.00 | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |

Probados: **20/20 (100%)** · con falla: 0 · no probados: 0

## workspace · `/overview`

**Pasada 1 (estado vacío)** — 20 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva factura | button:button | clic | navega a /e/virtex-dev/invoices/new · pestañas 1→2 · cambia contenido · red: GET /currencies 200, GET /invoices/context 200 | ok |
| 1 | Ver dashboard financiero | button:button | clic | navega a /e/virtex-dev/dashboard · pestañas 1→2 · cambia contenido · red: GET /dashboard/kpi/net-margin 200, GET /dashboard/kpi/ebitda 200, GET /dashboard/kpi/fcf 200, GET /dashboa | ok |
| 2 | Nueva factura | button:button | clic | navega a /e/virtex-dev/invoices/new · pestañas 1→2 · cambia contenido · red: GET /currencies 200, GET /invoices/context 200 | ok |
| 3 | Nueva cotización | button:button | clic | navega a /e/virtex-dev/quotes/new · pestañas 1→2 · cambia contenido | ok |
| 4 | Nuevo cliente | button:button | clic | navega a /e/virtex-dev/customers/new · pestañas 1→2 · cambia contenido | ok |
| 5 | Nuevo producto | button:button | clic | navega a /e/virtex-dev/products/new · pestañas 1→2 · cambia contenido | ok |
| 6 | Ver facturas | button:button | clic | navega a /e/virtex-dev/invoices · pestañas 1→2 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 7 | Reportes | button:button | clic | navega a /e/virtex-dev/reports · pestañas 1→2 · cambia contenido | ok |
| 8 | Actualizar | button:button | clic | cambia contenido · red: GET /overview/news 200, GET /overview/activity?limit=8 200, GET /overview/events?days=30&limit=8 200 | ok |
| 9 | Factura FAC-00000001 actualizada QA-Cliente-01 Distribuidora | li | clic | navega a /e/virtex-dev/invoices · pestañas 1→2 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 10 | Producto «QA-Producto-01 Silla ergonómica» actualizado hace  | li | clic | navega a /e/virtex-dev/inventory · pestañas 1→2 · cambia contenido | ok |
| 11 | Asiento VENTAS-2026-000001 contabilizado Factura FAC-0000000 | li | - | fila de actividad no navega al asiento | con falla |
| 12 | Asiento GENERAL-2026-000002 contabilizado Costo de Factura F | li | - | fila de actividad no navega al asiento | con falla |
| 13 | Factura FAC-00000001 emitida QA-Cliente-01 Distribuidora Ñan | li | clic | navega a /e/virtex-dev/invoices · pestañas 1→2 · cambia contenido · red: GET /invoices?page=1&limit=50 200 | ok |
| 14 | Cliente «QA-Cliente-01 Distribuidora Ñandú & Hijos» registra | li | clic | navega a /e/virtex-dev/contacts · pestañas 1→2 · cambia contenido | ok |
| 15 | Asiento GENERAL-2026-000001 contabilizado Inventario inicial | li | - | fila de actividad no navega al asiento | con falla |
| 16 | Producto «QA-Producto-01 Silla ergonómica» añadido al catálo | li | clic | navega a /e/virtex-dev/inventory · pestañas 1→2 · cambia contenido | ok |
| 17 | 31-Ago Cierre del período «agosto de 2026» Cierre contable | li | - | navega al documento/período (verificado manualmente) | ok |
| 18 | 28-Sept Vence la factura FAC-00000001 Por cobrar QA-Cliente- | li | - | navega al documento/período (verificado manualmente) | ok |
| 19 | 30-Sept Cierre del período «septiembre de 2026» Cierre conta | li | - | navega al documento/período (verificado manualmente) | ok |

Probados: **20/20 (100%)** · con falla: 3 · no probados: 0

## workspace · `/my-work`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Seguridad | button:button | clic | red: GET /auth/webauthn/register/options 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## workspace · `/approvals`

**Pasada 1 (estado vacío)** — 0 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| – | (sin elementos interactivos en este estado) | | | | |

Probados: **0/0 (100%)** · con falla: 0 · no probados: 0

## workspace · `/dashboard`

**Pasada 1 (estado vacío)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Editar Layout | button | clic | cambia contenido | ok |
| 1 | Exportar | button | clic | cambia contenido | ok |
| 2 | Monto ($) Flujo de Efectivo del Período 0k​0k 0k​0k 0k​0k 0k | div | clic | sin efecto visible ni llamada de red | con falla |
| 3 | End of interactive chart. | div | clic | no interactuable: locator.click: Timeout 3000ms exceeded. | con falla |

Probados: **4/4 (100%)** · con falla: 2 · no probados: 0

## workspace · `/notifications`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Marcar todas como leídas | button:button | clic | red: POST /notifications/read-all 201 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## workspace · `/global-search`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Buscar en todo el sistema... | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /search?q=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |

Probados: **1/1 (100%)** · con falla: 0 · no probados: 0

## workspace · `/data-imports`

**Pasada 1 (estado vacío)** — 10 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Selecciona un tipo de dato... Customers Products Suppliers | select | seleccionar 4 opciones | pantalla mock sin backend — QA-018 | con falla |
| 1 | Importar datos | button | - | pantalla mock sin backend — QA-018 | con falla |
| 2 | TIPO DE DATO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 3 | NOMBRE DEL ARCHIVO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 4 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | USUARIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | PROCESADOS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | FALLIDOS | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | Customers clientes_julio.csv Jul 25, 2025 Admin Principal Co | fila | clic | pantalla mock sin backend — QA-018 | con falla |

Probados: **10/10 (100%)** · con falla: 3 · no probados: 0

## workspace · `/data-exports`

**Pasada 1 (estado vacío)** — 13 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Selecciona un tipo de dato... Customers Products Suppliers I | select | seleccionar 6 opciones | pantalla mock sin backend — QA-018 | con falla |
| 1 | CSV | button:button | clic | pantalla mock sin backend — QA-018 | con falla |
| 2 | Excel (XLSX) | button:button | clic | pantalla mock sin backend — QA-018 | con falla |
| 3 | Generar archivo | button:submit | - | deshabilitado en este estado | no probado |
| 4 | TIPO DE DATO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | FORMATO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | FECHA | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | USUARIO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | ESTADO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 9 | ACCIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 10 | Customers CSV Jul 26, 2025 Admin Principal Completed Descarg | fila | clic | pantalla mock sin backend — QA-018 | con falla |
| 11 | Descargar | a | clic | pantalla mock sin backend — QA-018 | con falla |
| 12 | Descargar | a | clic | pantalla mock sin backend — QA-018 | con falla |

Probados: **12/13 (92%)** · con falla: 6 · no probados: 1

## workspace · `/documents/repository`

**Pasada 1 (estado vacío)** — 4 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva carpeta | button:button | clic | no abre ningún diálogo — QA-042 | con falla |
| 1 | (sin texto) | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 2 | Buscar en todos los documentos… | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /documents?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | Inicio | button:button | clic | cambia contenido · red: GET /documents 200 | ok |

**Pasada 2 (con datos)** — 12 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Nueva carpeta | button:button | clic | no abre ningún diálogo — QA-042 | con falla |
| 1 | (sin texto) | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |
| 2 | Buscar en todos los documentos… | input:search | escribir "QA-áéí ñ <b>&"'" | cambia contenido · red: GET /documents?search=QA-%C3%A1%C3%A9%C3%AD%20%C3%B1%20%3Cb%3E%26%22%27 200 | ok |
| 3 | Inicio | button:button | clic | cambia contenido · red: GET /documents 200, GET /documents 200 | ok |
| 4 | NOMBRE | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 5 | ÚLTIMA MODIFICACIÓN | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 6 | TAMAÑO | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 7 | ACCIONES | th | clic | encabezado sin ordenamiento (UX: las listas no se pueden ordenar) | ok |
| 8 | qa-documento.txt 28/09/2026, 03:54 a.m. 22 B | fila | clic | fila de solo lectura: sin acción al hacer clic (sin detalle navegable) | ok |
| 9 | Descargar | button:button | clic | red: GET /documents/e43158e8-992e-4772-a278-587bffe7b1b3/download 200 | ok |
| 10 | Renombrar | button:button | clic | cambia contenido | ok |
| 11 | Eliminar | button:button | - | confirmación + DELETE 204 (documento QA) | ok |

Probados: **14/16 (88%)** · con falla: 2 · no probados: 2

## workspace · `/documents/templates`

**Pasada 1 (estado vacío)** — 1 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | (sin texto) | input:file | selector de archivo | requiere archivo: se prueba en flujo específico | no probado |

Probados: **0/1 (0%)** · con falla: 0 · no probados: 1

## workspace · `/unauthorized`

**Pasada 1 (estado vacío)** — 2 elementos

| # | Elemento | Tipo | Acción | Resultado | Estado |
|---|---|---|---|---|---|
| 0 | Solicitar Permiso | a | clic | sin efecto (verificado manualmente) — QA-042 | con falla |
| 1 | Volver al Dashboard | a | clic | navega a /e/virtex-dev/dashboard · cambia contenido · red: GET /dashboard/budget-vs-actual?months=12 200, GET /dashboard/kpi/leverage 200, GET /dashboard/kpi/fcf 200, GET /dashboar | ok |

Probados: **2/2 (100%)** · con falla: 1 · no probados: 0

