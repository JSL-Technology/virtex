# Insumo — Prueba de humo de UI (familia FE)

Fecha: 2026-11-07/08. Portal dev `http://localhost:4200`, API `:3000` (NODE_ENV=development). Navegador: Chromium headless (Playwright global `/opt/node22/lib/node_modules/playwright`).
Script único: `/tmp/claude-0/-home-user-virtex/18f6e197-474f-5038-b8e5-f1d402f375bd/scratchpad/agents/fe/smoke.cjs` (rutas extraídas de los 8 manifiestos por `routes.mjs` → `routes.json`: **155 rutas declaradas**, 119 sin parámetros, 77 con entrada de menú). Resultados crudos: `full-a.json`, `settings-a.json`, `member.json`, `en.json`, `pt390.json` en esa carpeta.

Método por ruta: login real en `/es/auth/login`; `goto http://localhost:4200/<ruta>` (el guard de empresa la reescribe a `/e/<slug>/<ruta>`); espera `networkidle` (≤12 s) + 1,2 s; se capturan errores de consola, `pageerror`, respuestas `/api/` ≥400, URL final, título del panel activo de Dockview (o del diálogo), longitud de texto, claves tipo `xxx.yyy_zzz` en el DOM, palabras inglesas comunes en es/pt, scroll horizontal.

## Resumen
| Pasada | Usuario | Idioma / ancho | Rutas | Resultado |
|---|---|---|---|---|
| Completa | qa-do-a (ADMINISTRATOR) | es / 1440 | 119 rutas sin parámetro + 27 secciones de Settings | **0 errores JS, 0 HTTP 5xx, 0 claves sin resolver, 0 mezcla de idioma detectada**. 11 rutas + 3 secciones con 403 por funciones de plan no contratadas (IA, cobranza IA, SSO) |
| Muestra sin permiso | qa-do-a-member (invoices:view, products:view) | es / 1440 | 13 | 8 rutas → `/unauthorized` "Acceso denegado" (correcto); `invoices` carga pero llama `GET /accounting/current-period` → 403; `overview` dispara **13 peticiones 403** (`/dashboard/kpi/*`, `/dashboard/alerts`, `/accounting/current-period`) y errores de consola `ERROR HttpErrorResponse`, `Error fetching cash flow data` |
| Muestra en inglés | qa-do-xflow (preferredLanguage=en, revertido a es) | en / 1440 | 10 | Títulos en inglés, 0 claves, 0 errores |
| Muestra en portugués móvil | qa-do-xflow (pt, revertido) | pt / **390 px** | 10 | Títulos en pt, 0 claves, 0 errores, **sin scroll horizontal** en las 10 |

Notas de método y hallazgos de navegación:
- **El prefijo de idioma en rutas autenticadas se pierde**: `/es/invoices`, `/es/e/qa-do-a-srl/invoices` y `/en/e/qa-do-a-srl/invoices` aterrizan en `/e/qa-do-a-srl/overview` (con la pestaña abierta detrás, pero el panel activo es Inicio); `/en/...` no cambia el idioma (sigue `lang=es`). El idioma de la sesión autenticada sale solo de `preferredLanguage` del usuario (`core/services/language.ts:182`). Por eso las pasadas en/pt se hicieron cambiando la preferencia del usuario de qa-do-xflow (revertida).
- **Enlace directo a Settings roto**: `/settings/<sección>` (o `/e/<org>/settings/<sección>`) abre siempre la sección inexistente `#settings/e`: `core/guards/settings-modal-redirect.guard.ts:12-13` quita `^/settings` pero la URL real es `/e/<org>/settings/...`, así que toma la `e` del prefijo de empresa. Verificado en las 27 secciones (todas → `overview#settings/e`). Las secciones sí abren con el fragmento `#settings/<id>`.
- Rutas con parámetro (36) no se recorrieron por URL directa (requieren id existente): ver lista al final.
- Funciones fuera de plan: la página se muestra en el menú, carga su cabecera y luego enseña el identificador técnico: «La función **ai_collections** no está incluida en tu plan.» + botón «Reintentar» (sin sentido: reintentar no cambia el plan). Igual en `inventory/predictions` («ai_forecasting»).
- En cada carga de `overview` como administrador: `GET /ai/copilot/charts/pinned` → 403 `saas.feature_disabled` (ai_assistant) → error de consola en todas las páginas (excluido de la tabla para no repetirlo).
- Heurística: "OK" significa sin error JS, sin HTTP ≥400 y sin claves; NO valida datos de negocio. Los inquilinos están casi vacíos, por lo que la mayoría de listados muestran estado vacío (longitud de texto 50–600).

## Tabla completa (qa-do-a, es, 1440 px)
| Ruta | Permiso | Resultado | Título | HTTP ≥400 (excl. pinned) | Claves sin resolver |
|---|---|---|---|---|---|
| reports/ | - | OK (redirige a reports) | Reportes | — | — |
| reports/data-quality | - | OK | Calidad de datos | — | — |
| reports/manager-report | ai_reports:view | Carga con 4xx | Informe del gerente | 403 GET /ai/reports/manager | — |
| reports/anomalies | ai_anomalies:view | Carga con 4xx | Anomalías | 403 GET /ai/anomalies/last-run; 403 GET /ai/anomalies?status=OPEN&limit=25&offset=0 | — |
| reports/profitability-by-product | reports:view_sales | OK | Rentabilidad por producto | — | — |
| reports/profitability-by-customer | reports:view_sales | OK | Rentabilidad por cliente | — | — |
| reports/relationship-map | relationship_map:view | OK | Mapa de relaciones | — | — |
| datasheets/ | datasheets:view | OK (redirige a datasheets) | DataSheets | — | — |
| accounts-payable | accounts_payable:view | OK | Facturas de proveedor | — | — |
| accounts-payable/new | accounts_payable:create | OK | Nueva factura de proveedor | — | — |
| accounts-payable/payments | accounts_payable:view | OK | Pagos a proveedores | — | — |
| accounts-payable/payments/new | accounts_payable:pay | OK | Pagar facturas de proveedor | — | — |
| accounts-payable/debit-notes | accounts_payable:view | OK | Notas de débito a proveedores | — | — |
| accounts-payable/debit-notes/new | accounts_payable:create | OK | Nueva nota de débito | — | — |
| contacts/suppliers | suppliers:view | OK | Proveedores | — | — |
| contacts/suppliers/new | suppliers:create | OK | Nuevo proveedor | — | — |
| purchasing/orders | procurement:view | OK | Órdenes de compra | — | — |
| purchasing/orders/new | procurement:manage | OK | Nueva orden | — | — |
| purchasing/receipts | procurement:view | OK | Recepciones de mercancía | — | — |
| purchasing/receipts/new | procurement:manage | OK | Nueva recepción | — | — |
| purchasing/requisitions | procurement:view | OK | Requisiciones de compra | — | — |
| purchasing/requisitions/new | procurement:manage | OK | Nueva requisición | — | — |
| reports/aging/payables | accounts_payable:view | OK | Antigüedad de cuentas por pagar | — | — |
| accounting/chart-of-accounts | coa:view | OK | Catálogo de cuentas | — | — |
| accounting/chart-of-accounts/segments-configuration | coa:edit | OK | Configuración de segmentos | — | — |
| accounting/chart-of-accounts/merge | coa:merge | OK | Fusionar cuentas | — | — |
| accounting/chart-of-accounts/new | coa:create | OK | Nueva cuenta contable | — | — |
| accounting/journal-entries | journal_entries:view | OK | Asientos contables | — | — |
| accounting/journal-entries/new | journal_entries:create | OK | Nuevo asiento contable | — | — |
| accounting/journal-entries/import | journal_entries:create | OK | Importar asientos contables | — | — |
| accounting/daily-journal | journal_entries:view | OK | Libro diario | — | — |
| accounting/general-ledger | accounting:view | OK | Libro mayor | — | — |
| accounting/ledgers/new | accounting:manage_ledgers | OK | Nuevo libro mayor | — | — |
| accounting/partner-ledger | accounting:view | OK | Mayor de terceros | — | — |
| accounting/subsidiary-ledgers | accounting:view | OK (redirige a accounting/partner-ledger) | Mayor de terceros | — | — |
| accounting/recurring-entries | journal_entries:view | OK | Asientos recurrentes | — | — |
| accounting/recurring-entries/new | journal_entries:create | OK | Nuevo asiento recurrente | — | — |
| accounting/entry-templates | journal_entries:view | OK | Plantillas de asiento | — | — |
| accounting/entry-templates/new | journal_entries:create | OK | Nueva plantilla de asiento | — | — |
| accounting/dimensions | dimensions:view | OK | Dimensiones analíticas | — | — |
| accounting/ledgers | accounting:manage_ledgers | OK | Libros contables | — | — |
| accounting/journals | journal_entries:view | OK | Diarios | — | — |
| accounting/journals/new | journal_entries:create | OK | Nuevo diario | — | — |
| accounting/periods | accounting:view | OK | Períodos contables | — | — |
| accounting/fixed-assets | fixed_assets:view | OK | Activos fijos | — | — |
| accounting/fixed-assets/new | fixed_assets:manage | OK | Nuevo activo fijo | — | — |
| accounting/fixed-assets/depreciation | fixed_assets:view | OK | Ejecutar depreciación | — | — |
| accounting/budgets | budgets:view | OK | Presupuestos | — | — |
| accounting/budgets/new | budgets:manage | OK | Nuevo presupuesto | — | — |
| accounting/variance-analysis | budgets:view | OK | Análisis de variaciones | — | — |
| accounting/closing/annual-close | accounting:close_year | OK | Cierre anual | — | — |
| accounting/audit-adjustments | audit:view_trail | OK | Ajustes de auditoría | — | — |
| accounting/audit-adjustments/new | audit:propose_adjustment | OK | Nuevo ajuste de auditoría | — | — |
| accounting/closing/checklist | accounting:view | OK | Cierre de período | — | — |
| reports/financial-statements/balance-sheet | reports:view_financial | OK | Balance general | — | — |
| reports/financial-statements/income-statement | reports:view_financial | OK | Estado de resultados | — | — |
| reports/financial-statements/trial-balance | reports:view_financial | OK | Balanza de comprobación | — | — |
| reports/financial-statements/cash-flow | reports:view_financial | OK | Estado de flujo de efectivo | — | — |
| reports/fiscal-returns | reports:view_financial | OK | Declaraciones fiscales | — | — |
| masters/taxes | taxes:view | OK | Tasas de impuesto | — | — |
| masters/taxes/new | taxes:create | OK | Nuevo impuesto | — | — |
| masters/currencies | currencies:view | OK | Monedas | — | — |
| masters/currencies/exchange-rates | currencies:view | OK | Tipos de cambio | — | — |
| masters/payment-terms | treasury:view | OK | Condiciones de pago | — | — |
| inventory/products | products:view | OK | Productos | — | — |
| inventory/products/new | products:create | OK | Nuevo producto | — | — |
| inventory/predictions | ai_forecasts:view | Carga con 4xx | Predicciones de demanda | 403 GET /ai/forecasts/supplier-lead-times; 403 GET /ai/forecasts/summary; 403 GET /ai/forecasts/insights?sort=risk&limit=50&offset=0; 403 GET /ai/forecasts/top-by-branch?perBranch=5 | — |
| inventory/stock | inventory:view_stock | OK | Existencias | — | — |
| inventory/movements | inventory:view_stock | OK | Kárdex de inventario | — | — |
| inventory/kardex | inventory:view_stock | OK (redirige a inventory/movements) | Kárdex de inventario | — | — |
| inventory/adjustments | inventory:view_stock | OK | Ajustes de inventario | — | — |
| inventory/adjustments/new | inventory:adjust | OK | Nuevo ajuste | — | — |
| inventory/transfers | inventory:view_stock | OK | Transferencias de inventario | — | — |
| inventory/transfers/new | inventory:transfer | OK | Nueva transferencia | — | — |
| inventory/categories | products:view | OK | Categorías | — | — |
| masters/warehouses | inventory:view_stock | OK | Almacenes | — | — |
| masters/units-of-measure | units_of_measure:view | OK | Unidades de medida | — | — |
| payroll/my-payslips | payroll:view_own | OK | Mis volantes de pago | — | — |
| payroll/runs | payroll:view | OK | Nóminas | — | — |
| hcm/employees | hcm:view | OK | Empleados | — | — |
| hcm/employees/new | hcm:manage | OK | Nuevo empleado | — | — |
| hcm/departments | hcm:view | OK | Departamentos | — | — |
| payroll/concepts | payroll:view | OK | Conceptos de nómina | — | — |
| payroll/parameters | payroll:view | OK | Parámetros de ley | — | — |
| accounting/treasury | treasury:view | OK | Posición de efectivo | — | — |
| accounting/treasury/cash-flow | ai_cashflow:view | Carga con 4xx | Flujo de caja proyectado | 403 GET /ai/cashflow/plan; 403 GET /ai/cashflow | — |
| accounting/treasury/bank-accounts/new | treasury:manage_accounts | OK | Nueva cuenta bancaria | — | — |
| accounting/reconciliation/import | reconciliation:import | OK | Importar estado de cuenta | — | — |
| accounting/reconciliation | reconciliation:view | OK | Conciliación bancaria | — | — |
| masters/banks | treasury:view | OK | Bancos | — | — |
| masters/banks/new | treasury:manage_accounts | OK | Nuevo banco | — | — |
| masters/payment-methods | treasury:view | OK | Formas de pago | — | — |
| invoices | invoices:view | OK | Facturas | — | — |
| invoices/new | invoices:create | OK | Crear factura de venta | — | — |
| quotes | invoices:view | OK | Cotizaciones | — | — |
| quotes/new | invoices:create | OK | Nueva cotización | — | — |
| collections | ai_collections:view | Carga con 4xx | Cobranza | 403 GET /collections/worklist?limit=200 | — |
| customer-receipts | accounts_receivable:view | OK | Recibos de cliente | — | — |
| customer-receipts/new | accounts_receivable:collect | OK | Nuevo recibo | — | — |
| contacts/customers | customers:view | OK | Clientes | — | — |
| contacts/customers/new | customers:create | OK | Nuevo cliente | — | — |
| masters/price-lists | price_lists:view | OK | Listas de precios | — | — |
| masters/price-lists/new | price_lists:create | OK | Nueva lista de precios | — | — |
| sales/history | invoices:view | OK | Tickets de punto de venta | — | — |
| sales/pos | pos:view | OK | Punto de venta | — | — |
| reports/aging/receivables | accounts_receivable:view | OK | Antigüedad de cuentas por cobrar | — | — |
| oauth/consent | ai_copilot:use | Carga con 4xx |  | 403 GET /mcp/oauth/consent | — |
| overview | authenticated | OK | Buenas noches, QA👋 | — | — |
| approvals | workflows:decide | OK | Centro de aprobaciones
2 | — | — |
| workflows | workflow_engine:view | OK | Flujos de trabajo | — | — |
| workflow-instances | workflow_engine:view | OK | Ejecuciones | — | — |
| workflow-tasks | workflow_engine:act | OK | Mis tareas | — | — |
| notifications | authenticated | OK | Notificaciones | — | — |
| global-search | authenticated | OK | Búsqueda | — | — |
| data-imports | settings:edit_company | OK | Importaciones de datos (ETL) | — | — |
| data-exports | settings:edit_company | OK | Exportaciones de datos | — | — |
| documents/repository | documents:view | OK | Repositorio de archivos | — | — |
| extensions/run | extensions:view | OK | Ejecución de extensiones | — | — |
| unauthorized | authenticated | OK | Acceso denegado | — | — |

### Settings (modal, #settings/<id>)
| Sección | Permiso | Resultado | Título | HTTP ≥400 | Claves |
|---|---|---|---|---|---|
| settings/my-profile | - | OK | Configuración | — | — |
| settings/account-security | - | OK | Configuración | — | — |
| settings/preferences | - | OK | Configuración | — | — |
| settings/organizations | - | OK | Configuración | — | — |
| settings/profile | - | OK | Configuración | — | — |
| settings/regional-format | - | OK | Configuración | — | — |
| settings/branding | - | OK | Configuración | — | — |
| settings/subsidiaries | - | OK | Configuración | — | — |
| settings/branches | - | OK | Configuración | — | — |
| settings/smtp | - | OK | Configuración | — | — |
| settings/billing | - | OK | Configuración | — | — |
| settings/default-accounts | - | OK | Configuración | — | — |
| settings/accounting-policies | - | OK | Configuración | — | — |
| settings/fiscal | - | OK | Configuración | — | — |
| settings/einvoicing-regime | - | OK | Configuración | — | — |
| settings/withholding-regimes | - | OK | Configuración | — | — |
| settings/tax-jurisdictions | - | OK | Configuración | — | — |
| settings/sequences | - | OK | Configuración | — | — |
| settings/approvals | - | OK | Configuración | — | — |
| settings/users | - | OK | Configuración | — | — |
| settings/roles | - | OK | Configuración | — | — |
| settings/security | - | OK | Configuración | — | — |
| settings/audit-trail | - | OK | Configuración | — | — |
| settings/sso | - | Carga con 4xx | Configuración | 403 GET /auth/sso/admin/domains; 403 GET /auth/sso/admin/providers | — |
| settings/integrations | - | Carga con 4xx | Configuración | 403 GET /auth/sso/admin/providers | — |
| settings/ai | - | Carga con 4xx | Configuración | 403 GET /procurement/replenishment-agent/settings | — |
| settings/extensions | - | OK | Configuración | — | — |


## Muestra qa-do-a-member (estado sin permiso)
| Ruta | Resultado |
|---|---|
| accounting/chart-of-accounts, accounting/journal-entries, reports/financial-statements/balance-sheet, inventory/stock, payroll/my-payslips, payroll/runs, payroll/concepts, payroll/parameters | → `/unauthorized` «Acceso denegado» (correcto). Nota: `payroll/my-payslips` (autoservicio del empleado) también queda denegado para un miembro sin permiso de nómina |
| invoices | Carga; `GET /accounting/current-period` 403 + error de consola |
| #settings/profile | Muestra el perfil de empresa en solo lectura (sección sin `viewPermission`, `settings-registry.ts:124`); `PATCH /organizations/profile` como miembro → 403 (servidor correcto). La página de fondo (overview) dispara 13 llamadas 403 |
| #settings/fiscal, users, roles | Bloqueo de sección (texto corto, sin datos) |

## Rutas con parámetro no recorridas
reports/relationship-map/:type/:id, datasheets/:id, accounts-payable/payments/:id, accounts-payable/debit-notes/:id, accounts-payable/:id/edit, accounts-payable/:id, contacts/suppliers/:id/edit, purchasing/orders/:id/edit, purchasing/receipts/:id, purchasing/requisitions/:id/edit, accounting/chart-of-accounts/:id/edit, accounting/journal-entries/:id/edit, accounting/ledgers/:id/edit, accounting/general-ledger/:accountId, accounting/recurring-entries/:id, accounting/entry-templates/:id, accounting/journals/:id/edit, accounting/fixed-assets/:id, accounting/fixed-assets/:id/edit, accounting/fixed-assets/:id/dispose, accounting/budgets/:id, accounting/audit-adjustments/:id, inventory/products/:id/edit, inventory/adjustments/:id, inventory/transfers/:id, payroll/runs/:id, hcm/employees/:id/edit, accounting/treasury/bank-accounts/:id/edit, masters/banks/:id/edit, invoices/:id, quotes/:id/edit, contacts/customers/:id/edit, masters/price-lists/:id/edit, ai/proposals/:id, workflows/:id/edit, workflow-instances/:id

## Backend sin pantalla / pantallas sin backend
Método: prefijos de `@Controller('…')` en `apps/backend/api/src` (116) buscados como `/<prefijo>` en `apps/core/client-web/src` y `apps/pos/src`. Sin referencia en ningún cliente (candidatos; verificar construcción dinámica de URLs): `accounting/inflation-adjustment`, `accounting/ledger-mappings`, `analytical-reporting`, `cases`, `chart-of-accounts/import`, `chart-of-accounts/segment-definitions`, `consolidation`, `consolidation/mapping`, `intercompany`, `customer-groups`, `customer-portal`, `journal-entries/adjustments`, `manufacturing`, `projects`, `sales/leads`, `sales/opportunities`, `ai/copilot/my-data` (+ `health`, `.well-known` esperables). Es decir, **consolidación, intercompañía, manufactura, proyectos, CRM (leads/oportunidades), casos/atención y portal de clientes no tienen ninguna pantalla** en el portal.
Pantallas sin backend: ninguna ruta de manifiesto produjo 404 en la API durante la pasada completa (0 respuestas 404); no se detectaron pantallas muertas ni «en construcción».
