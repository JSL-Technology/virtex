# Ficha — `inventory` (productos, categorías, almacenes, existencias, kárdex, ajustes, transferencias, costeo, precios históricos, predicciones)

Familia INV · auditor senior · 2026-11-07 · tenant propio `qa-do-inv@virtex.test` (org `55a0e6b7-…`), aislamiento con `qa-do-a` (sesión reutilizada, sin login por el límite 5/min/IP). Scripts y capturas: `/tmp/claude-0/-home-user-virtex/18f6e197-474f-5038-b8e5-f1d402f375bd/scratchpad/agents/inv/`.

## 1. Identificación

- **Backend**: `apps/backend/api/src/app/inventory/` — 5.026 líneas sin specs (más de 1.075 en specs). Archivos principales: `inventory-adjustments.service.ts` (630), `inventory.service.ts` (518), `inventory-posting.service.ts` (443), `stock-ledger.service.ts` (292), `product-images.service.ts` (285), `stock-queries.service.ts` (242), `stock-transfers.service.ts` (212), `product-categories.service.ts` (190).
- **Endpoints** (32): `/inventory` CRUD de productos, `/inventory/images`, `/inventory/:id/dependents`, `/inventory/categories` CRUD, `/inventory/stock`, `/inventory/movements` (kárdex), `/inventory/adjustments` (CRUD, `post`, `cancel`, `reverse`, `date-readiness`), `/inventory/transfers` (CRUD, `post`, `cancel`). Los almacenes se exponen en `/wms/warehouses`, que pertenece a supply-chain (ver ficha `wms`).
- **Tablas**: `products`, `product_categories`, `product_images`, `product_price_history`, `inventory_adjustments`, `inventory_adjustment_lines`, `stock_transfers`, `stock_transfer_lines`. **Las tablas `stock_levels`, `stock_movements` y `warehouses` tienen su entidad en `supply-chain/entities/`, pero quien escribe en ellas es `inventory/stock-ledger.service.ts`.**
- **Frontend**: `apps/core/client-web/src/app/features/inventory/` (3.104 líneas, 6 specs): products, product-form, stock, movements/kárdex, adjustments, transfers, categories y data. Menú en `inventario.manifest.ts`: productos, predicciones, existencias, kárdex, ajustes, transferencias, categorías, almacenes y unidades de medida.
- **Pruebas**: `stock-ledger.spec.ts` (integración con BD real), `inventory-posting.spec.ts` (681 líneas, BD real), `inventory-price-history.spec.ts`, `inventory-search.spec.ts`, `product-images.service.spec.ts`.
- **Países**: los 19 declarados; el módulo es casi neutral respecto del país.
- **Dependencias**: journal-entries y accounting (asientos y compuerta de período), organizations (settings y sucursales), supply-chain (entidades), ai (predicciones).
- **¿Núcleo para vender?** Sí: comercio, distribución y POS dependen de él.

## 2. Estándar de referencia (Paso 3)

Fuentes: conocimiento del dominio y documentación pública de los productos, sin verificación web en esta sesión. **Confianza media.**

- **(a) Capacidades básicas**: maestro de productos y servicios; varios almacenes; existencias por almacén; kárdex valorizado con saldo corrido; ajustes y conteos físicos con motivo; transferencias (idealmente con estado «en tránsito»); costo promedio ponderado (y FIFO donde lo exijan el sector o la norma); integración contable automática; política de stock negativo configurable; unidades de medida con conversión compra↔venta; reservas y comprometido por pedidos; punto de reorden. Básicas en distribución, farmacia y alimentos: lotes, series y vencimientos.
- **(a) Capacidades avanzadas**: ubicaciones (bins), costos de importación (landed cost) absorbidos en el costo, valoración por almacén, FEFO, variantes, kits, reabastecimiento automático, conteo cíclico, código de barras GS1 y pronóstico de demanda.
- **(b) Invariantes**:
  - existencia(producto, almacén) = Σ movimientos;
  - Σ existencias por almacén = total del producto;
  - el valor del inventario en el subledger es igual al saldo de la cuenta de inventario en el mayor;
  - no se descuenta lo que no hay (salvo política explícita);
  - los movimientos son inmutables: se corrigen con contramovimientos;
  - nada se registra en un período cerrado;
  - las operaciones concurrentes no producen sobreventa.
- **(c) Cómo lo resuelven los líderes**:
  - **NetSuite**: lotes y series, bins, transferencias con tránsito, promedio/FIFO/LIFO/estándar por artículo (confianza alta).
  - **Odoo**: rutas, lotes y series, FEFO, reservas por pedido, valoración AVCO/FIFO/estándar por categoría (confianza alta).
  - **SAP Business One**: precio medio móvil, FIFO o estándar por almacén; lotes y series (confianza alta).
  - **QuickBooks Online Advanced**: FIFO, sin lotes nativos (confianza media).
  - **Alegra y Siigo**: promedio ponderado, bodegas; en Alegra los lotes son limitados (confianza media).
  - **Bsale**: series y lotes en retail CL (confianza baja).
- **(d) Construcción de referencia**: un único libro de existencias (stock ledger) append-only como fuente de verdad, saldos materializados bajo bloqueo, capas de costo si hay FIFO, asiento contable en la misma transacción, constraints de BD (`CHECK` de cantidad ≥ 0 cuando la política lo exija) y movimientos inmutables.

## 3. Resultado

- **Madurez: 52 (45–58, confianza media-alta)**: núcleo de existencias y costeo promedio sólido y verificado; faltan capacidades básicas (reservas, conversiones de UdM, lotes, series y vencimientos, tránsito).
- **Preparación comercial: 48. Veredicto: No listo.** La compuerta crítica 1 no se cumple por las capacidades básicas ausentes. Es apto como **piloto controlado** solo para comercio simple sin lotes ni vencimientos.
- **Eje más débil**: 5 (higiene y separación, 45) y 12 (competitividad, 45).
- **Hallazgos críticos abiertos**: ninguno propio. Hay uno cruzado que afecta a POS/compliance (INV-01, ver ficha `pos`).
- **Promedio simple de ejes ≈ 61 frente a madurez 52**: la nota queda topada por el eje 1 (55), que es crítico.

## 4. Ejes

| # | Nota (rango, confianza) | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad y completitud | 55 (48–62, alta) | Todo lo visible persiste de verdad: productos, ajustes (borrador→contabilizado→reverso), transferencias y kárdex. Lo ejecuté por API y por UI. **Ausentes**: lotes, series y vencimientos (no existe ninguna entidad `Lot`/`Serial`: grep `class (Lot\|Serial\|InventoryLot)` → 0); reservas y comprometido; conversiones de UdM; transferencias en tránsito; landed cost absorbido; valoración por almacén. `CostingMethod` declara FIFO/LIFO/STANDARD (`entities/product.entity.ts:45-50`), pero ningún DTO lo expone y solo existe promedio ponderado (INV-05). | Lotes, series y vencimientos con FEFO; reservas ligadas a pedidos; conversiones de UdM; tránsito; FIFO real o eliminar el enum. |
| 2 Corrección e integridad | 74 (68–80, alta) | **Costeo recalculado a mano**: entradas 10@10, 10@20 y 20@25 dan promedio 800/40 = **20,00** ✔. La salida de 5 se valoró en −100 ✔. Asientos Dr 1140 / Cr 5150 cuadran ✔. **Mayor**: cuenta 1140 = 810,00 y Σ(stock×costo) = 810,00 ✔. **SQL de consistencia**: niveles = Σ movimientos (0 descuadres), producto = Σ niveles (0), sin negativos. **Stock negativo**: ajuste −100 con 35 en existencia → 400 `inventory.not_enough_stock_in_warehouse`. **Concurrencia**: 20 contabilizaciones simultáneas de −1 con existencia 10 → 10×201 y 10×400, stock final 0, sin sobreventa. **Transferencia atómica**: dos líneas con la segunda sin existencia → nada se movió. Doble post → 409. Doble reverso → 409. PATCH de `stock` en el producto → 400 `stock_changes_through_adjustments`. **Debilidades**: `stock_movements` es mutable (sin trigger append-only); no hay `CHECK (quantity_on_hand >= 0)` en BD; `stock_movements.organization_id` es NULLABLE (`supply-chain/entities/stock-movement.entity.ts`); el costo es uno por empresa, no por almacén. | Trigger append-only en `stock_movements`; `CHECK` de cantidad no negativa; `organization_id NOT NULL`; prueba de concurrencia automatizada. |
| 3 Multi-país | 60 (50–68, media) | Remate: ajuste +5@40 en `qa-mx-a` y `qa-us-a` → contabilizado con asiento en el plan local (US en inglés), sin reglas DO.  Es neutral: moneda e impuesto vienen del tenant. El almacén por defecto se crea con el nombre literal «Almacén principal» en español (`stock-ledger.service.ts` en `defaultWarehouse`). No hay reglas fiscales de inventario por país, como el método de valuación admitido por la norma (LIFO no es admisible en NIIF; verificar con contador local). | Bloquear métodos no admitidos por país; nombre del almacén por defecto localizado. |
| 4 Arquitectura | 66 (58–72, media) | Un solo escritor de existencias (`StockLedgerService.move`, con bloqueo producto→nivel en orden fijo y sin deadlocks). Servicios por caso de uso. DTOs con `whitelist` (rechaza `organizationId` en el body). Paginación con límite de 500 en stock y kárdex (`stock-queries.service.ts:38-41`). **En contra**: entidades `StockLevel`, `StockMovement` y `Warehouse` en `supply-chain`; `Product` es una entidad compartida por 10+ módulos. | Mover las entidades de existencias al módulo dueño y exponer puertos de lectura. |
| 5 Higiene y separación | 45 (38–52, media) | `module-boundaries`: 20 importaciones privadas desde `inventory-posting.service.ts` hacia internos de journal-entries y organizations; `inventory.module.ts:26` importa `JournalEntriesModule`. Transacciones compartidas: `pos.service.ts:257/507` llama a `inventory.decreaseStock(…, manager)`. `Product` se importa directamente desde invoices, price-lists, sales, procurement y datasheets (`logs/boundaries-report.log` 252-343). Las tablas de supply-chain las escribe inventory (una tabla, dos dueños). | Puerto contable formal; un dueño por tabla; contrato `SellableProduct` en lugar de la entidad. |
| 6 Calidad de código | 70 (62–76, media) | 6 avisos de lint en `app/inventory/` y 17 en `features/inventory/` (`logs/nx-ltb.clean.log`). 3 `any`, supresiones o TODO entre inventory, pos, manufacturing y uom. Comentarios extensos y coherentes con el código. `inventory-adjustments.service.ts` con 630 líneas es aceptable. | Eliminar los `any`, los non-null `!` y los avisos. |
| 7 Robustez y rendimiento | 64 (55–70, media) | Listados paginados. Índices `(product_id, date)` y `(organization_id, warehouse_id, date)` en movimientos. Bloqueo pesimista. **No hay índice** en `stock_movements(source_type, source_id)`, que es lo que se usa para trazar documentos. El kárdex con saldo corrido se calcula en la consulta, sin snapshots de cierre: escala mal con años de historia (no medido). | Índice por origen; saldos de cierre por período; prueba de volumen. |
| 8 Seguridad y aislamiento | 83 (76–88, alta) | Remate (API con AUTH_THROTTLE_LIMIT=200): `qa-do-a-member` (products:view, invoices:view) → GET /inventory 200 y GET /inventory/categories 200; **403** en POST/PATCH /inventory, POST categorías, GET /inventory/stock, POST ajustes y post de ajuste, POST transferencias, POST/PATCH /wms/warehouses, POST /pos/shifts, POST /pos/sales, POST /pos/sales/:id/void, POST manufacturing work-centers/orders, POST /units-of-measure/company ✔.  **Prueba real** con `qa-do-a` atacando recursos de `qa-do-inv`: GET, PATCH y DELETE de producto → 404/400; kárdex y stock filtrados por ids ajenos → vacíos; GET y cancel de ajuste ajeno → 404; transferencia ajena → 404; ajuste con producto ajeno → 400 `product_not_found_in_document`; ajuste o transferencia con almacén ajeno → 400 `warehouse_not_found`; `organizationId` en el body → 400 (whitelist). En BD hay triggers `virtex_assert_same_tenant` en `stock_levels` y `stock_movements`. Los permisos se declaran por operación (`products:*`, `inventory:view_stock/adjust/transfer`). Prueba de member ejecutada en el remate (ver arriba). RLS no aplica en este entorno (rol superusuario). | Ejecutar la matriz de permisos con el usuario member; activar RLS con un rol no superusuario. |
| 9 Pruebas | 66 (58–72, alta) | Corrí `npx jest` sobre inventory, pos, manufacturing y uom con BD real (`DB_HOST`, `DB_USERNAME`…): **11/11 suites y 79/79 pruebas OK**. `stock-ledger.spec.ts` prueba existencias por almacén, transferencias y almacén por defecto contra Postgres. Sin variables de BD, 4 suites fallan por conexión (dependen del entorno). **No hay** prueba de concurrencia (sobreventa) ni de consistencia mayor↔subledger. | Prueba de concurrencia; prueba de conciliación 1140 = valoración; prueba de reverso. |
| 10 Operabilidad | 60 (52–68, media) | `audit_logs` (append-only por trigger) registra `inventory_adjustments` CREATE/UPDATE y `products`, pero **no `stock_transfers`** (0 filas tras crear y contabilizar TR-2026-000001). Los logs de Nest son estructurados. Ajustes con `createdBy`, `postedBy` y `cancelledBy`. | Auditar transferencias y revaluaciones; métricas de stock negativo rechazado. |
| 11 UX e idiomas | 62 (55–70, media) | Playwright (`shot-*.png`): productos, existencias, kárdex, ajustes, transferencias y categorías cargan sin errores de API. Consola: claves `charts.*` y `common.skip_to_content` sin traducir en `es` (≈35 avisos en ajustes nuevos y categorías). «Predicciones de demanda» aparece en el menú de un admin cuyo plan no lo incluye (403 en `/ai/forecasts/*`; el mensaje muestra la clave cruda `ai_forecasting`). La ruta `/inventory/kardex` redirige a `movements`. | Traducciones completas; ocultar las funciones fuera del plan o mostrar un upsell claro. |
| 12 Competitividad | 45 (38–52, media) | Frente a Odoo y NetSuite faltan lotes, series, FEFO, reservas, UdM, tránsito, bins operativos y landed cost. A favor: conciliación exacta con el mayor y kárdex trazable al documento, por encima de Alegra (confianza media). | Ver el camino a 100. |

## 5. Compuertas de producción

| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas y capacidades básicas presentes | **No cumple** | Sin reservas, lotes, vencimientos ni conversiones de UdM. FIFO declarado pero sin implementar. |
| 2 | Integridad en escrituras críticas | Cumple | Concurrencia, atomicidad, conciliación con el mayor y doble post bloqueado (eje 2). |
| 3 | AuthZ y aislamiento | Cumple | Aislamiento y matriz de member ejecutados. |
| 4 | Validación en servidor | Cumple | Whitelist, `@Min` y `maxDecimalPlaces: 6`. |
| 5 | Humo E2E sin 500 ni errores de consola | Cumple con reserva | Sin 500 en inventory; avisos i18n y 403 de IA en consola. |
| 6 | Cumplimiento por país | Cumple con reserva | Ajustes en MX y US funcionan sin reglas DO; no hay reglas de valuación por país. |
| 7 | Pruebas en CI | Cumple con reserva | Pasan, pero CI está en rojo globalmente (typecheck de einvoicing). |
| 8 | Auditoría de negocio | Parcial | Las transferencias no se auditan. |
| 9 | Migraciones sin deriva | Cumple | `check:schema-drift` OK. |
| 10 | Observabilidad mínima | Cumple | Logs estructurados. |
| 11 | UI y traducciones | No cumple | Claves sin traducir. |
| 12 | Documentación | Parcial | Comentarios ricos; no hay guía operativa de inventario. |

## 6. Hallazgos

- **INV-05** — inventory · eje 1/2 · **Categoría**: funcionalidad falsa / multi-país · **Severidad: media**
  - **Ubicación**: `inventory/entities/product.entity.ts:45-50`; `inventory.service.ts:345-377`; `inventory-adjustments.service.ts:410-418`.
  - **Qué está mal**: el enum `CostingMethod` incluye FIFO, LIFO y STANDARD. Si un producto los tuviera, `receiveGoods` no recalcularía el costo, mientras que los ajustes promedian igualmente. Ningún DTO permite elegirlos (grep `costingMethod` fuera de la entidad y el servicio → 0), así que hoy es código muerto que da una falsa promesa.
  - **Forma correcta**: implementar capas FIFO o eliminar los valores no soportados con una migración que restrinja la columna.
  - **Impacto**: brecha competitiva (FIFO se exige en algunos sectores).
  - **Esfuerzo**: L (FIFO) / S (eliminar).
- **INV-06** — inventory · eje 1 · **Categoría**: competitividad · **Severidad: alta**
  - **Qué está mal**: no hay lotes, series ni vencimientos (grep de entidades → 0; `stock_levels` no tiene columna de lote).
  - **Impacto**: bloquea la venta a farmacia, alimentos y repuestos con garantía.
  - **Esfuerzo**: XL.
- **INV-07** — inventory · eje 1 · **Severidad: alta**
  - **Qué está mal**: no hay reservas ni comprometido (grep `reserv` en inventory/supply-chain → solo comentarios). Un pedido de venta no aparta existencia, y el POS muestra el total de la empresa (`/pos/catalog` → `stock: 5`) cuando el almacén de la caja tiene 2,5.
  - **Esfuerzo**: L.
- **INV-08** — inventory/supply-chain · eje 2 · **Categoría**: integridad de datos · **Severidad: media**
  - **Qué está mal**: el libro `stock_movements` no es append-only (no tiene trigger, a diferencia de `audit_logs`); no hay `CHECK` de no negatividad en `stock_levels` (verificado con `\d stock_levels`); `organization_id` acepta NULL. Hoy la integridad descansa solo en el código.
  - **Forma correcta**: trigger que impida UPDATE/DELETE, `CHECK` y `NOT NULL`.
  - **Esfuerzo**: S.
- **INV-09** — inventory · eje 5 · **Categoría**: mezcla de contexto · **Severidad: media**
  - **Qué está mal**: las entidades de existencias viven en `supply-chain` pero las escribe inventory; inventory-posting importa 20 internos de journal-entries y organizations; `Product` se usa como entidad compartida por 10+ módulos.
  - **Forma correcta**: mover las entidades de existencias a inventory y usar puertos contables.
  - **Esfuerzo**: M.
- **INV-10** — inventory · eje 10 · **Severidad: media**
  - **Qué está mal**: crear y contabilizar una transferencia no deja rastro en `audit_logs` (consulta por entidad: no aparece `stock_transfers`).
  - **Esfuerzo**: S.
- **INV-11** — inventory · eje 1 · **Severidad: media**
  - **Qué está mal**: la transferencia es instantánea (salida y entrada en el mismo acto); no hay estado en tránsito, recepción parcial ni diferencias de recepción.
  - **Esfuerzo**: M.
- **INV-12** — inventory · eje 2 · **Severidad: media**
  - **Qué está mal**: el costo es uno por empresa y no por almacén (`inventory.service.ts:345`, comentario «because the cost is one per product»). Transferir entre sucursales con costos logísticos distintos no se puede valorar.
  - **Esfuerzo**: L.
- **INV-13** — frontend · eje 11 · **Severidad: baja**
  - **Qué está mal**: faltan las claves i18n `charts.*` y `common.skip_to_content` (consola en `/inventory/adjustments/new` y `/categories`). «Predicciones de demanda» aparece visible sin estar en el plan y muestra la clave cruda `ai_forecasting`.
  - **Esfuerzo**: S.

## 7. Camino mínimo a producción (DO y los 19 países; el módulo es neutral)

1. INV-08: constraints y append-only (S).
2. INV-07: reservas y comprometido, y catálogo POS por almacén (L).
3. Conversiones de UdM (ver ficha `units-of-measure`, M).
4. INV-05: eliminar FIFO/LIFO/STANDARD del enum o implementarlos (S/L).
5. INV-10: auditar transferencias (S).
6. INV-13: traducciones (S).
7. Para los verticales que lo requieran: INV-06, lotes y vencimientos (XL).

Todo esto es **retocar, no rehacer**: el núcleo del ledger es correcto.

## 8. Camino a 100

| Ítem | Puntos estimados | Esfuerzo |
|---|---|---|
| Lotes, series, vencimientos y FEFO | +10 | XL |
| Reservas | +6 | L |
| UdM con conversiones | +5 | M |
| FIFO y estándar reales, valoración por almacén | +5 | L |
| Transferencias en tránsito | +3 | M |
| Landed cost absorbido y bins operativos | +4 | L |
| Conteo cíclico | +2 | M |
| Constraints de BD y pruebas de concurrencia | +3 | S |
| Separación de módulos | +3 | M |
| Snapshots de saldo por período | +2 | M |

## 9. Competitividad

- **Básicas faltantes**: reservas, conversiones de UdM, lotes y vencimientos (según el vertical).
- **Avanzadas faltantes**: FIFO, valoración por almacén, tránsito, bins, landed cost, FEFO y variantes.
- **Diferenciadores**:
  - el kárdex enlaza con el documento de origen;
  - el subledger cuadra exactamente con el mayor;
  - la contabilización respeta la compuerta de período (`date-readiness`);
  - pronóstico de demanda con IA (sujeto a plan).
- **Fuentes**: documentación pública de NetSuite, Odoo y SAP B1 (confianza media-alta); de Alegra y Siigo (confianza media).

## 10. Fortalezas a preservar

- `StockLedgerService.move` como único escritor, con bloqueo ordenado.
- Ajuste en dos fases (borrador y contabilizado) con detección de cambio de saldo (`adjustment_balance_changed`) y reverso con enlace.
- Asiento dentro de la misma transacción.
- Prohibición de editar `stock` y `cost` fuera de los ajustes.
- Historial de precios (`product_price_history`, verificado tras un PATCH 200→210).
- Triggers same-tenant en BD.

## 11. No verificado

- Tenants CO…NI (solo se probaron DO, MX y US).
- Recepción de compras (familia CMP).
- Rendimiento con volumen.
- Importación masiva de productos (`products-data-transfer.provider.ts`).
- Predicciones de IA (el plan las bloquea).
