# 06 — Flujos cruzados entre módulos (Paso 8)

> Estado: CERRADO (2026-10-31/11-01). Auditor: integración entre módulos. Ejecutado por API contra la BD real `erp`; ver "Lo no probado".

## Método
- Tenant exclusivo `qa-flows@virtex.test`, organización "QA-Flujos DO" (DO), `organization_id = b5182378-8ace-49af-9f38-44e530434c7b`. Datos con prefijo `QA-FLOW-`.
- API `http://localhost:3000/api/v1` (cookies httpOnly + CSRF; las operaciones de dinero exigen *step-up* `POST /auth/step-up {scope, password}` de un solo uso). Scripts: `scratchpad/flows/{api.sh,bal.sh,q.sh}`.
- Verificación con SQL de solo lectura sobre `erp` (journal_entries/lines, stock_movements, stock_levels, products, invoices, customer_payments, vendor_bills, purchase_order_lines/receipts), filtrando por la organización.
- Rastreo de código del encadenamiento (llamadas directas dentro de la misma transacción, bloqueos, idempotencia).
- Valores rastreables: producto `QA-FLOW-A` precio 1.234,57, costo de compra 523,37; venta de 7 uds.

## Datos maestros creados
| Objeto | Id |
|---|---|
| Producto QA-FLOW-A (GOOD, ITBIS 18 %, costo promedio ponderado) | 48cefd3c-bef3-4ad6-b74c-e4d9996b81df |
| Cliente QA-FLOW-Cliente 1 (RNC 131000012) | a04bfd9d-c2ac-4c81-bbd6-f8910fb7b956 |
| Proveedor QA-FLOW-Proveedor 1 (RNC 131000029) | bc34c171-d392-41e9-b53a-7f1ef3aaf45b |
| Cuenta bancaria QA-FLOW-Banco (GL 1120) | b1cba282-4f15-42d5-a491-b63413805011 |
| Secuencias NCF B01/B04/E31/E34 (1–1000) | vía `POST /compliance/ncf-sequences` |

Observación de alta: crear factura con el tipo por defecto (E31, e-CF) falla con `einvoicing.certificate.none_active`; se usó `fiscalDocumentType: "B01"`.

(Flujos y hallazgos: ver secciones siguientes; se completan progresivamente.)

---

## Flujo 2 — Compra: OC → recepción → existencias/costo → factura de proveedor → CxP → pago → asiento

| # | Paso (endpoint, cuerpo resumido) | Resultado observado |
|---|---|---|
| 2.1 | `POST /procurement/orders` (`Idempotency-Key: qa-flow-po1`) proveedor QA-FLOW, 1 línea 10 × 523,37, `taxRate 0.18` | 201 `PO-2026-000001` subtotal 5.233,70, ITBIS 942,07, total 6.175,77 (esperado 5.233,70 × 0,18 = 942,066 → 942,07 ✔). Reenvío con la misma clave → réplica del mismo id ✔; misma clave con otro cuerpo → 409 `idempotency_key_reused` ✔ |
| 2.2 | `POST /procurement/orders/:id/{submit,approve,send}` | PENDING_APPROVAL → APPROVED → SENT ✔ (no contabiliza: correcto, es compromiso) |
| 2.3 | `POST /procurement/orders/:id/receive {lines:[{lineId, quantity:6}]}` | 200, `GR-2026-000001`, movimiento `PURCHASE_RECEIPT +6 @523,37`, asiento `COMPRAS-2026-000001` Dr 1140 Inventarios / Cr 2115 GRNI 3.140,22 ✔ |
| 2.4 | **Dos** `POST /procurement/orders/:id/receive {quantity:4}` concurrentes (sin Idempotency-Key, la ruta no la exige) | **Ambas 200.** Se crean `GR-2026-000002` y `GR-2026-000003`; stock_levels = **14** uds para una OC de 10; `purchase_order_lines.received_quantity = 10` (actualización perdida); GL 1140/2115 = 14 × 523,37 = **7.327,18**. Ver **FLOW-01** |
| 2.5 | `POST /accounts-payable` factura proveedor NCF B0100000101, 10 × 523,37, `taxAmount 942,07`, ligada a la línea de OC | 201 DRAFT, total 6.175,77. Observación: `servicesAmount 5.233,70 / goodsAmount 0` para un producto GOOD (clasificación 606 dudosa — verificar con contador) |
| 2.6 | `POST /accounts-payable/:id/submit-for-approval` | OPEN; asiento `COMPRAS-2026-000004` Dr 2115 5.233,70 + Dr 1150 ITBIS crédito 942,07 / Cr 2110 CxP 6.175,77 ✔. GRNI queda con **–2.093,48** (= 4 uds fantasma de FLOW-01) |
| 2.7 | `POST /auth/step-up {scope:"move_funds"}` + `POST /accounts-payable/payments` (Idempotency-Key) 6.175,77 desde QA-FLOW-Banco | 201 `PAY-2026-000001`, asiento `PAGOS-2026-000001` Dr 2110 / Cr 1120 6.175,77 ✔; factura PAID, saldo 0 ✔; CxP en mayor = 0 = subledger ✔ |
| 2.8 | Reintento con la misma Idempotency-Key | Sin nuevo step-up → 401 `step_up_token_already_used` (el guard de step-up corre antes que la réplica idempotente, ver FLOW-07); con step-up nuevo → réplica del mismo pago ✔ (no duplica) |

Costo: costo promedio = 523,37 (todas las entradas al mismo costo) ✔. Cuadre: balanza cuadrada en todo momento (Σ debe = Σ haber).

**Veredicto flujo 2: NO CUADRA bajo concurrencia** (sobre-recepción con stock, GRNI y asientos de 14 uds contra OC de 10 y `received_quantity` = 10). En secuencial, **cuadra**.

---

## Flujo 1 — Venta → existencias → costo de venta → asiento → CxC → cobro → conciliación bancaria

| # | Paso | Resultado observado |
|---|---|---|
| 1.0 | Crear factura sin `fiscalDocumentType` | 400 `compliance.no_active_ncf_sequence_type_type (E31)`; tras crear secuencia E31: 400 `einvoicing.certificate.none_active`. Con `fiscalDocumentType:"B01"` funciona (el tipo por defecto DO es e-CF y exige certificado) |
| 1.1 | `POST /invoices` cliente QA-FLOW, 7 × 1.234,57, B01 | 201 `FAC-00000001` NCF `B0100000001`, se emite y contabiliza en la misma petición. Subtotal 8.641,99 ✔ (7 × 1.234,57), ITBIS 1.555,56 ✔ (8.641,99 × 0,18 = 1.555,558), total 10.197,55 ✔, costo 3.663,59 ✔ (7 × 523,37) |
| 1.2 | Existencias | `SALE_DISPATCH –7 @523,37`, stock 14 → 7 ✔ |
| 1.3 | Asientos | `VENTAS-2026-000001` Dr 1130 10.197,55 / Cr 4100 8.641,99 / Cr 2130 1.555,56 ✔; `GENERAL-2026-000001` Dr 5100 / Cr 1140 3.663,59 ✔ (claves idempotentes `invoice:<id>:revenue` / `:cost` ✔). Observación: el costo de venta se registra en el diario GENERAL y no en VENTAS; todos los asientos automáticos tienen `entryType = MANUAL` (la distinción queda sólo en `system_reason`) |
| 1.4 | **Dos** `POST /customer-payments` concurrentes por 10.197,55 contra la misma factura (claves distintas, como dos cajeros o doble clic con clave regenerada) | **Ambos 201** (`REC-2026-000001` y `-000002`). Factura: saldo 0, `Paid`. GL: Bancos +20.395,10; CxC **–10.197,55** (saldo acreedor) mientras el subledger dice 0. Ver **FLOW-02** |
| 1.5 | `POST /customer-payments/:id/void` del duplicado | 200; factura vuelve a **saldo 10.197,55 / Pending** aunque REC-1 sigue aplicado → subledger CxC 10.197,55 vs mayor 0 |
| 1.6 | `POST /invoices` dos veces con el mismo cuerpo **y la misma** `Idempotency-Key: qa-flow-fac2` (3 × 1.234,57) | **Dos facturas** `FAC-00000002` (B0100000002) y `FAC-00000003` (B0100000003), ambas descuentan stock y contabilizan. La ruta no es `@Idempotent()` y la cabecera se ignora. Ver **FLOW-03** |
| 1.7 | Cobro de FAC-2: `POST /customer-payments` 4.370,38 (Idempotency-Key) | 201 `REC-2026-000003`, Dr 1120 / Cr 1130 ✔ |
| 1.8 | Conciliación: `POST /reconciliation/statements` multipart CSV (`text/csv`) | **400 `errors.http_400` sin detalle**. Causa: `FileTypeValidator` de Nest 11 valida *magic numbers* sin `fallbackToMimetype`; CSV y OFX no tienen firma → siempre rechazados. Ver **FLOW-04** |
| 1.9 | Mismo extracto en camt.053 (XML): pago –6.175,77, depósito +4.370,38, saldo final –1.805,39 | 201; las 2 líneas se **auto-emparejan** al importar con las líneas de 1120 del pago a proveedor y del cobro 2 ✔. `summary`: difference 0 ✔. `POST .../close` → RECONCILED; `journal_entry_lines.is_reconciled = true` sólo en esas 2 líneas ✔ |

**Veredicto flujo 1: cuadra en el camino feliz secuencial** (impuestos, costo, asientos, stock y conciliación correctos); **NO CUADRA** con cobros concurrentes (FLOW-02) ni con reintentos de creación de factura (FLOW-03); la importación de extractos CSV/OFX está **rota** (FLOW-04).

### Fallos provocados a mitad de flujo (ventas / inventario)
| Prueba | Resultado | Consistencia |
|---|---|---|
| Bloquear cuenta 5100 Costo de Ventas (`PATCH /chart-of-accounts/:id/block`) y emitir factura | 403 `journal_entries.account_code_p2_locked_new_transactions` | ✔ Atómica: no se creó factura, stock intacto (6), secuencia B01 no avanzó (sigue en 3) |
| Bloquear cuenta 5150 y contabilizar ajuste de inventario | 403 mismo código | ✔ stock y movimientos intactos; el ajuste queda en DRAFT |
| Vender 100 uds con stock 6 | 400 `inventory.not_enough_stock_in_warehouse` | ✔ nada persistido |
| Dos facturas concurrentes de 4 uds con stock 6 | Una 201 (`FAC-00000004`), otra 400 sin stock | ✔ stock 2; NCF sin huecos (B0100000004) — `stock-ledger.service.ts:261,287` toma `pessimistic_write` |

Mecanismo (código): la factura, el movimiento de stock, el costo y ambos asientos se hacen **en la misma transacción** por llamadas directas (`invoices.service.ts` → `InvoicePostingService` → `StockLedgerService` / `JournalEntriesService`); no hay outbox/eventos en este camino, por eso un fallo de contabilización revierte todo. Lo mismo para recepción (`purchase-orders.service.ts:401-530` llama a `inventory.receiveGoods(manager, …)`) y cobros/pagos.

---

## Flujo 4 — Ajuste de inventario → asiento

| Paso | Resultado |
|---|---|
| `POST /inventory/adjustments {date:2026-10-31, warehouseId, reason, lines:[{productId, quantityChange:-2}]}` | 201 `AJ-2026-000001` DRAFT |
| `POST /inventory/adjustments/:id/post` | POSTED; movimiento `ADJUSTMENT –2 @523,37`; asiento Dr 5150 / Cr 1140 **1.046,74** (= 2 × 523,37 ✔); stock 6 → 4 |
| Repetir `post` | 409 `inventory.adjustment_not_draft` ✔ |
| Dos `POST /inventory/adjustments/:id/reverse` concurrentes | Uno 201 (`AJ-2026-000002`), otro 409 `adjustment_already_reversed` ✔; stock vuelve a 6; 5150 neto 0 ✔ |
| Inventario en mayor (1140) vs stock × costo | Tras el ajuste: 1140 = 2.093,48 = 4 × 523,37 ✔ |

**Veredicto flujo 4: CUADRA** (incluida su reversión e idempotencia por estado).

---

## Flujo 5 — Anulaciones / reversiones

| Documento | Endpoint | Resultado | Veredicto |
|---|---|---|---|
| Nota de crédito parcial (2 de 7 uds, `restockGoods:true`) sobre FAC-1 | `POST /invoices/:id/credit-note` (Idempotency-Key) | `NC-00000001` NCF **B0400000001** ✔; subtotal 2.469,14, ITBIS 444,45 (2.469,14 × 0,18 = 444,445 ✔), total 2.913,59; `SALE_RETURN +2 @523,37`; asiento Dr 4100 / Dr 2130 / Cr 1130 y Dr 1140 / Cr 5100 1.046,74 ✔; `credited_total` de la factura 2.913,59 ✔ | **Cuadra** |
| Nota de crédito total sobre factura duplicada FAC-3 | idem sin `items` | `NC-00000002` (B0400000002), FAC-3 → `Void`, stock +3 ✔ | **Cuadra** |
| Anular cobro duplicado REC-2 | `POST /customer-payments/:id/void` | asiento `customer-collection-void` ✔ pero la factura vuelve a saldo 10.197,55 aunque REC-1 sigue aplicado | **No cuadra** (consecuencia de FLOW-02) |
| Anular cobro REC-1 | idem | 200; **saldo de la factura 17.481,51 > total 10.197,55** (no existe invariante `0 ≤ balance ≤ total − credited_total`); CxC subledger 17.481,51 vs mayor 1130 = 7.283,96 | **No cuadra** — ver FLOW-05 |
| Anular pago a proveedor ya conciliado | `POST /vendor-payments/:id/void` | 403 `entry_containing_reconciled_lines_cannot_reversed` ✔ (hay que reabrir el extracto) | Correcto |
| Anular factura de proveedor con pagos | `POST /accounts-payable/:id/void` | 400 `bill_with_payments_applied_cannot_voided` ✔ | Correcto |
| Anular recepción fantasma GR-3 (FLOW-01) | `POST /procurement/receipts/:id/void` | 400 `procurement.receipt_already_billed` porque `received_quantity` (10, ya corrupto) − 4 < `billed_quantity` 10 → la sobre-recepción **no se puede corregir por el camino normal**; GRNI queda con –2.093,48 sin documento que lo explique | **Roto** (consecuencia de FLOW-01) |
| Reversión de ajuste de inventario | ver flujo 4 | ✔ | **Cuadra** |
| Anulación de nómina | ver flujo 3 | | |

---

## Flujo 6 — Cierre de período

Pasos: `POST /accounting/close-period {periodId}` — exige cierre en orden (cerrar septiembre con enero abierto → 400 `period_cannot_closed_while_name_still` ✔). Se cerraron enero–septiembre 2026 (200 CLOSED, GL/AP/AR/INV CLOSED).

| Intento con fecha 2026-09-xx (período cerrado) | Resultado |
|---|---|
| Factura de venta `POST /invoices issueDate 2026-09-15` | 403 `accounting.transaction_date_falls_accounting_period_name` ✔ |
| Orden de compra `orderDate 2026-09-15` | 201 (correcto: compromiso sin asiento) |
| Recepción de esa OC `receivedAt 2026-09-20` | 403 mismo código ✔ |
| Factura de proveedor `date 2026-09-15` | 403 ✔ |
| Cobro `paymentDate 2026-09-20` | 403 ✔ |
| Ajuste de inventario `date 2026-09-20` | 400 `inventory.adjustment_date_period_closed` (al crear el borrador) ✔ |
| Asiento manual `POST /journal-entries date 2026-09-20` | 403 ✔ |
| Nómina con período en septiembre | ver flujo 3 |

Mecanismo: una sola función `resolvePostingPeriod` (`accounting/period-status.ts:~60-100`) que comprueba el estado general y el del submódulo; la única excepción es `journal-entries/adjustments.service.ts:347` (`allowClosedPeriod: true`, ajustes de auditoría, sólo GL). Riesgo no probado: `findPeriodCovering` (`period-status.ts:139-151`) lee el período **sin bloqueo** (`FOR SHARE`), así que una contabilización concurrente con el cierre puede entrar en el período que se está cerrando (FLOW-08).

**Veredicto flujo 6: CUADRA** (todas las entradas probadas respetan el cierre).

---

## Flujo 3 — Nómina → asientos → pago/tesorería (PARCIALMENTE PROBADO)

| Paso | Resultado |
|---|---|
| `POST /auth/step-up {scope:"manage_compensation"}` + `POST /hcm/employees` (QA-FLOW Empleado Uno, cédula 00100123454, salario 45.678,91 mensual) | 201 |
| `POST /payroll/runs {periodYear:2026, periodMonth:10}` y otra para mes 9 (período cerrado) | 201 ambas en DRAFT (crear/calcular no contabiliza) |
| `POST /payroll/runs/:id/calculate` | CALCULATED: bruto 45.678,91; deducciones empleado 3.943,76; neto 41.735,15; aportes patronales 7.378,62. Rehecho a mano: AFP 2,87 % = 1.310,98 + SFS 3,04 % = 1.388,64 + ISR mensual 1.244,14 (base anual (45.678,91 − 2.699,62) × 12 = 515.751,48; exceso sobre 416.220,01 × 15 % / 12) = **3.943,76 ✔** (escala vigente: verificar con contador local). Patronal: AFP 7,10 % 3.243,20 + SFS 7,09 % 3.238,63 + INFOTEP 1 % 456,79 + SRL 440,00 (≈1 % con tope) = 7.378,62 ✔ |
| `POST /payroll/runs/:id/approve` (con step-up `approve_payroll`) | 403 `payroll.whoever_approves_payroll_cannot_whoever_calculated` — segregación de funciones ✔ |
| Aprobar con un segundo usuario | **No probado**: el alta de usuarios es por invitación con token en hash (`users.invitationToken` 64 caracteres) enviado por correo; no se puede completar sin correo ni escribiendo en BD (fuera de las reglas). |
| `POST /payroll/runs/:id/cancel` sobre la corrida de septiembre (CALCULATED) | 201 CANCELLED ✔ |

Análisis de código (no ejecutado): `approve` (`payroll/services/payroll-run.service.ts:352-378`) contabiliza en la misma transacción vía `PayrollAccountingService.postRun` con fecha `run.periodEnd` y clave idempotente `payroll:<runId>` (`payroll-accounting.service.ts:155-162`); `markPaid` (`:386-418`) contabiliza Dr 2140 / Cr banco con `payroll-payment:<runId>` (`:218-225`). Ambos pasan por `JournalEntriesService`, que llama a `resolvePostingPeriod` → una corrida de un mes cerrado no se podría aprobar (esperado, no ejecutado). El pago sólo genera asiento sobre la cuenta GL del banco (no hay movimiento de tesorería propio; la conciliación trabaja sobre líneas GL, así que es coherente). Una corrida APPROVED/PAID **no se puede anular** (`:470-472` "use adjustment"): la corrección es una corrida de ajuste (`correctsRunId`). No existe reversión del pago de nómina (búsqueda de `void|reverse` en `payroll/`: sin resultados de endpoint).

**Veredicto flujo 3: no probado de punta a punta** (cálculo ✔; asiento y pago no ejecutados por la segregación de funciones sin segundo usuario disponible).

---

## Flujo 7 — Cambios de configuración

| Cambio | Prueba | Efecto en documentos nuevos | Efecto en históricos |
|---|---|---|---|
| Tasa del impuesto "ITBIS 18 %" → 17 (`PATCH /taxes/:id {rate:17}`) | Factura nueva FAC-5 de 1 × 1.234,57 | **Sigue cobrando 18 %** (ITBIS 222,22, `taxRate 0.18`): la tasa sale del producto (`products.tax_rate`), el catálogo `taxes` sólo actúa como lista de tasas admitidas (`invoices.service.ts:586-597`). Ver FLOW-06 | Sin cambio (las líneas guardan `taxRate`) ✔ |
| Bloqueo de cuenta contable por defecto (5100/5150) | ver "Fallos provocados" | Rechazo atómico ✔ | n/a |
| Tasa de cambio USD/DOP 61,2345 (`POST /exchange-rates`) | Factura en USD | **400 `currencies.stated_rate_requested_deviates_too_far` (requested 61,23 vs resolved 61,2345, tolerance 0)** — imposible facturar en moneda extranjera con una tasa de más de 2 decimales. Ver FLOW-05b | — |
| Tasa EUR/DOP 70,50 | Factura FAC-6 en EUR 17,51 + ITBIS 3,15 = 20,66 | ✔ base 1.456,53; asiento con moneda extranjera y 0,01 de redondeo a 5750 ✔ | — |
| Re-registrar EUR 72,25 para la misma fecha y luego `DELETE /exchange-rates/:id` | — | — | FAC-6 conserva 70,50 y su asiento también ✔. Pero la tasa usada por un documento contabilizado **se puede sobrescribir y borrar** sin rastro (el asiento dice `source MANUAL` de una cotización que ya no existe) — Baja/Media |

**Veredicto flujo 7: históricos inmutables ✔; configuración de impuestos desconectada (FLOW-06) y multimoneda rota con tasas reales (FLOW-05b).**

---

## Hallazgos

### FLOW-01 — Recepciones concurrentes de una OC sobre-reciben: stock, GRNI y asientos de más, y `received_quantity` con actualización perdida
- **Módulos:** compras (procurement), inventario, contabilidad · **Eje:** corrección e integridad · **Categoría:** integridad de datos · **Severidad: CRÍTICA**
- **Ubicación:** `apps/backend/api/src/app/procurement/purchase-orders.service.ts:401-402` (`receiveDocument` lee la orden con `findOneWith`, `:560-571`, **sin bloqueo**), validación `:424-430` sobre datos leídos sin bloqueo, escritura `:487` (`line.receivedQuantity = line.receivedQuantity + quantity`, último en escribir gana). Endpoint `POST /procurement/orders/:id/receive` **no** es `@Idempotent()` (`purchase-orders.controller.ts`; sólo lo son `POST /` y `from-requisition`).
- **Evidencia:** OC de 10 uds; recepción de 6 y luego dos recepciones concurrentes de 4 → ambas 200; 3 recepciones (6+4+4 = 14), `stock_levels` 14, 3 asientos Dr 1140 / Cr 2115 por 7.327,18, pero `purchase_order_lines.received_quantity = 10`. La anulación de la recepción sobrante falla (`procurement.receipt_already_billed`) porque compara contra el `received_quantity` ya corrupto: el GRNI queda con –2.093,48 sin documento que lo explique y sin camino de corrección salvo asiento manual + ajuste.
- **Forma correcta:** `SELECT … FROM purchase_order_lines WHERE order_id=$1 ORDER BY id FOR UPDATE` (como ya hace `goods-receipts.service.ts:251-253` al anular) antes de validar; o `UPDATE … SET received_quantity = received_quantity + $q WHERE id=$1 AND received_quantity + $q <= quantity RETURNING`; marcar la ruta `@Idempotent()`; test de concurrencia con BD real.
- **Impacto:** bloquea la venta (inventario y pasivo inflados, 3-way match inservible). **Esfuerzo:** S.

### FLOW-02 — Cobros concurrentes contra la misma factura se aplican dos veces (CxC del mayor ≠ subledger)
- **Módulos:** CxC (customers), facturación, contabilidad, tesorería · **Severidad: CRÍTICA** · **Categoría:** integridad de datos
- **Ubicación:** `apps/backend/api/src/app/customers/customer-payments.service.ts:254-262` (`manager.find(Invoice, …)` **sin** `lock`), control de saldo `:~300-307` sobre esa lectura; la Idempotency-Key no protege porque cada intento lleva su clave (dos cajeros, dos pestañas, reintento del cliente que regenera la clave).
- **Evidencia:** 2 × `POST /customer-payments` de 10.197,55 en paralelo → `REC-2026-000001` y `-000002`; factura saldo 0 `Paid`; Bancos +20.395,10; 1130 = –10.197,55. Al anular uno, la factura vuelve a 10.197,55 aunque el otro sigue aplicado (subledger 10.197,55 vs mayor 0).
- **Forma correcta:** bloquear las facturas aplicadas (`lock: { mode: 'pessimistic_write' }` o `FOR UPDATE ORDER BY id`) antes de validar saldos — igual que AP (`accounts-payable.service.ts:905`, `vendor-payments.service.ts:161`); `CHECK (balance >= 0 AND balance <= net_receivable)`; prueba de concurrencia.
- **Impacto:** bloquea la venta (doble registro de caja, cartera falsa). **Esfuerzo:** S.

### FLOW-03 — `POST /invoices` ignora la Idempotency-Key: un reintento emite una segunda factura fiscal
- **Módulos:** facturación, inventario, contabilidad, cumplimiento DO (NCF) · **Severidad: ALTA** · **Categoría:** integridad de datos / robustez
- **Ubicación:** `apps/backend/api/src/app/invoices/invoices.controller.ts:65-68` (sin `@Idempotent()`; la creación también emite, numera NCF, descuenta stock y contabiliza).
- **Evidencia:** mismo cuerpo y misma `Idempotency-Key: qa-flow-fac2` dos veces → `FAC-00000002` (B0100000002) y `FAC-00000003` (B0100000003), stock y asientos duplicados; hubo que emitir NC B04 para anularla.
- **Forma correcta:** `@Idempotent()` en `POST /invoices` (y en `PUT /:id` cuando emite) y en `POST /procurement/orders/:id/receive`, `POST /accounts-payable`, `POST /inventory/adjustments/:id/post`, `POST /payroll/runs/:id/{approve,pay}`; que el cliente web envíe la clave.
- **Impacto:** riesgo operativo y fiscal (NCF consumidos que hay que anular ante DGII — verificar con contador). **Esfuerzo:** S.

### FLOW-04 — Importación de extractos bancarios CSV y OFX siempre rechazada (400 sin detalle)
- **Módulos:** conciliación, tesorería · **Severidad: ALTA** · **Categoría:** bug / funcionalidad rota
- **Ubicación:** `apps/backend/api/src/app/reconciliation/reconciliation.controller.ts:244-251` — `new FileTypeValidator({ fileType: /(csv|xml|ofx|plain|octet-stream|vnd\.ms-excel)/ })` en Nest 11.2.6 valida por *magic numbers* (`node_modules/@nestjs/common/pipes/file/file-type.validator.js:54-97`) y sin `fallbackToMimetype` devuelve `false` para archivos sin firma. Probado: `file-type` devuelve `undefined` para CSV y OFX y `application/xml` sólo para camt.053.
- **Evidencia:** CSV válido → `400 errors.http_400`; el mismo extracto en camt.053 → 201 y auto-conciliación correcta.
- **Forma correcta:** `fallbackToMimetype: true` (o `skipMagicNumbersValidation`) y dejar que `detectBankFileFormat` decida; mensaje de error localizado; test e2e de subida CSV/OFX.
- **Impacto:** bloquea la venta de conciliación a la mayoría de bancos LatAm (exportan CSV/OFX). **Esfuerzo:** S.

### FLOW-05 — La anulación de un cobro suma sin tope: saldo de factura mayor que su total
- **Módulos:** CxC, facturación · **Severidad: ALTA** · **Categoría:** integridad de datos
- **Ubicación:** `apps/backend/api/src/app/customers/customer-payments.service.ts:~611-615` (`invoice.balance = roundAmount(invoice.balance + line.amount)`; el estado compara con `netReceivable` e ignora `credited_total`). Sin `CHECK` en `invoices.balance`.
- **Evidencia:** FAC-1 total 10.197,55, NC 2.913,59 → tras anular cobros: `balance 17.481,51`, status `Pending`; mayor 1130 = 7.283,96.
- **Forma correcta:** recalcular el saldo desde la fuente (`net_receivable − credited_total − Σ aplicaciones vigentes`) en vez de sumar/restar; `CHECK (balance BETWEEN 0 AND net_receivable)`; control periódico subledger CxC/CxP vs mayor.
- **Impacto:** riesgo operativo (cartera y cobranza erróneas). **Esfuerzo:** S–M.

### FLOW-05b — Documentos en moneda extranjera fallan con cualquier tasa de más de 2 decimales
- **Módulos:** contabilidad (journal-entries), monedas, facturación (y todo documento multimoneda) · **Severidad: ALTA** · **Categoría:** bug / multi-país
- **Ubicación:** `apps/backend/api/src/app/journal-entries/journal-entries.service.ts:482` pasa la tasa del documento por `this.amount()` (`:749-751`, `roundAmount` a 2 decimales) y `currencies/exchange-rate-resolver.service.ts:278-281` la compara con la cotización (6 decimales) con la tolerancia del tenant, que en esta organización es `0.000000` (la migración `1789000000000-LedgerInvariants.ts:112` pone 0,02 por defecto: verificar con el equipo qué la puso a 0 en el alta).
- **Evidencia:** USD/DOP 61,2345 → factura USD: `400 stated_rate_requested_deviates_too_far {requested:61.23, resolved:61.2345, tolerance:0}`. Con EUR/DOP 70,50 funciona. Con tolerancia > 0 el asiento usaría 61,23 y la factura 61,2345 (descuadre subledger–mayor).
- **Forma correcta:** redondear la tasa a 6 decimales (`roundAmount(x, 6)`), nunca con el redondeo monetario; test con tasa de 4+ decimales.
- **Impacto:** bloquea la venta multimoneda (casi todas las tasas reales tienen 4 decimales). **Esfuerzo:** S.

### FLOW-06 — Cambiar la tasa en el catálogo de impuestos no afecta a la facturación
- **Módulos:** impuestos, facturación, inventario · **Severidad: MEDIA** · **Categoría:** arquitectura / multi-país
- **Ubicación:** `apps/backend/api/src/app/invoices/invoices.service.ts:586-597` (`tenantTaxRates` sólo lista tasas admitidas); la tasa aplicada sale de `products.tax_rate`.
- **Evidencia:** ITBIS 18 % → 17 en `/taxes`; factura nueva FAC-5 sigue al 18 %. Un cambio legal de tasa obliga a editar producto por producto.
- **Forma correcta:** el producto referencia un código de impuesto (`taxId`/grupo) con tasas versionadas por vigencia; la línea guarda la tasa aplicada (como hoy). Verificar con el equipo si el diseño "tasa en el producto" es deliberado.
- **Impacto:** brecha competitiva / riesgo fiscal ante cambios de tasa. **Esfuerzo:** M.

### FLOW-07 — Step-up de un solo uso evaluado antes que la réplica idempotente
- **Módulos:** auth, CxP, tesorería · **Severidad: BAJA/MEDIA** · **Categoría:** UX / robustez
- **Ubicación:** `accounts-payable.controller.ts:142-145` (`@Idempotent()` + `@RequireStepUp(MOVE_FUNDS)`; el guard corre antes que el interceptor).
- **Evidencia:** reintento del mismo pago con la misma clave → `401 step_up_token_already_used`; con step-up nuevo → réplica correcta (sin duplicar). Seguro, pero un reintento de red tras timeout obliga a reautenticar sin saber si se pagó.
- **Forma correcta:** permitir la réplica de una clave completada sin consumir step-up, o devolver el resultado guardado antes del guard. **Esfuerzo:** S.

### FLOW-08 — El período se lee sin bloqueo al contabilizar (carrera con el cierre) — no probado
- **Módulos:** contabilidad y todos los que contabilizan · **Severidad: MEDIA** · **Categoría:** integridad
- **Ubicación:** `apps/backend/api/src/app/accounting/period-status.ts:139-151` (`findPeriodCovering` sin `FOR SHARE`); el cierre no puede serializarse contra contabilizaciones en curso.
- **Forma correcta:** `FOR SHARE` del período al contabilizar y `FOR UPDATE` al cerrar. **Esfuerzo:** S. *No se ejecutó la carrera.*

### Observaciones menores
- Todos los asientos automáticos llevan `entryType = MANUAL`; sólo `system_reason` los distingue (Baja).
- Asientos de factura de proveedor y pago a proveedor sin `idempotency_key` (protegidos por estado y bloqueo, no por clave) (Baja).
- Factura de proveedor de un bien (`kind GOOD`) clasificada como `servicesAmount` (afecta el 606 — verificar con contador) (Media, módulo CxP).
- Una tasa de cambio usada por documentos contabilizados se puede sobrescribir/borrar (Baja).
- El tipo NCF por defecto en DO es e-CF (E31) y exige certificado; sin él la factura falla con un error poco orientador (Media, UX).

---

## Resumen por flujo

| Flujo | Veredicto | Motivo principal |
|---|---|---|
| 1. Venta → stock → costo → asiento → CxC → cobro → conciliación | **No cuadra bajo concurrencia** (cuadra en secuencial) | FLOW-02 (cobro doble), FLOW-03 (factura duplicada en reintento), FLOW-04 (CSV/OFX rotos; camt.053 ✔) |
| 2. OC → recepción → stock/costo → factura prov. → CxP → pago → asiento | **No cuadra bajo concurrencia** (cuadra en secuencial) | FLOW-01 (sobre-recepción) |
| 3. Nómina → asientos → pago | **No probado de punta a punta** | Cálculo ✔ (rehecho a mano); aprobar/pagar exige un segundo usuario (segregación de funciones) que no se pudo crear sin correo |
| 4. Ajuste de inventario → asiento | **Cuadra** | Incluida reversión e idempotencia por estado |
| 5. Anulaciones/reversiones | **Mixto** | NC parcial/total ✔, reversión de ajuste ✔, bloqueos de anulación ✔; anulación de cobro **no cuadra** (FLOW-05); recepción fantasma **no corregible** (FLOW-01); anulación de nómina inexistente por diseño (corrida de ajuste), no probada |
| 6. Cierre de período | **Cuadra** | Ventas, recepción, CxP, cobro, ajuste y asiento manual bloqueados; nómina no ejecutada (por código, bloqueada); carrera sin bloqueo (FLOW-08) no probada |
| 7. Cambios de configuración | **Mixto** | Históricos inmutables ✔; catálogo de impuestos desconectado (FLOW-06); multimoneda rota con tasas reales (FLOW-05b) |

Balanza: Σ debe = Σ haber en todo momento (control `bal.sh`). Fallos provocados (cuenta bloqueada, sin stock) son atómicos porque todo el encadenamiento es por llamadas directas dentro de **una transacción** (sin outbox/eventos en estos caminos): la integridad falla por **falta de bloqueos e idempotencia**, no por inconsistencias a medias.

## Lo no probado
- Aprobación/pago de nómina (y su asiento, período cerrado y reintento): requiere segundo usuario (invitación por correo, token guardado en hash).
- Carrera contabilización vs cierre (FLOW-08); sobrepago de factura de proveedor (el segundo step-up se rechazó); pagos a proveedor concurrentes (por código tienen `FOR UPDATE`, `vendor-payments.service.ts:147-161`).
- Cambio de cuenta contable por defecto en `organization_settings` (no se encontró endpoint en el tiempo disponible); POS y transferencias no cubiertos.
- Cobertura aproximada: ~30 endpoints ejecutados en 9 módulos; código leído en procurement, customers, invoices, journal-entries, accounting/period-status, payroll, reconciliation, currencies, idempotency.

## Datos QA creados (organización b5182378-…)
Facturas FAC-00000001…6, NC-00000001/2, OC PO-2026-000001/2, recepciones GR-2026-000001…3, factura proveedor B0100000101, pago PAY-2026-000001, cobros REC-2026-000001…3, ajustes AJ-2026-000001/2, extracto QA-FLOW-STMT-1 (conciliado), corridas de nómina oct (CALCULATED) y sep (CANCELLED), empleado QA-FLOW, usuario invitado qa-flow-approver (PENDING), tasas USD/DOP; períodos enero–septiembre 2026 **cerrados**.
