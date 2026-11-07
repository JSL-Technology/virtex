# Tablero y vista general (M27) — dashboard, overview, my-work; frontend dashboard/overview

> Sin hallazgos CRÍTICOS de seguridad. Hallazgo de corrección confirmado por otra familia: GL-01.

## 1. Identificación
Backend `dashboard/` (16 archivos, 1 159 LOC, 1 spec de integración; 18 endpoints `GET dashboard/*`: summary, sales-trend, expense-breakdown, budget-vs-actual, invoice-status, top-products, low-stock, alerts, 9 KPI financieros, cash-flow waterfall), `overview/` (4 archivos, 480 LOC, 1 spec; `GET overview/activity|events`), `my-work` (`me/inbox`). Frontend `features/dashboard` (81 archivos, 3 608 LOC, 20+ widgets) embebido en `features/overview/overview.page.ts:24,46`, ruta `overview` (`workspace.manifest.ts:190`). Países N/A. Núcleo: sí (primera pantalla).

## 2. Estándar de referencia
KPIs calculados desde el libro con las mismas reglas que los reportes oficiales (un número, una definición), filtros de período/sucursal/moneda, drill-down al documento, widgets configurables por rol, alertas accionables. Avanzado: tableros personalizables, analítica ad hoc (Power BI, NetSuite SuiteAnalytics Workbook), comparativos y metas. Invariante: el KPI del tablero coincide con el reporte financiero. Confianza media.

## 3. Resultado
Madurez **50** (42–58, media) · Preparación **45 — No listo** (compuerta 5 incumplida: Inicio 403 para admin) · Eje débil: Corrección (GL-01) · Críticos: 0 · Altos: 2.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Autenticidad | 65 (58–70, media) | KPIs por SQL real; valores distintos por tenant: `GET /dashboard/summary` qa-co → `pendingInvoices 1, 26041.19`; qa-b → `2, 798, lowStock 1, outOfStock 1`. `kpi/current-ratio` → 0.18; alertas reales (período abierto). `overview/activity` lista eventos de auditoría reales (factura de proveedor COP 1 190 000). grep `Math.random|mock` en servicios: sólo en specs. | Personalización de widgets; drill-down verificado. |
| 2 Corrección | 42 (35–50, media) | **GL-01 (confirmado)**: el tablero suma asientos `Posted` y `Modified` (`dashboard-charts.service.ts:118`) y los reportes no → el tablero y el estado de resultados divergen. `salesTodayChange: -1` con `salesToday 0` en ambos tenants (posible convención −100 % sin base; verificar). | Una sola fuente de reglas (servicio de reportes) para KPIs; pruebas de cuadre tablero=reporte. |
| 3 Multi-país | N/A (moneda base por tenant) | — | Multimoneda/consolidación no verificada. |
| 4 Arquitectura | 50 | SQL crudo en `dashboard-charts.service.ts` y `dashboard.service.ts` duplicando reglas contables. | Consumir el módulo de reportes/contabilidad vía contrato. |
| 5 Higiene | 48 | Lectura directa de tablas de facturas, asientos, inventario de otros módulos (SQL). | Puertos de lectura por dominio. |
| 6 Calidad | 62 | DTOs por KPI. | — |
| 7 Robustez | 55 | Consultas agregadas; sin caché verificada. | Caché/materialización para tenants grandes. |
| 8 Seguridad | 62 (55–70, media) | `dashboard/*` con `DASHBOARD_VIEW`; `overview/*` sin `@HasPermission` a propósito (`overview.controller.ts:15`), acotado al tenant. | `overview/activity` muestra montos de facturas de proveedor a cualquier usuario autenticado del tenant sin filtrar por permiso del dominio (ver DSH-03). |
| 9 Pruebas | 55 | `dashboard-charts.spec.ts`, `overview.spec.ts` con BD real (se saltan sin DB_HOST). | Prueba tablero = reporte. |
| 10 Operabilidad | 50 | — | — |
| 11 UX | 40 (30–50, media) | F2 observó **403 para ADMINISTRATOR** en Inicio/Cobranza/Predicciones/Reporte gerencial/Anomalías (confirmado por coordinación). | Corregir permisos de rutas; probar en navegador. |
| 12 Competitividad | 45 | 9 KPI financieros + gráficos. | Tableros configurables, analítica ad hoc. |

## 5. Compuertas
1 Cumple (KPIs reales) · **2 No aplica escritura**; corrección de lectura falla (GL-01) · 3 Cumple (estático; datos por organizationId del usuario) · 4 N/A (lectura) · 5 **No cumple** (403 en Inicio para admin, F2) · 6 N/A · 7 Parcial · 8 N/A · 9 Cumple · 10 Parcial · 11 **No cumple** (403) · 12 Parcial.

## 6. Hallazgos
- **DSH-01 (=GL-01)** · dashboard/contabilidad · Eje 2 · Bug/integridad · **Alta** · `dashboard-charts.service.ts:118` · Incluye asientos `Modified` que los reportes excluyen; el KPI no cuadra con el estado de resultados. · Reutilizar el servicio de reportes. · Riesgo de decisión errónea · S/M.
- **DSH-02** · overview/frontend · Eje 11 · UX/autorización · **Alta** · Pantalla Inicio (`/overview`) y otras · 403 para ADMINISTRATOR (observado por F2): la primera pantalla falla. · Alinear permisos de rutas/widgets con el catálogo. · Bloquea la demo · S.
- **DSH-03** · overview · Eje 8 · Seguridad · **Media** · `overview/overview.controller.ts:15-35` · Actividad con montos y contrapartes de todos los dominios visible a cualquier usuario del tenant (sin `@HasPermission` ni filtro por permiso del dominio — verificar en servicio). · Filtrar eventos por permisos de vista del dominio. · S.
- **DSH-04** · dashboard · Eje 4/5 · Arquitectura · **Media** · `dashboard-charts.service.ts`, `dashboard.service.ts` · Reglas contables duplicadas en SQL. · M.

## 7. Camino mínimo
DSH-02 (S) → DSH-01 (S/M) → DSH-03 (S) → prueba de cuadre (S).
## 8. Camino a 100
Fuente única de KPIs (+10, M) · tableros configurables por rol (+8, L) · drill-down y filtros sucursal/moneda (+6, M) · analítica ad hoc (+8, XL).
## 9. Competitividad
Frente a Power BI/SuiteAnalytics: sin analítica ad hoc ni personalización. Nota 45 (38–52, media).
## 10. Fortalezas
Datos reales por tenant, alertas accionables con ruta, bandeja por módulo (`me/inbox` devolvió período vencido y pendiente de compras).
## 11. No verificado
No se crearon documentos para ver variar los KPIs (se comparó entre tenants con datos distintos: varían). UI no ejecutada. Cobertura ~25 % backend, 7 endpoints.

<!-- RESUMEN: modulo=tablero-y-vista-general; madurez=50; prep=45; veredicto=No listo; eje_debil=Corrección / UX; criticos=0; altos=2; camino_min=M -->
