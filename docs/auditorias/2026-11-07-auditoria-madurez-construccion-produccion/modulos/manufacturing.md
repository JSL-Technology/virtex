# Ficha — `manufacturing` (BOM, centros de trabajo, órdenes de producción)

Familia INV · 2026-11-07 · tenant `qa-do-inv`.

## 1. Identificación

- **Backend**: `apps/backend/api/src/app/manufacturing/`, 751 líneas (161 en specs).
  - Archivos: `manufacturing.service.ts` (254), `manufacturing.controller.ts` (185), entidades `production-order` (57), `bill-of-material` (27), `bill-of-material-item` (28), `work-center` (26).
- **Endpoints** (15): CRUD de `/manufacturing/orders`, `/manufacturing/bills-of-materials` y `/manufacturing/work-centers` (`manufacturing:view` / `manufacturing:manage`).
- **Tablas**: `production_orders`, `bill_of_materials`, `bill_of_material_items`, `work_centers`.
- **Frontend**: `features/manufacturing/pages/dashboard.component.ts` (42 líneas). Es un **panel de hoja de ruta, «próximamente»**, y **no está enrutado**: grep de `ManufacturingDashboard` y `features/manufacturing` en las rutas → 0, así que es código muerto.
- **Pruebas**: `manufacturing.service.spec.ts`, `production-order-lifecycle.spec.ts` (pasan).
- **¿Núcleo?** No para el piloto, pero forma parte del alcance de un ERP.

## 2. Estándar de referencia (confianza media, sin verificación web)

- **Básicas**:
  - BOM con versiones y unidades;
  - orden de producción con máquina de estados (planificada → liberada → en proceso → terminada/cerrada);
  - **consumo de componentes** (backflush o emisión manual) que descuenta inventario;
  - **entrada del producto terminado** valorada a costo (materiales + mano de obra + carga fabril);
  - asiento de producción en proceso (WIP);
  - mermas;
  - verificación de disponibilidad de componentes.
- **Avanzadas**: rutas y operaciones por centro de trabajo, capacidad, MRP, subcontratación, calidad, trazabilidad por lote.
- **Líderes**: Odoo MRP, SAP B1 Production, NetSuite Assembly/WIP, Dynamics BC (confianza alta).
- **Invariantes**:
  - Σ consumo + mano de obra = costo del terminado;
  - no se completa sin consumir;
  - los estados no retroceden;
  - el inventario y el mayor cuadran.

## 3. Resultado

- **Madurez: 15 (10–20, confianza alta)**: esqueleto CRUD sin efecto en inventario ni contabilidad, y sin UI.
- **Preparación comercial: 10. Veredicto: No listo** en todos los países.
- **Eje más débil**: 1. **Críticos**: ninguno, porque no se presenta al usuario (no hay UI). Si se expusiera tal cual, INV-20 sería crítico.

## 4. Ejes

| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 10 (5–18, alta) | Ejecutado: BOM del terminado `QA-INV-FG` con 2×P1 + 0,5×P4 → 201; centro de trabajo → 201; orden `QA-INV-OP-1` por 3 → 201; `PATCH {status: COMPLETED, quantityProduced: 3}` → 200. **Stock de FG: 0; P1: 38 y P4: 5 sin cambios; ningún movimiento ni asiento.** El servicio no importa ledger, inventory ni journal (grep `stock\|ledger\|journal` en `manufacturing/*.ts` → 0). La UI es una hoja de ruta no enrutada. | Emisión y consumo, recepción del terminado, costeo, WIP, UI. |
| 2 | 15 (8–22, alta) | No hay máquina de estados: `COMPLETED → PLANNED` con `quantityProduced: 0` → 200 (ejecutado). `UpdateProductionOrderDto = PartialType(Create)` acepta `status` libre. `production_orders.product_id` **sin FK** (`pg_constraint`: solo hay FK a la BOM y a la organización). No valida que la BOM pertenezca al producto de la orden. `capacityPerHour` y `hourlyRate` vuelven como string (`"5.00"`): falta el transformer numérico. | Transiciones válidas, FK, coherencia BOM↔producto. |
| 3 | N/A | Sin reglas por país. | — |
| 4 | 35 (25–45, media) | Servicio CRUD con tenant por parámetro y paginación (`resolvePaging`); `assertTenantOwns` en las referencias. No tiene dominio. | Agregado de orden con comandos (liberar, emitir, reportar, cerrar). |
| 5 | 60 (50–68, media) | Sin violaciones de frontera porque no integra nada. | — |
| 6 | 60 (50–68, media) | 7 avisos de lint. | — |
| 7 | 55 (45–62, baja) | Listados paginados. | — |
| 8 | 78 (70–84, media) | `qa-do-a` contra `qa-do-inv`: GET de BOM y orden ajenas → 404; PATCH de orden ajena → 404; BOM u orden con producto ajeno → 404 `referenced_record_not_found`. Unicidad `(organization_id, orderNumber)`, sin oráculo entre tenants. Member: POST work-centers y orders → 403 (ejecutado). | — |
| 9 | 35 (25–45, alta) | Las specs pasan pero solo prueban CRUD, tenant y borrado; no hay nada de consumo porque no existe. | — |
| 10 | 30 (20–40, media) | Sin auditoría específica. | — |
| 11 | 5 (0–10, alta) | No hay UI operativa; la hoja de ruta está huérfana. | — |
| 12 | 5 (0–10, alta) | Muy lejos de Odoo MRP, Alegra (sin MRP) o Siigo (producción básica). | — |

## 5. Compuertas

| Compuerta | Estado |
|---|---|
| 1 | **No cumple** (no consume ni produce). |
| 2 | **No cumple** (estados libres, sin FK). |
| 3 | Cumple (aislamiento y member → 403 ejecutados). |
| 4 | Parcial. |
| 5 | N/A (no hay UI). |
| 6 | N/A. |
| 7 | Parcial. |
| 8 | No cumple. |
| 9 | Cumple. |
| 10 | Cumple. |
| 11 | No cumple. |
| 12 | No cumple. |

## 6. Hallazgos

- **INV-20** — manufacturing · ejes 1 y 2 · **Categoría**: funcionalidad falsa · **Severidad: alta** (crítica si se expone en la UI)
  - **Ubicación**: `manufacturing.service.ts` (`updateOrder`), `PATCH /manufacturing/orders/:id`.
  - **Qué está mal**: una orden puede marcarse COMPLETED con cantidad producida sin consumir componentes ni dar entrada al terminado; el inventario y el mayor no se enteran. Ejecutado (orden `619639c8…`).
  - **Forma correcta**: comandos de dominio (`release`, `issueMaterials`, `reportOutput`, `close`) que llamen a `StockLedgerService.move` y a un posting de WIP, en una transacción.
  - **Impacto**: bloquea la venta a manufactura.
  - **Esfuerzo**: XL (**rehacer**).
- **INV-21** — manufacturing · eje 2 · **Severidad: media**
  - **Qué está mal**: no hay máquina de estados (COMPLETED→PLANNED aceptado), `product_id` no tiene FK y los decimales se devuelven como string.
  - **Esfuerzo**: S.
- **INV-22** — frontend · eje 5/11 · **Severidad: baja**
  - **Ubicación**: `features/manufacturing/pages/dashboard.component.ts` y `features/wms/...`.
  - **Qué está mal**: son componentes de hoja de ruta no enrutados (código muerto) cuyo comentario afirma que «es alcanzable desde el menú». El comentario contradice el código.
  - **Esfuerzo**: S.

## 7. Camino mínimo a producción

Rehacer como subdominio (XL):

1. Máquina de estados y FK.
2. Emisión de materiales y recepción del terminado mediante el ledger.
3. Costeo (materiales + centro de trabajo × horas).
4. Asientos de WIP.
5. UI de BOM, órdenes y centros.
6. Pruebas de integración.

Depende de las conversiones de UdM (INV-14).

## 8. Camino a 100

| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Consumo y producción con costo | +35 | XL |
| UI | +15 | L |
| Rutas y capacidad | +10 | L |
| MRP | +10 | XL |
| Mermas y calidad | +5 | M |
| Trazabilidad por lote | +5 | L |

## 9. Competitividad

Inexistente frente a Odoo MRP y SAP B1 (confianza alta). No tiene diferenciadores.

## 10. Fortalezas

- El aislamiento por tenant es correcto.
- Paginación.
- No se borra una orden iniciada (`order_started_cancel_instead`), aunque no existe el concepto de «iniciada» con efectos.

## 11. No verificado

- Tenants fuera de DO.
