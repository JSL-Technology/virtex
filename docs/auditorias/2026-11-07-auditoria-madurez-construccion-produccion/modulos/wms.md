# Ficha — `wms` (frontend `features/wms` + backend `/wms` en supply-chain)

Familia INV · 2026-11-07. El backend `/wms` pertenece a supply-chain (familia CMP); aquí se evalúa lo que promete el «WMS».

## 1. Identificación

- **Frontend**: `features/wms/pages/dashboard.component.ts` (38 líneas). Es un panel de hoja de ruta («próximamente»: inventario en tiempo real, costos de importación). **No está enrutado**: grep de `WmsDashboard` y `features/wms` → solo su propia definición.
- **Backend**: `apps/backend/api/src/app/supply-chain/supply-chain.controller.ts` → `@Controller('wms')` con:
  - `warehouses` (CRUD; `wms:view` / `wms:manage`);
  - `bin-locations` (CRUD);
  - `landed-costs` (CRUD).

  El backend de supply-chain suma 454 líneas.
- **Tablas**: `warehouses`, `bin_locations`, `landed_costs`.
- **Menú**: «Almacenes» aparece en la configuración de inventario (`inventario.manifest.ts`, ruta `warehouses`, permiso `inventory:view_stock`).

## 2. Estándar de referencia (confianza media)

- **Básicas de un WMS**: ubicaciones (bins) **con existencias por ubicación**; recepción y ubicación (put-away); picking, packing y despacho; olas; conteo cíclico por ubicación; reabastecimiento de picking; trazabilidad por lote; escáner móvil.
- **Landed cost**: prorratear flete, arancel y seguro sobre el costo de los artículos recibidos.
- **Líderes**: Odoo Inventory (rutas, bins, landed cost; confianza alta); NetSuite WMS (confianza alta); SAP B1 bins (confianza alta).

## 3. Resultado

- **Madurez: 20 (12–28, confianza alta)**. Los almacenes funcionan y los usa el ledger. Bins y landed costs son CRUD aislados sin efecto: el «WMS» como producto no existe.
- **Preparación comercial: 15. Veredicto: No listo.**
- **Eje más débil**: 1. **Críticos**: ninguno, porque bins y landed cost no se presentan en la UI.

## 4. Ejes

| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 15 (10–22, alta) | Almacenes: `POST /wms/warehouses` → 201 («QA-INV Almacén 2»), usado después en transferencias y existencias ✔. **`BinLocation` y `LandedCost` solo se referencian dentro de supply-chain** (grep `LandedCost\|BinLocation` fuera de dto, entities, service y controller → 0): `stock_levels` no tiene ubicación y el costo de importación no entra en `product.cost`. Las únicas «absorciones» de costo están en accounts-payable/inventory (`absorbReceivedCostDifference`), sin relación con `landed_costs`. La UI WMS es una hoja de ruta huérfana. | Existencias por bin, put-away y picking, landed cost prorrateado al recibir. |
| 2 | 35 (25–45, media) | El almacén por defecto es único por índice; se crea perezosamente con savepoint ante carreras (`stock-ledger.service.ts`, `defaultWarehouse`). Landed costs sin efecto contable más allá de su `gl_account_id`. | — |
| 3 | N/A | — | — |
| 4 | 40 (30–50, media) | Controlador `wms` dentro de supply-chain, mientras las existencias las escribe inventory: tres módulos para un mismo concepto. | Un único dueño (inventario/almacenes). |
| 5 | 35 (25–45, media) | Las entidades `Warehouse`, `StockLevel` y `StockMovement` viven en supply-chain y las escribe inventory. | — |
| 6 | 60 (50–68, baja) | No medido a fondo. | — |
| 7 | 55 (45–62, baja) | `GET /wms/warehouses` sin paginación (volumen bajo). | — |
| 8 | 80 (72–86, media) | Member: POST y PATCH /wms/warehouses → 403 (ejecutado). `GET /wms/warehouses/<id de qa-do-inv>` desde `qa-do-a` → 404 `wms.warehouse_not_found`; las transferencias y ajustes con almacén ajeno → 400. | — |
| 9 | 40 (30–50, media) | Solo `warehouse-lifecycle.spec.ts`. | — |
| 10 | 45 (35–55, baja) | `audit_logs` registra `warehouses` CREATE. | — |
| 11 | 20 (10–30, media) | La pantalla de almacenes existe en el manifiesto; en Playwright, `/e/<slug>/inventory/warehouses` no mostró el contenido de inventario (otra ruta base, no profundizado). No hay pantallas de bins ni de landed cost. | — |
| 12 | 10 (5–18, alta) | Sin WMS frente a Odoo y NetSuite. | — |

## 5. Compuertas

| Compuerta | Estado |
|---|---|
| 1 | **No cumple** (bins y landed cost son fachada en el backend). |
| 2 | Parcial. |
| 3 | Cumple con reserva. |
| 4–12 | Parcial o no verificado; ver ejes. |

## 6. Hallazgos

- **INV-23** — wms/supply-chain · eje 1 · **Categoría**: funcionalidad falsa · **Severidad: alta**
  - **Ubicación**: `supply-chain/supply-chain.controller.ts:77-140`, `supply-chain.service.ts`.
  - **Qué está mal**: los endpoints de bin-locations y landed-costs persisten registros que **ningún proceso usa**. Ni las existencias ni el costo cambian. Un integrador de la API creería que hay gestión por ubicación y prorrateo de importación.
  - **Forma correcta**: ligar el bin a `stock_levels` y `stock_movements` (o retirar los endpoints), y aplicar el landed cost en la recepción con revaluación por el ledger.
  - **Impacto**: brecha competitiva y riesgo de expectativa falsa.
  - **Esfuerzo**: L.
- **INV-22** (compartido con manufacturing): hoja de ruta WMS no enrutada (código muerto), **baja**, S.

## 7. Camino mínimo

1. Decidir el alcance: retirar o ocultar bins y landed costs, o implementarlos (S para retirar / L para implementar).
2. Consolidar los almacenes bajo inventario (M).

## 8. Camino a 100

| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Existencias por ubicación | +20 | L |
| Landed cost en la recepción | +15 | L |
| Put-away, picking y packing con escáner móvil | +25 | XL |
| Conteo cíclico | +5 | M |
| Rutas y olas | +10 | XL |

## 9. Competitividad

Sin WMS. Los líderes locales (Alegra, Siigo) tampoco tienen WMS completo, pero sí bodegas y costos de importación básicos (confianza media).

## 10. Fortalezas

- Almacenes multi-sucursal con uno por defecto y creación segura ante carreras.
- Aislamiento correcto.

## 11. No verificado

- La UI de almacenes a fondo.
- Probar los CRUD de bins y landed costs (no ejecutado: se confirmó por código que no tienen efecto).
