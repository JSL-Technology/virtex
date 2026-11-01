# M19 — Inventario (`inventory`) · Familia F7

> **HALLAZGOS CRÍTICOS DE INTEGRIDAD (no de seguridad):**
> - **INV-01** — el costo de venta de una factura creada como borrador se fija con el costo promedio *del momento del borrador* y no se recalcula al emitirla, mientras que el kardex descarga al costo *de la emisión*. **Reproducido:** la cuenta Inventarios queda en 160,00 frente a un valor de existencias de 150,00 (ver §6).
> - **INV-02** — una venta de POS descarga existencias y no registra ningún asiento (ni ingreso ni costo de venta). La cuenta Inventarios queda sobrevalorada por el costo de todo lo vendido en caja (confirmado en el código; no lo ejecuté).
>
> Aislamiento entre tenants: **sin fugas** en los endpoints que probé (§6, INV-S).

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/inventory/`: 37 archivos, ~5.081 LOC sin specs, 5 specs. Usa además las entidades `StockMovement`, `StockLevel` y `Warehouse` de `supply-chain/entities/`.
  - Endpoints: `inventory.controller.ts` (catálogo CRUD, imágenes, dependientes) y `stock.controller.ts` (16 rutas: existencias, kardex, ajustes con borrador/contabilizar/anular/revertir, transferencias), más `product-categories.controller.ts`.
  - Tablas: `products`, `product_categories`, `product_images`, `product_price_history`, `stock_levels`, `stock_movements`, `inventory_adjustments(_lines)`, `stock_transfers(_lines)`, `ai_inventory_insights` y las vistas `ai_src_*`.
- **Frontend:** `features/inventory`; el maestro de almacenes y el de UdM están enrutados desde `core/modules/manifests/inventario.manifest.ts:176,186`. No inspeccioné la UI a fondo.
- **Países:** el módulo no depende del país (solo los textos de los asientos se generan en el idioma de los libros). La clasificación bien/servicio y los códigos fiscales del producto los consume facturación.
- **Depende de:** `journal-entries` (`AccountingPostingPort`), `accounting/period-status`, `organizations` (configuración, fecha fiscal, sucursal), `users`, `shared/numbering`.
- **Lo consumen:** invoices, pos, procurement (recepción de OC y su anulación), vendor bills.
- **¿Núcleo para vender?** Sí: es el corazón de un ERP comercial o de distribución.

## 2. Estándar de referencia (Paso 3)
- **Capacidades básicas:**
  - catálogo con UdM;
  - existencias por almacén;
  - kardex con saldo y valor;
  - entradas, salidas, ajustes con motivo y rastro, transferencias;
  - un método de costeo consistente (promedio ponderado o FIFO);
  - asiento automático por cada movimiento valorizado;
  - conteo físico;
  - política de stock negativo;
  - lotes, series y vencimientos (imprescindibles en farmacia, alimentos y electrónica);
  - reservas y cantidad disponible frente a la física;
  - punto de reorden;
  - valorización a una fecha.
- **Capacidades avanzadas:** FIFO por capas, costo estándar con varianzas, costos de importación (landed cost) capitalizados, transferencias en tránsito, ubicaciones y bins, conteo cíclico, ABC, reabastecimiento, multi-UdM, trazabilidad hacia atrás y hacia adelante.
- **Invariantes no negociables:**
  - Σ kardex = existencias por almacén = total del producto;
  - Σ (existencias × costo) = saldo contable de Inventarios;
  - el costo de venta contabilizado = el valor de salida del kardex;
  - movimientos inmutables, corregidos por reversión;
  - ninguna salida concurrente consume dos veces la misma unidad.
- **Cómo lo resuelven los líderes** (confianza media-alta, documentación pública de producto):
  - Odoo valoriza cada *stock move* con capas de valoración (AVCO/FIFO) y genera el asiento desde el propio movimiento.
  - Dynamics BC tiene *Value Entries* y *Item Ledger Entries*, más la tarea "Adjust Cost – Item Entries".
  - NetSuite maneja Average/FIFO/LIFO/Standard por artículo, con lotes y series nativos.
  - SAP B1 valoriza por almacén o por empresa, con lotes y series.
  - Bsale y Defontana ofrecen kardex valorizado y series y lotes básicos (confianza media).
- **Construcción de referencia:** un único escritor del libro de existencias; la valoración nace del movimiento (el asiento usa el valor que registra el kardex, no un valor recalculado aparte); capas de costo; reservas como un libro aparte.

## 3. Resultado
**Madurez: 40** (34–48, confianza media-alta).
**Preparación comercial: 42 → NO LISTO.**
- **Eje más débil:** 2, Corrección e integridad.
- **Críticos abiertos:** 2 (INV-01, INV-02). **Altos:** 5.
- La madurez queda unos 15 puntos por debajo del promedio de los ejes (~55) porque la regla min(ejes 1, 2, 8) y el tope por crítico la fijan en el eje 2.

## 4. Doce ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | **50** (42–58, alta) | Lo que hay es real: kardex, niveles por almacén, ajustes con reversión, transferencias y promedio ponderado, sin mocks. No hay lotes, series, vencimientos, reservas, conteo físico como documento propio, transferencias en tránsito ni valorización a una fecha. FIFO, LIFO y STANDARD están declarados pero no implementados. | Lotes/series/vencimientos, reservas y disponible, documento de conteo, FIFO real, valorización histórica. |
| 2 | Corrección e integridad | **40** (32–48, alta) | Todo correcto en ajustes, transferencias, ventas emitidas directamente y concurrencia. **Roto** en dos casos: borrador → emisión (INV-01, reproducido, 10,00 de diferencia) y POS (INV-02). El costo de venta se omite en silencio si faltan cuentas (INV-03). | La valoración debe venir del movimiento; el POS debe contabilizar; nunca descargar existencias sin asiento. |
| 3 | Multi-país | **N/A** (70 informativo) | El módulo es agnóstico del país; las narrativas del asiento salen en el idioma de los libros. No hay reglas fiscales propias. | — |
| 4 | Arquitectura | **66** (58–72, media) | Un único escritor (`stock-ledger.service.ts:66-117`) con bloqueo ordenado producto → nivel. Puertos `GoodsReceiptPort` y `AccountingPostingPort`. Pero el valor del costo de venta se calcula fuera del movimiento, en facturación. | La valoración debe nacer del movimiento (capas). |
| 5 | Higiene y fronteras | **45** (38–52, alta) | `verify:boundaries` falla por inventario → contabilidad (+2/+2) e inventario → identidad (+2). Hay imports de internos ajenos (`inventory-adjustments.service.ts:22-26`: `accounting/period-status`, la entidad `AccountingPeriod`, `User`, `OrganizationSettings`). Las entidades del libro de existencias viven en `supply-chain`. | Contratos de período, usuario y configuración; mover `StockMovement` y `StockLevel` a inventory. |
| 6 | Calidad de código | **68** (60–74, media) | Código claro y documentado, con épsilon y redondeo a 6 decimales. Aritmética de dinero en `number` (transversal `common/money.ts:77-84`). Columnas `costingMethod` y `trackingMethod` muertas. | Decimal para importes; eliminar o implementar los enums. |
| 7 | Robustez y rendimiento | **62** (54–68, media) | Bloqueos pesimistas correctos; listados limitados a 500 y paginados. Hay consultas en bucle por línea en ajustes y transferencias (`findOne`, `ledger.balance` por línea). La ventana del kardex recorre todo el historial (`stock-queries.service.ts:153-161`). | Instantáneas de saldo; carga por lotes. |
| 8 | Seguridad y aislamiento | **72** (64–78, media) | IDOR negativo en 6 operaciones (§6). Permisos por endpoint (`@HasPermission`). La conexión de la API es superusuario, así que las RLS no aplican (ENTORNO). No probé roles restringidos. | Matriz de roles probada; RLS efectiva. |
| 9 | Pruebas | **58** (50–66, media) | `stock-ledger.spec.ts` e `inventory-posting.spec.ts` (663 líneas). La suite con BD real pasa (266 suites, `logs/api-test-db.log`), pero ninguna prueba cubre borrador → emisión contra el kardex ni el POS contra el mayor. No verifiqué si las suites de integración corren en CI (se saltan sin DB_HOST). | Prueba de invariante kardex = mayor tras un flujo mixto. |
| 10 | Operabilidad | **55** (48–62, baja) | Logs por documento. Sin conciliación automática existencias ↔ mayor. Ver AUD-01 (transversal). | Un reporte o job de conciliación del inventario con el mayor. |
| 11 | UX | **55** (45–65, baja) | Las pantallas de ajustes muestran la fecha y las cuentas antes de contabilizar (`readiness`). No navegué la UI. | Verificación con Playwright. |
| 12 | Competitividad | **42** (35–50, media) | Por debajo de Odoo, BC y Bsale por la falta de lotes, series y reservas. | Ver §9. |

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, con capacidades básicas (crítica) | **No cumple** | Faltan lotes/series/vencimientos y reservas; los métodos de costeo declarados no existen. |
| 2 | Integridad en escrituras críticas (crítica) | **No cumple** | INV-01 (reproducido) e INV-02. |
| 3 | Autorización y aislamiento (crítica) | Cumple (parcial) | IDOR negativo; roles no probados. |
| 4 | Validación en servidor | Cumple | DTOs con class-validator; servicios inactivos, duplicados y almacenes ajenos rechazados. |
| 5 | Flujos E2E sin 500 | Cumple | Secuencia completa sin ningún 500. |
| 6 | Cumplimiento por país | N/A | — |
| 7 | Pruebas de flujos críticos en CI | No cumple | Falta la prueba de invariante; CI con BD no verificado. |
| 8 | Auditoría de negocio | Cumple (parcial) | Ajustes con creado/contabilizado/anulado por usuario e historial de precios; transferencias sin `cancelledBy`. |
| 9 | Migraciones sin deriva | Cumple | ENTORNO: drift OK. |
| 10 | Observabilidad | Parcial | AUD-01. |
| 11 | UI sin bloqueos | No verificado | — |
| 12 | Documentación | Parcial | Abundante en el código; no hay guía de configuración de cuentas de inventario. |

## 6. Hallazgos

**Pruebas ejecutadas** (tenant qa-us, scripts en `scratchpad/f7/`):
1. Producto `QA-F7-P1` creado con 10 unidades a 5 (asiento de apertura).
2. Transferencia de 4 unidades a `QA-F7-W2` (TR-2026-000001).
3. Ajuste de +5 a 8 → **promedio rehecho a mano: (10·5 + 5·8) / 15 = 6,00. El sistema da 6 ✓.**
4. Factura emitida directamente por 3 unidades → `costOfSale` = 18 ✓.
5. Revaluación a 10 → valor del ajuste = 12 · 4 = 48 ✓.
6. SQL: Σ kardex = 12 = Σ `stock_levels` = `products.stock`. Mayor de Inventarios = 120,00 = Σ existencias × costo = 120,00 ✓.
7. **Concurrencia:** 3 facturas en paralelo sobre la última unidad de `QA-F7-P2` → 1 con 201 y 2 con 400 `inventory.not_enough_stock_in_warehouse`. Stock final 0 y un solo `SALE_DISPATCH` ✓. No hay doble consumo ni stock negativo.
8. El flujo cruzado ya confirmó que el ajuste y su reversión cuadran.

- **INV-01 · Eje 2 · Integridad de datos · CRÍTICA**
  - **Ubicación:** `invoices/invoices.service.ts:982` (`unitCost: product.cost` al crear el borrador) y `:808-810` (`costOfSale` calculado a partir de él); `invoices/invoices.service.ts:455-517` (`issueWithin` no recalcula); `invoices/services/invoice-posting.service.ts:257` (contabiliza `invoice.costOfSale`). Por su lado, el kardex usa el costo del momento de la emisión: `inventory/inventory.service.ts:304-312` no pasa `unitCost` y `stock-ledger.service.ts:106` toma `product.cost`.
  - **Qué está mal:** el costo de venta contabilizado y el valor de salida del kardex se calculan por separado y en momentos distintos.
  - **Reproducción:** borrador de 2 unidades (`issue:false`, `costOfSale` = 20 a un costo de 10) → revaluación a 15 (AJ +60) → emisión. El kardex registra `SALE_DISPATCH` −2 a 15 = 30 de valor; el costo de venta queda en 20. SQL: **mayor de Inventarios 160,00 frente a existencias × costo 150,00.** Lo mismo ocurre con cualquier recepción de OC o ajuste entre el borrador y la emisión, que es el caso normal en B2B.
  - **Forma correcta:** el costo de venta = Σ del `value` que devuelve `ledger.move` al emitir (la valoración nace del movimiento).
  - **Impacto:** bloquea la venta (balance falso). **Esfuerzo:** M.
- **INV-02 · Ejes 2/1 · Integridad · CRÍTICA (multimódulo: POS)**
  - **Ubicación:** `pos/pos.service.ts:237` (`decreaseStock`). Búsqueda de `journal|posting|createWithManager|COGS` en `pos/` = 0 coincidencias; de `PosSale|PosShift` fuera de `pos/` = 0.
  - **Qué está mal:** cada venta de caja reduce las existencias sin asiento de costo de venta (ni de ingreso), así que la cuenta Inventarios queda por encima del valor real. La anulación (`pos.service.ts:436`) devuelve existencias sin contraasiento.
  - **Forma correcta:** contabilizar la venta POS (o el cierre de turno) con ingreso, impuesto, caja, costo de venta e inventario, a partir del valor del movimiento.
  - No lo ejecuté (requiere terminal y turno); queda confirmado en el código.
  - **Impacto:** bloquea la venta en retail. **Esfuerzo:** M-L.
- **INV-03 · Eje 2 · Integridad · ALTA**
  - **Ubicación:** `invoice-posting.service.ts:258-266`.
  - **Qué está mal:** si faltan las cuentas de inventario o de costo de venta, la venta descarga existencias y solo deja un `warn` en el log, sin asiento de costo. En cambio, los ajustes y las aperturas sí rechazan la operación (`inventory-posting.service.ts:83,151`). Es inconsistente.
  - **Forma correcta:** rechazar la emisión o bloquear el movimiento de productos inventariables sin cuentas.
  - **Esfuerzo:** S.
- **INV-04 · Ejes 1/12 · Funcionalidad declarada sin implementar · ALTA**
  - **Ubicación:** `entities/product.entity.ts:26-50,247-262`.
  - **Qué está mal:** `TrackingMethod {LOT, SERIAL_NUMBER}` y `CostingMethod {FIFO, LIFO, STANDARD}` existen como columnas, pero no están en ningún DTO (búsqueda de `costing|tracking` en `dto/` = 0) y ninguna lógica los usa: `receiveGoods` solo promedia (`inventory.service.ts:371`). No hay tablas de lotes, series, vencimientos ni reservas (búsqueda de `lot|serial|expir|reserv` en `information_schema` = 0). LIFO, además, no lo admite la NIC 2 (verificar con contador).
  - **Forma correcta:** implementar lotes, series y vencimientos y FIFO por capas, o eliminar los enums.
  - **Esfuerzo:** XL.
- **INV-05 · Eje 1 · Capacidad básica faltante · ALTA**
  - **Qué está mal:** no hay reservas ni comprometido/disponible. Un pedido o una cotización no reserva existencias (búsqueda de `reserv|committed|allocated` en `sales/inventory/supply-chain/pos` = 0).
  - **Esfuerzo:** L.
- **INV-06 · Eje 5 · Mezcla de contexto · ALTA**
  - **Qué está mal:** `verify:boundaries` falla (inventario → contabilidad +2/+2 e inventario → identidad +2). Hay imports directos en `inventory-adjustments.service.ts:22-26` y `inventory-posting.service.ts:4-14` (entidades `OrganizationSettings` y `Journal`). Las entidades del libro de existencias están en `supply-chain/entities` (`stock-ledger.service.ts:4-6`).
  - **Esfuerzo:** M.
- **INV-07 · Eje 1 · Media** — El kardex no lleva valor corrido ni existe una valorización a fecha. El reporte de existencias valoriza cantidad × costo actual (`stock-queries.service.ts:92`), así que no se puede cuadrar el inventario contra un cierre pasado. **Esfuerzo:** M.
- **INV-08 · Eje 2 · Media** — Casos borde de la anulación de recepciones (`inventory.service.ts:434-443`): si lo que queda es ≤ 0 se conserva el costo, y si el valor resultante es negativo se fuerza a 0. En ambos casos el asiento (al costo de la recepción) y existencias × costo divergen. No lo verifiqué por ejecución. **Esfuerzo:** S.
- **INV-09 · Eje 2 · Media** — El asiento de apertura del producto se fecha con `new Date().toISOString()`, es decir en UTC y no con la fecha fiscal del tenant (`inventory-posting.service.ts:98`). Además, el alta de producto con stock no valida el período, a diferencia de los ajustes. **Esfuerzo:** S.
- **INV-10 · Ejes 1/12 · Media** — La política de stock negativo es un bloqueo duro por almacén y no se puede configurar (`stock-ledger.service.ts:84`). Es correcto y conservador, pero algunos clientes (servicio técnico, venta contra pedido) necesitan permitirlo de forma controlada. Las transferencias se hacen en un solo paso, sin estado en tránsito. **Esfuerzo:** M.
- **INV-11 · Eje 9 · Media** — Ninguna prueba ejecuta el invariante "Σ existencias × costo = mayor" tras un flujo mixto (borrador, POS, recepción, anulación). Las pruebas actuales no habrían detectado INV-01 ni INV-02. **Esfuerzo:** S.
- **INV-12 · Eje 8 · Baja** — `stock-transfers.service.ts:76` llama a `ledger.balance` sin `organizationId`. No es explotable porque la transferencia ya está acotada al tenant, pero rompe el patrón.
- **Transversales:**
  - redondeo en `common/money.ts:77-84`;
  - AUD-01;
  - **FLOW-01:** recepciones concurrentes de una OC sobre-reciben (confirmado por el flujo cruzado). Eso infla las existencias y el saldo puente de mercancía recibida no facturada.
- **INV-S (aislamiento)** — Con la sesión de qa-b sobre recursos de qa-us: `GET /inventory/:id` → 404, `GET adjustments/:id` → 404, kardex y existencias filtrados por id ajeno → vacíos, `PATCH` del producto → 404, ajuste sobre el almacén y el producto ajenos → 400 `warehouse_not_found`. **Sin fuga.**

## 7. Camino mínimo a producción
1. INV-01: el costo de venta debe salir del valor del movimiento al emitir (M).
2. INV-02: contabilizar el POS (M-L, con la familia de POS).
3. INV-03: bloquear la venta sin cuentas (S).
4. INV-11: prueba de invariante en CI con BD (S).
5. FLOW-01: bloqueo de la OC al recibir (S, procurement).
6. INV-05: reservas (L).
7. INV-04: lotes, series y vencimientos (XL), al menos para verticales que los exigen.

Retocar, no rehacer. Aplica a todos los países.

## 8. Camino a 100
| Ítem | Puntos que sube | Esfuerzo |
|---|---|---|
| INV-01 + INV-02 + INV-03 | eje 2 +30 (madurez hasta ~60) | M |
| Prueba de invariante y conciliación existencias ↔ mayor | ejes 9/10 +15 | S-M |
| Lotes, series y vencimientos | eje 1 +15, eje 12 +15 | XL |
| Reservas y disponible | eje 1 +8 | L |
| FIFO por capas o eliminar enums | eje 1 +5 | L |
| Valorización a fecha | +5 | M |
| Fronteras (INV-06) | eje 5 +20 | M |
| Tránsito, bins y conteo cíclico | eje 12 +10 | L |

## 9. Competitividad
- **Brechas básicas:** lotes, series y vencimientos (Bsale, Defontana, Odoo, SAP B1 y NetSuite los tienen); reservas; conteo físico como documento; valorización a fecha.
- **Brechas avanzadas:** FIFO y estándar, landed cost aplicado, bins, reabastecimiento.
- **Diferenciadores existentes:** ajustes con detección de "el saldo cambió desde el conteo" y con decisión explícita (`inventory-adjustments.service.ts:365-386`); contrapartidas separadas por naturaleza; reversión enlazada en ambos sentidos.
- **Interoperabilidad:** import/export de productos (`products-data-transfer.provider.ts`).
- **Nota: 42** (35–50, confianza media).
- **Fuentes:** documentación pública de Odoo Inventory, Dynamics BC y NetSuite (confianza media).

## 10. Fortalezas a preservar
- Un único escritor del libro con bloqueo ordenado: la concurrencia se probó y es correcta.
- Cantidades a 6 decimales con épsilon.
- Ajustes con número, motivo, reversión, chequeo de período y asiento idempotente (`inventory-adjustments:<id>`).
- Promedio ponderado bien calculado.
- Las existencias no se editan desde el catálogo (`inventory.service.ts:206-219`).

## 11. Lo que no se pudo verificar
- POS ejecutado (INV-02 confirmado solo en el código).
- UI con Playwright.
- Roles restringidos.
- CI con BD.
- Predicciones e IA (`ai_inventory_insights`).
- Casos de la anulación de recepciones.
- Tenants DO y MX.

**Cobertura:** ~65 % de los archivos backend leídos; ~60 % de los endpoints ejecutados; UI 0 %.

<!-- RESUMEN: modulo=inventario; madurez=40; prep=42; veredicto=No listo; eje_debil=2-Correccion e integridad; criticos=2; altos=5; camino_min=M -->
