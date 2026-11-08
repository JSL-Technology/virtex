# 06 — Integración entre módulos (flujos cruzados) — Paso 8, familia XF

Fecha: 2026-11-07 19:54 – 2026-11-08 00:43 UTC (con un reinicio del contenedor entre medias). Tenant propio `qa-do-xflow@virtex.test` (org `adbe7370-b7af-4bcb-b1d5-4572e6781076`, DO, plan Starter). Multi-país: `qa-mx-a`, `qa-us-a` (solo documentos `QA-XF-`).
Herramientas: API real `http://localhost:3000/api/v1` con el cliente QA (`QA_SESSION=xf`, clave de idempotencia aleatoria por llamada), SQL de solo lectura sobre `erp`. Scripts y respuestas crudas: `/tmp/claude-0/-home-user-virtex/18f6e197-474f-5038-b8e5-f1d402f375bd/scratchpad/agents/xf/` (`log.txt` = traza con tiempos de cada llamada; `ids.env` = ids; `gl.sh` = mayor por cuenta).
Tiempos: todas las llamadas de escritura entre 220 y 480 ms en local (sin carga). No se observó ninguna llamada >500 ms en los flujos 1–5.

Consulta de mayor usada en todo el documento (`gl.sh`):
```sql
select a.code, sum(l.debit) d, sum(l.credit) c, sum(l.debit-l.credit) net
from journal_entry_lines l join journal_entries j on j.id=l.journal_entry_id join accounts a on a.id=l.account_id
where j.organization_id='adbe7370-…' and j.status='Posted' group by 1 order by 1;
```

Datos maestros creados: cliente `QA-XF Cliente Uno SRL` (RNC 131246753), proveedor `QA-XF Proveedor Uno SRL` (RNC 101010632), producto `QA-XF-Widget` (`QA-XF-W1`, precio 1.234,57, ITBIS 18 %, promedio ponderado), cuenta bancaria `QA-XF Banco Corriente` (DOP, GL 1120), secuencias NCF B01 y B04 1–500 (`POST /compliance/ncf-sequences` exige `expiresAt`, correcto para DO).

## Resumen de veredictos

| # | Flujo | Veredicto |
|---|---|---|
| 2 | OC → recepción → CxP → pago → asiento | **OK** |
| 1 | Venta → existencias → costo → asiento → CxC → cobro → conciliación | **OK** (con fricciones de conciliación, ver XF-01/XF-02) |
| 4 | Ajuste de inventario → asiento | **OK** |
| 5 | Anulación/reversión de 1, 2 y 4 | **OK** — todas las cuentas vuelven a 0,00; sin saldos huérfanos en subledgers |
| 6 | Cierre de período y efecto | **OK** — bloqueo en servidor en todos los caminos, también entre pasos; reservas XF-05 |
| 9 | Flujo 1 en MX y US | US **OK con reservas** (impuesto 0 sin nexo: FAC-INV-06; XF-06); MX bloqueado correctamente sin CSD; IVA 16 % correcto en el preview; plan de cuentas con cuentas DO (ya conocido); XF-07 |
| 7 | Cambios de configuración vs históricos | históricos **OK**; nuevos **a medias** (XF-08, XF-10); moneda extranjera **rota** con tasas reales (XF-09) |
| 8 | Fallo a mitad de flujo | **OK**: 4 fallos provocados y en ninguno quedaron escrituras parciales |
| 3 | Nómina → asientos → tesorería | **no ejecutado** (requiere un segundo aprobador); revisado en código: atómico (lo ejecutó NOM) |

---

## Flujo 2 — Compra: OC → recepción → CxP → pago → asiento — **OK**

| Paso | Endpoint / body resumido | Respuesta | Tiempo |
|---|---|---|---|
| 2.1 | `POST /procurement/orders` `{supplierId, orderDate:2026-11-07, DOP, lines:[{productId, qty:10, unitPrice:617.29, taxRate:0.18}], notes:"QA-XF-1 OC"}` | 201 `PO-2026-000001`, subtotal 6.172,90, ITBIS 1.111,12, total 7.284,02 | 270 ms |
| 2.2 | `POST …/:id/submit` → `/approve` → `/send` | 200 ×3 (autoaprobación posible: org de un usuario, ya reportado CMP-13) | 245–259 ms |
| 2.3 | `POST /procurement/orders/:id/receive {lines:[{lineId, quantity:10}], receivedAt:2026-11-07}` | 200, OC `RECEIVED`; `GR-2026-000001` | 476 ms |
| 2.4 | `POST /accounts-payable {vendorId, purchaseOrderId, ncf:B0100000731, goodsAmount:6172.90, taxAmount:1111.12, total:7284.02, lines:[{…purchaseOrderLineId, qty 10, 617.29}]}` | 201 `DRAFT`, sin asiento | 342 ms |
| 2.5 | `POST /accounts-payable/:id/submit-for-approval` | 200 `OPEN`, `journalEntryId` f4c7c5b4…, saldo 7.284,02 | 407 ms |
| 2.6 | `POST /auth/step-up {scope:move_funds}` + `POST /accounts-payable/payments {paymentDate, bankAccountId, reference:"QA-XF-3 PAGO", lines:[{vendorBillId, amount:7284.02}]}` | 201 `PAY-2026-000001` `PAID`; factura proveedor `PAID` saldo 0 | 447 ms |

Cifras (esperado a mano = obtenido en SQL):
- Tras 2.3: Dr 1140 Inventarios 6.172,90 / Cr 2115 Mercancía recibida no facturada 6.172,90. `stock_movements`: `PURCHASE_RECEIPT` 10 × 617,29; `products.stock`=10, costo 617,29. ✔
- Tras 2.5: Dr 2115 6.172,90 + Dr 1150 ITBIS crédito fiscal 1.111,12 / Cr 2110 CxP 7.284,02 → 2115 queda en 0,00. ✔ (6.172,90 × 0,18 = 1.111,122 → 1.111,12)
- Tras 2.6: Dr 2110 7.284,02 / Cr 1120 Bancos 7.284,02 → CxP mayor 0,00 = Σ saldos de `vendor_bills` abiertos (0). ✔
- Inventario contable 1140 = 6.172,90 = Σ existencias (10 × 617,29). ✔

Observación menor: `stock_movements.value` queda `NULL` en la recepción (el valor solo se deduce de `quantity × cost`), lo que obliga a cualquier informe de valoración a recalcular (ver XF-03).

## Flujo 1 — Venta → existencias → costo → asiento → CxC → cobro → conciliación — **OK**

| Paso | Endpoint / body | Respuesta | Tiempo |
|---|---|---|---|
| 1.1 | `POST /invoices {customerId, issueDate:2026-11-07, dueDate:2026-12-07, fiscalDocumentType:"B01", notes:"QA-XF-4 FACT", lineItems:[{productId, quantity:3}]}` | 201 `FAC-00000001`, NCF `B0100000001`, estado `Pending`, subtotal 3.703,71, ITBIS 666,67, total 4.370,38, `cost_of_sale` 1.851,87, `journal_entry_id` y `cost_journal_entry_id` presentes | 426 ms |
| 1.2 | `POST /invoices/:id/issue` | 409 `invoices.document_invoice_number_has_already_issued` (la B01 se emite al crearla; el 409 es coherente) | 383 ms |
| 1.3 | `POST /customer-payments {customerId, paymentDate, bankAccountId, currencyCode:DOP, amountReceived:4370.38, reference:"QA-XF-5 COBRO", lines:[{invoiceId, amount:4370.38}]}` | 201 `REC-2026-000001`; factura `Paid`, saldo 0 | 307 ms |
| 1.4 | `POST /reconciliation/statements` (multipart CSV: `Entrada 4.370,38 "QA-XF-5 COBRO"`, `Salida 7.284,02 "QA-XF-3 PAGO"`, saldo inicial 0, final −2.913,64, `debitColumn:Entrada`, `creditColumn:Salida`) | 201 `IMPORTED`, ambas líneas `MATCHED` automáticamente | 288 ms |
| 1.5 | `GET …/:id/summary` → `POST …/:id/close` | `difference:0, isReconciled:true` → 200 `RECONCILED`; las dos líneas de 1120 quedan `is_reconciled=true` | 301 / 241 ms |

Cifras (a mano = SQL):
- 3 × 1.234,57 = 3.703,71; ITBIS 3.703,71 × 0,18 = 666,6678 → 666,67; total 4.370,38. ✔
- Asiento de venta: Dr 1130 CxC 4.370,38 / Cr 4100 Ventas 3.703,71 / Cr 2130 ITBIS por pagar 666,67. ✔
- Asiento de costo: Dr 5100 Costo de ventas 1.851,87 (3 × 617,29) / Cr 1140 1.851,87. ✔ Existencias 10 → 7; 1140 = 4.321,03 = 7 × 617,29. ✔
- Cobro: Dr 1120 4.370,38 / Cr 1130 4.370,38 → mayor CxC 0,00 = Σ `invoices.balance` abiertas (0). ✔
- Banco libro −2.913,64 = 4.370,38 − 7.284,02 = saldo final del extracto. ✔

Fricciones encontradas en la conciliación (detalles en XF-01 y XF-02):
- Primer intento con el CSV en convención bancaria (Débito = salida, Crédito = entrada, como lo emiten los bancos dominicanos): el importador interpreta `debitColumn` como **entrada** (`parsers/column-mapping.ts:22-24`, "Money into the account (the importer's `debitColumn`)"), el cobro aparece como −4.370,38 y no hay ningún candidato (`suggestions` → `confidence:"none"`). El resumen sigue diciendo `statementEndingBalance −2.913,64 = bookBalance` aunque las transacciones están invertidas.
- El segundo extracto para la **misma cuenta y el mismo rango de fechas** se aceptó: quedan dos extractos abiertos solapados (`bb031719…` IMPORTED sin emparejar y `e3b5c857…`).

## Flujo 4 — Ajuste de inventario → asiento — **OK**

| Paso | Endpoint / body | Respuesta | Tiempo |
|---|---|---|---|
| 4.1 | `POST /inventory/adjustments {date:2026-11-07, warehouseId:"Almacén principal", reason:"QA-XF-6 merma", lines:[{productId, quantityChange:-2}]}` | 201 `AJ-2026-000001` `DRAFT` | 264 ms |
| 4.2 | `POST /inventory/adjustments/:id/post {}` | 201 `POSTED`, `journalEntryId` 86461a6b… | 249 ms |

Cifras: 2 × 617,29 = 1.234,58 → Dr 5150 Ajustes de inventario 1.234,58 / Cr 1140 1.234,58. Existencias 7 → 5 (`products.stock` y `stock_levels.quantity_on_hand` = 5). 1140 = 3.086,45 = 5 × 617,29. ✔

## Flujo 5 — Anulación/reversión de los flujos 1, 2 y 4 — **OK**

Orden ejecutado y resultado:

| Paso | Endpoint | Respuesta | Efecto verificado |
|---|---|---|---|
| 5.1 | `POST /inventory/adjustments/:id/reverse {reason:"QA-XF-7…"}` | 201 `AJ-2026-000002` | 5150 neto 0; existencias 7; 1140 = 4.321,03 ✔ |
| 5.2 | `POST /customer-payments/:id/void {reason}` (cobro conciliado) | **403** `journal_entries.entry_containing_reconciled_lines_cannot_reversed` | correcto: no se anula lo conciliado ✔ |
| 5.3 | `POST /reconciliation/statements/:id/reopen {reason}` y reintento de 5.2 | 200 reabre, pero 5.2 sigue 403: reabrir no deshace los emparejamientos | hay que borrar cada match (`DELETE /reconciliation/matches/:id` ×2 → 204) |
| 5.4 | `POST /customer-payments/:id/void` | 200 `VOID`; factura vuelve a `Pending` saldo 4.370,38; 1130 = 4.370,38 = Σ saldos abiertos ✔ | 288 ms |
| 5.5 | `POST /invoices/:id/credit-note {reason:"QA-XF-10…", modificationCode:"1", restockGoods:true}` | 201 `NC-00000001` NCF `B0400000001` total 4.370,38; factura `Void` saldo 0 `credited_total` 4.370,38 | 1130, 4100, 2130, 5100 netos 0; existencias 10; 1140 = 6.172,90 ✔ |
| 5.6 | `POST /vendor-payments/:id/void {reason}` | 200 `VOID` | 1120 y 2110 restaurados ✔ |
| 5.7 | `POST /accounts-payable/:id/void {reason}` | 200 `VOID` saldo 0 | 1150 y 2110 netos 0; 2115 vuelve a −6.172,90 ✔ |
| 5.8 | `POST /procurement/receipts/:id/void {reason}` | 200 `VOID` | 1140 y 2115 netos 0; existencias 0; línea OC `received_quantity=0`, `billed_quantity=0`; OC vuelve a `SENT` ✔ |

Balance final (SQL): las 10 cuentas tocadas (1120, 1130, 1140, 1150, 2110, 2115, 2130, 4100, 5100, 5150) tienen **neto 0,00**; no queda ningún asiento borrado (todo por contraasiento). Ningún saldo huérfano en `invoices`, `vendor_bills`, `customer_payments`, `stock_levels`, `purchase_order_lines`.
Observaciones: la NC registra la devolución en 4100 (Ventas) en lugar de 4300 (Descuentos y devoluciones sobre ventas, que existe con `system_role SALES_DISCOUNTS`) → los informes pierden la cifra de devoluciones (XF-04, baja). El extracto `e3b5c857…` queda reabierto y sin emparejar tras las anulaciones (comportamiento correcto: no se puede cerrar lo que ya no cuadra).

## Flujo 6 — Cierre de período y su efecto — **OK** (con reservas XF-05)

Ejecutado el 2026-11-08 00:35–00:37 UTC (la fecha del sistema avanzó al 8 de noviembre durante la auditoría).
Preparación (período abierto): `PO-2026-000002` (10 u × 617,29), recepción de 5 u fechada 2026-11-07 (1.198 ms, la más lenta de la sesión), factura `FAC-00000002` NCF `B0100000002` 2 u = 2.469,14 + ITBIS 444,45 = 2.913,59 abierta.
Cuadre previo al cierre: mayor 1130 = 2.913,59 = Σ `invoices.balance` abiertas (SQL) ✔; 1140 = 1.851,87 = 3 u × 617,29 ✔; 2115 = −3.086,45 = 5 u recibidas no facturadas ✔.

| Paso | Endpoint / body | Respuesta |
|---|---|---|
| 6.1 | `GET /accounting/periods/:nov/closing-checklist` | 200; ítem `unreconciled-bank-transactions` **no completado** (4 movimientos sin conciliar) |
| 6.2 | `POST /accounting/close-period {periodId:nov}` | 400 `accounting.period_cannot_closed_while_name_still {name:"Enero 2026"}` — obliga a cierre secuencial ✔ |
| 6.3 | Cierre de enero…octubre (10 llamadas) y de noviembre | 200 ×11 (225–513 ms). Noviembre `CLOSED` en GL/CxP/CxC/inventario, **con la lista de verificación incompleta y el mes aún en curso** (XF-05) |
| 6.4 | `POST /invoices/:FAC-2/credit-note` (fecha hoy 2026-11-08, cerrada) | 403 `accounting.transaction_date_falls_accounting_period_name` ✔ |
| 6.5 | `POST /customer-payments {paymentDate:2026-11-07, …}` | 403 mismo código ✔ |
| 6.6 | `POST /procurement/orders/:PO2/receive {receivedAt:2026-11-07, qty 5}` | 403 mismo código ✔ |
| 6.7 | `POST /inventory/adjustments {date:2026-11-07}` | 400 `inventory.adjustment_date_period_closed` ✔ (código y status distintos al resto: 400 vs 403) |
| 6.8 | `POST /invoices {issueDate:2026-11-07, B01}` | 403 ✔ (no consume NCF: `B01` sigue en 2) |
| 6.9 | `POST /accounts-payable {date:2026-11-07}` | 403 ✔ |
| 6.10 | `POST /procurement/receipts/:GR-2/void` | 400 `inventory.not_enough_stock_in_warehouse` (se valida stock antes que período; también se bloquea) |
| 6.11 | **Cierre entre pasos**: reabrir (`POST /accounting/reopen-period {periodId, reason}` → 200), crear borrador de factura de proveedor (fecha 11-07) y borrador de ajuste (fecha 11-07), cerrar noviembre, luego `POST /accounts-payable/:id/submit-for-approval` y `POST /inventory/adjustments/:id/post` | 403 / 400; en BD la factura queda `DRAFT` sin asiento y el ajuste `DRAFT` — **consistente, sin escrituras parciales** ✔ |
| 6.12 | Reapertura final `POST /accounting/reopen-period` | 200 |

Veredicto: el bloqueo por período cerrado se aplica en servidor en todos los caminos probados (ventas, NC, cobros, compras, recepciones, ajustes) y también cuando el período se cierra entre la creación del borrador y su contabilización. Reservas: la lista de verificación de cierre es solo informativa y se puede cerrar un mes en curso (XF-05); los códigos de error son heterogéneos (403 `accounting.*` frente a 400 `inventory.*`).

## Flujo 9 — Flujo 1 en MX (`qa-mx-a`) y US (`qa-us-a`) — **US OK con reservas; MX bloqueado (correctamente) por certificado**

### US (org `377f2b42…`, USD, IRS)
| Paso | Endpoint / body | Respuesta |
|---|---|---|
| 9.1 | `GET /invoices/context` | `ready:true`, `taxModel:BY_JURISDICTION`, `taxRates:[]`, `taxRequiresConfiguration:true`, `registeredJurisdictions:[]`, sin tipos fiscales, `fiscalAuthority:IRS`, `taxIdLabel:EIN` (sin NCF/ITBIS ✔) |
| 9.2 | `POST /customers {companyName:"QA-XF US Customer LLC", taxId:"98-7654321", EIN, FL 33131}` | 201 (un primer intento con `12-3456789` dio 409: ya lo usó otra familia) |
| 9.3 | `POST /inventory {QA-XF-US-W1, price 1234.57, GOOD, TAXED}` + `POST /inventory/adjustments {+5 u, unitCost 617.29}` + `/post` | 201 / 201 |
| 9.4 | `POST /invoices/preview` y `POST /invoices {customerId, lineItems:[{productId, qty 3}], notes:"QA-XF-41 US INV"}` | 201 `FAC-00000002` `Pending`, subtotal 3.703,71, **tax 0**, `taxedTotal 0`, `exemptTotal 3.703,71` aunque el producto es `TAXED` |
| 9.5 | Asientos (SQL) | Dr 1130 Accounts Receivable 3.703,71 / Cr 4100 Sales Revenue 3.703,71; Dr 5100 1.851,87 / Cr 1140 1.851,87 ✔ (3 × 617,29) |
| 9.6 | `POST /customer-payments {USD, amountReceived 3703.71, lines:[{invoiceId, 3703.71}], reference:"QA-XF-42 US PMT"}` | 201 `REC-2026-000001`; factura `Paid` saldo 0 ✔ |

Reservas US: (a) factura con impuesto 0 sin nexo configurado y `ready:true` — ya reportado como **FAC-INV-06** (media), se confirma aquí en el flujo completo; (b) la numeración por defecto es `FAC-` (abreviatura española de «factura») también para un tenant US (`database/migrations/1788500000001-InvoicingOverhaul.ts:735`, `['CUSTOMER_INVOICE','FAC-']`) — XF-06; (c) el plan de cuentas US guarda los nombres ingleses bajo la clave `es` (`accounts.name = {"es":"Accounts Receivable"}`), lo que rompe cualquier selección por idioma — XF-06.

### MX (org `3196ee71…`, MXN, SAT)
| Paso | Endpoint / body | Respuesta |
|---|---|---|
| 9.7 | `GET /invoices/context` | `ready:false`, `missing:["invoices.gaps.signing_certificate"]`, tasas `[0.16, 0.08, 0]`, tipos `I`/`E` electrónicos `issuable:false` (`no_certificate`), `taxIdLabel:RFC` ✔ |
| 9.8 | `POST /customers {taxId:"XAXX010101000", RFC}` | **422** `contacts.customer_form.document_invalid` — se rechaza el RFC genérico «público en general» que el SAT exige usar para ventas a público sin RFC (XF-07) |
| 9.9 | `POST /customers {taxId:"EKU9003173C9", RFC}` | 201 |
| 9.10 | `POST /invoices/preview {fiscalDocumentType:"I", qty 3}` | 200: base 3.703,71, **IVA 16 % = 592,59** (3.703,71 × 0,16 = 592,5936), total 4.296,30 ✔; sin ITBIS/NCF/propina |
| 9.11 | `POST /invoices` con tipo `I` y sin tipo | 400 `einvoicing.certificate.none_active {authority:"SAT"}` ✔ — no cae a reglas DO ni emite documento no fiscal |

No se continuó a cobro/asiento en MX: sin CSD no se puede facturar y cargar un certificado implicaría timbrado contra un PAC (efecto externo, prohibido por el aviso de la rúbrica).
Filtración de reglas DO detectada en MX (ya reportada por FINA/LOC, se confirma desde el flujo): el plan de cuentas MX (y CO, UY) trae `2141 AFP por Pagar (TSS)`, `2142 SFS por Pagar (TSS)`, `2143 SRL e INFOTEP por Pagar`, `2160 Propina Legal por Pagar` (`localization/fiscal/coa-builder.ts:369-393` y `:152`). Cuando la nómina MX contabilice, sus retenciones IMSS/INFONAVIT irían a cuentas con nombre de instituciones dominicanas. US recibe nombres neutros en inglés.

## Flujo 7 — Cambios de configuración: efecto en documentos NUEVOS vs HISTÓRICOS — **históricos OK; nuevos a medias (XF-08); moneda extranjera ROTA con tasas reales (XF-09)**

Histórico de referencia: `FAC-00000002` (2 u, ITBIS 18 % = 444,45, total 2.913,59, asiento 2.913,59).

| Paso | Cambio | Documento nuevo (preview) | Histórico (`GET /invoices/:id` + SQL) |
|---|---|---|---|
| 7.1 | `PATCH /taxes/:ITBIS18 {rate:19}` (el catálogo pasa a 19 % y el nombre sigue «ITBIS 18%») | `POST /invoices/preview` 1 u → `taxRate 0.18`, ITBIS 222,22: **el cambio no tiene efecto** | sin cambios ✔ |
| 7.2 | `PATCH /inventory/:producto {taxRate:0.16}` | preview → `taxRate 0.16`, ITBIS 197,53 (1.234,57 × 0,16 = 197,5312) ✔ | sin cambios (tasa de línea 0,18, 444,45; asiento 2.913,59) ✔ |
| 7.3 | Revertidos 7.1 y 7.2 (19→18; 0,16→0,18) | — | — |
| 7.4 | Cuenta de ventas por defecto del cliente: `PATCH /customers/:id {defaultSalesAccountId: 4200}` | **400** `whitelist_validation`: la columna `customers.defaultSalesAccountId` existe y se devuelve en `GET /customers`, pero el DTO no permite fijarla por API | no probado más allá |
| 7.5 | Tasa USD→DOP `POST /exchange-rates {USD, DOP, 60.1234, 2026-11-07}` y factura USD B01 de 100 + 18 % fechada 2026-11-07 | `POST /invoices` → **400** `currencies.stated_rate_requested_deviates_too_far {requested:60.12, resolved:60.1234, tolerance:0}` (XF-09). No se consumió NCF (la siguiente fue `B0100000003`, sin hueco) | — |
| 7.6 | Tasa de dos decimales `60.12` el 2026-11-08 y la misma factura fechada 2026-11-08 | 201 `FAC-00000003` NCF `B0100000003`, USD 118,00 × 60,12 = **7.094,16** DOP; asiento Dr 1130 7.094,16 (FC 118) / Cr 4100 6.012,00 (FC 100) / Cr 2130 1.082,16 (FC 18) ✔; procedencia `exchange_rate_source = QA-XF-62` | — |
| 7.7 | Borrar la tasa 60,12 (`DELETE /exchange-rates/:id` → 204) y crear 61,00 para el mismo día | — | factura y asiento siguen a 60,12 / 7.094,16 ✔ (la procedencia queda en el asiento aunque la tasa se borró) |
| 7.8 | `GET /customer-payments/aging` | — | antigüedad revalúa la factura USD a la tasa actual (118 × 61 = 7.198,00): total 10.111,59 frente al mayor 1130 = 10.007,75 → `controlAccountDifference: 103,84` = 118 × (61 − 60,12). La diferencia es la revaluación que nunca se contabiliza (FINB-01, ya conocido): el subledger y el mayor de CxC divergen en cuanto se mueve la tasa |

Veredicto: los históricos no se recalculan (correcto). Pero (a) el catálogo de impuestos no gobierna el cálculo: la tasa vive copiada en cada producto (`products.taxRate`), y el catálogo solo se usa como lista de tasas permitidas (`invoices.service.ts:603-614`, `tenantTaxRates`). Un cambio legal de tasa exige editar producto por producto y no hay vigencia (XF-08). (b) Con una tasa de cambio real de 4 decimales (las de la DGII/BCRD, DOF o TRM los traen) la facturación en moneda extranjera falla siempre (XF-09).

## Flujo 8 — Fallo a mitad de un flujo de varios pasos — **consistente (atómico) en los 4 casos provocados**

Búsqueda en código de puntos no transaccionales (`grep -rn -i "outside the transaction|after commit|best-effort|own transaction" --include=*.service.ts`): los únicos efectos fuera de la transacción son deliberados y después del commit (envío e-CF `invoices.service.ts:244`, notificaciones `workflow-engine.service.ts:70`, correo de invitación `users.service.ts:937`). Emisión de factura (asiento de venta + asiento de costo + salida de stock + NCF), recepción (stock + asiento GRNI), factura de proveedor, cobros/pagos y pago de nómina (`payroll-run.service.ts:436-460`) se ejecutan en una sola `dataSource.transaction` con el `EntityManager` propagado a contabilidad (lo que el informe de fronteras marca como `cross-module-transaction`: es acoplamiento, pero garantiza atomicidad). La excepción conocida es fabricación, que no mueve stock ni contabiliza (INV-20, ya reportado).

Fallos provocados (instantánea SQL antes/después: existencias, `ncf_sequences.current_sequence` B01, nº de facturas, nº de asientos, nº de movimientos de stock, recepciones):

| Caso | Cómo se provocó | Respuesta | Antes → después |
|---|---|---|---|
| 8.1 Segundo asiento falla (costo) | `PATCH /chart-of-accounts/:5100/block`, luego `POST /invoices` B01 1 u | 403 `journal_entries.account_code_p2_locked_new_transactions {code:5100}` | stock 3→3, NCF 3→3, facturas 4→4, asientos 18→18, movimientos 8→8 ✔ |
| 8.2 Asiento de recepción falla tras mover stock | `PATCH /chart-of-accounts/:2115/block`, luego `POST /procurement/orders/:PO2/receive` 2 u | 403 mismo código `{code:2115}` | stock 3→3, `received_quantity` 5→5, recepciones 2→2, asientos 18→18, movimientos 8→8 ✔ |
| 8.3 Validación de tasa en el asiento (paso final) | factura USD con tasa 60,1234 (XF-09) | 400 | sin factura ni NCF consumido (`FAC-00000003`/`B0100000003` fue la siguiente, sin hueco) ✔ |
| 8.4 Período cerrado entre borrador y contabilización | ver 6.11 | 403/400 | borradores intactos, sin asiento ✔ |

Cuentas desbloqueadas al terminar (`/unblock` → 200).

## Flujo 3 — Nómina → asientos → tesorería — **no ejecutado en vivo por XF; revisado en código**

No se ejecutó: aprobar una corrida exige un segundo usuario aprobador con step-up (segregación de funciones) y el tenant `qa-do-xflow` tiene un único usuario; crear usuarios/empleados para ello excede el presupuesto de esta pasada. La familia NOM ejecutó el ciclo completo crear → calcular → aprobar → pagar → asiento en `qa-do-nom` (asiento 853.809,55 = 853.809,55, mayor cuadrado; ver `modulos/payroll.md`).
Revisión de integración (código): aprobar (`payroll-run.service.ts:387-410`) contabiliza el devengo con clave idempotente `payroll:{id}`; pagar (`:436-460`) contabiliza Dr 2140 Remuneraciones por pagar / Cr cuenta GL de la cuenta bancaria elegida en la misma transacción que marca la corrida `PAID`. La cuenta bancaria se valida con SQL directo sobre `bank_accounts` (activa, del tenant y en moneda base, `:473-507`). No hay registro en tesorería distinto del asiento: el movimiento aparece en el banco solo como línea del mayor 1120, que la conciliación sí puede emparejar. No existe anulación de un pago de nómina (`cancel` rechaza `APPROVED`/`PAID`, `:509-515`): una transferencia devuelta se corrige con corrida de ajuste o asiento manual (diseño válido, «verificar con el equipo»). El riesgo de carrera calcular/aprobar ya está reportado (NOM-04).

---

## Hallazgos

**XF-09** · journal-entries / currencies / invoices · ejes 1 y 2 · **Categoría**: bug · **Severidad: alta**
- **Ubicación**: `apps/backend/api/src/app/journal-entries/journal-entries.service.ts:476-483` (`this.amount(exchangeRate,'exchangeRate')` → `roundAmount` a 2 decimales, `:758-760`); `currencies/exchange-rate-resolver.service.ts:278-288` (comparación con tolerancia); `organizations/entities/organization-settings.entity.ts:347-358` + `numericTransformerNotNull.to(undefined) = 0` (el transformador convierte el campo omitido en 0 y anula el `DEFAULT 0.02` de la BD).
- **Qué está mal**: la factura resuelve la tasa del día (60,1234), la pasa al servicio de asientos como tasa «declarada», este la redondea a 2 decimales (60,12) y la compara con la resuelta usando la tolerancia del tenant, que es 0 en **las 22 organizaciones** de la BD (`select fx_rate_tolerance, count(*) from organization_settings group by 1` → `0.000000 | 22`) aunque el valor documentado por defecto es 2 %. Resultado: `POST /invoices {currencyCode:"USD"}` con la tasa 60,1234 → 400 `currencies.stated_rate_requested_deviates_too_far {requested:60.12, resolved:60.1234, tolerance:0}`. Con una tasa de 2 decimales (60,12) la misma factura sale bien (201 `FAC-00000003`). Las tasas oficiales (BCRD, DOF, TRM, BNA) se publican con 4 o más decimales, así que **cualquier documento en moneda extranjera con tasa real falla**. Por código afecta a todo lo que pasa por `JournalEntriesService.create` con tasa (cobros, pagos, facturas de proveedor); en vivo solo se verificó en facturas de venta.
- **Forma correcta**: no redondear tasas como importes (usar la escala de la columna, 6 decimales) y no reenviar como «declarada» una tasa que el servidor acaba de resolver; no dejar que el transformador pise los `DEFAULT` de la BD (`to: v => v ?? undefined`) y migrar las filas a 0,02. Prueba de integración con una tasa de 4 decimales.
- **Impacto**: bloquea la venta a exportadores/importadores y a toda empresa con cuentas en USD. **Esfuerzo**: S.

**XF-05** · accounting (cierre) · eje 2 · **Categoría**: integridad de datos · **Severidad: media**
- **Ubicación**: `apps/backend/api/src/app/accounting/period-closing.service.ts:180-250`; `POST /accounting/close-period`.
- **Qué está mal**: el 2026-11-08 se cerró «Noviembre 2026» (fin 2026-11-30) con la lista de verificación incompleta (`unreconciled-bank-transactions` = 4, `isCompleted:false`). El servicio solo exige el cierre secuencial, que no haya asientos en borrador y que el año esté abierto: la lista de verificación es informativa y no se impide cerrar un mes en curso.
- **Forma correcta**: exigir los ítems bloqueantes (o una confirmación explícita auditada con motivo) y rechazar el cierre antes de `endDate` salvo permiso específico.
- **Impacto**: riesgo operativo. **Esfuerzo**: S.

**XF-08** · taxes / invoices / inventory · ejes 2 y 3 · **Categoría**: arquitectura · **Severidad: media**
- **Ubicación**: `apps/backend/api/src/app/invoices/invoices.service.ts:595-614` (`tenantTaxRates`: el catálogo solo se usa como lista de tasas admitidas); `products.taxRate`.
- **Qué está mal**: `PATCH /taxes/:ITBIS18 {rate:19}` → 200, pero el preview de un documento nuevo sigue a 18 %, porque la tasa está copiada en cada producto y el producto no referencia el impuesto. Un cambio legal de tasa obliga a editar producto por producto y el catálogo puede quedar diciendo «ITBIS 18%» con 19. No hay vigencia por fecha de documento. Los históricos no se recalculan (correcto).
- **Forma correcta**: el producto referencia un código de impuesto; la tasa se resuelve por código y fecha de documento desde un catálogo con vigencias.
- **Impacto**: deuda técnica y riesgo fiscal ante un cambio de tasa. **Esfuerzo**: M.

**XF-01** · reconciliation · ejes 2 y 11 · **Categoría**: UX / robustez · **Severidad: media**
- **Ubicación**: `apps/backend/api/src/app/reconciliation/parsers/column-mapping.ts:22-24`.
- **Qué está mal**: el importador trata `debitColumn` como **entrada** de dinero (perspectiva del libro), lo contrario de cómo los bancos rotulan el extracto (Débito = cargo/salida). Con el CSV en convención bancaria, el cobro de 4.370,38 se importó como −4.370,38 y el pago como +7.284,02, con 0 sugerencias (`confidence:"none"`). No hay ninguna advertencia de que todos los signos parezcan invertidos.
- **Forma correcta**: rotular en la UI/API como «Entradas»/«Salidas» o adoptar la convención bancaria; detectar que todas las líneas casan con el signo invertido y avisar.
- **Impacto**: riesgo operativo (conciliaciones que no casan). **Esfuerzo**: S.

**XF-02** · reconciliation · eje 2 · **Categoría**: integridad de datos · **Severidad: media**
- **Ubicación**: `POST /reconciliation/statements`.
- **Qué está mal**: se aceptaron dos extractos de la misma cuenta y el mismo rango (2026-11-07 a 2026-11-07, `bb031719…` y `e3b5c857…`); solo se rechaza un archivo con el mismo hash. Quedan dos extractos abiertos solapados, con riesgo de conciliar o cerrar dos veces el mismo período bancario.
- **Forma correcta**: rechazar o pedir confirmación ante un solape de fechas con un extracto no anulado de la misma cuenta.
- **Impacto**: riesgo operativo. **Esfuerzo**: S.

**XF-07** · customers / localization (MX) · eje 3 · **Categoría**: multi-país · **Severidad: media**
- **Ubicación**: `apps/backend/api/src/app/localization/fiscal/tax-id-validators.ts:193-200` (`isValidMexicanRfc`); `POST /customers`.
- **Qué está mal**: `taxId:"XAXX010101000"` (RFC genérico de público en general del SAT) → 422 `contacts.customer_form.document_invalid`. El SAT exige usar el RFC genérico en ventas a público en general y XEXX010101000 para extranjeros. El propio código lo reconoce (`contracts/country-pack/country-pack.ts:460`), pero el validador no lo acepta.
- **Forma correcta**: lista blanca de RFC genéricos del SAT.
- **Impacto**: brecha de localización MX. **Esfuerzo**: S.

**XF-10** · customers / invoices · eje 1 · **Categoría**: funcionalidad incompleta · **Severidad: baja**
- **Ubicación**: `PATCH /customers/:id` (DTO `customers/dto/*customer.dto.ts`); columna `customers.defaultSalesAccountId`.
- **Qué está mal**: `GET /customers` devuelve `defaultSalesAccountId`, pero `PATCH {defaultSalesAccountId}` → 400 `whitelist_validation`. No se puede configurar por API, así que no se pudo probar la cuenta por defecto en documentos nuevos frente a históricos.
- **Forma correcta**: exponer el campo validando que la cuenta sea de ingresos, del tenant y contabilizable, o retirarlo.
- **Esfuerzo**: S.

**XF-04** · invoices (NC) · eje 2 · **Categoría**: otro (contable) · **Severidad: baja**
- **Ubicación**: asiento de `NC-00000001` (`POST /invoices/:id/credit-note`).
- **Qué está mal**: la NC debita 4100 Ingresos por ventas en lugar de 4300 Descuentos y devoluciones (la cuenta existe con `system_role SALES_DISCOUNTS`). Las ventas netas cuadran, pero se pierde la cifra de devoluciones que piden el estado de resultados y el análisis.
- **Forma correcta**: llevar las devoluciones a la cuenta de rol `SALES_DISCOUNTS`, o hacerlo configurable.
- **Esfuerzo**: S.

**XF-03** · inventory / procurement · eje 7 · **Categoría**: calidad de datos · **Severidad: baja**
- **Ubicación**: `stock_movements.value`.
- **Qué está mal**: el movimiento `PURCHASE_RECEIPT` de 10 × 617,29 se guarda con `value = NULL`. Cualquier valoración debe recalcular `quantity × cost`, y la conciliación entre inventario y mayor no puede sumar una columna.
- **Forma correcta**: guardar siempre el valor del movimiento.
- **Esfuerzo**: S.

**XF-06** · localization (US) · eje 3 · **Categoría**: multi-país · **Severidad: baja**
- **Ubicación**: `database/migrations/1788500000001-InvoicingOverhaul.ts:735` (`['CUSTOMER_INVOICE','FAC-']`); `accounts.name` del tenant US.
- **Qué está mal**: el tenant US numera sus facturas `FAC-00000002` (abreviatura española) y guarda los nombres ingleses del plan de cuentas bajo la clave `es` (`{"es":"Accounts Receivable"}`).
- **Forma correcta**: prefijo por país o idioma (`INV-`) y nombres bajo su idioma real.
- **Esfuerzo**: S.

Confirmados desde los flujos (ya reportados por otras familias, no se reinvestigaron):
- **FINB-01**: la revaluación cambiaria nunca se ejecuta. Visible en 7.8: la antigüedad de CxC difiere del mayor 1130 en 103,84 en cuanto cambia la tasa.
- **FAC-INV-06**: en US se factura con impuesto 0 sin nexo configurado (9.4).
- **LOC/FINA**: plan de cuentas DO (TSS, INFOTEP, propina legal) filtrado a MX, CO y UY (9.x).
- **INV-20**: fabricación no mueve stock (flujo 8).
- **TES-01**: recibo USD aplicado 1:1 a factura DOP. No se repitió: la cuenta USD exige step-up y crear una nueva cuenta bancaria; por código el bucle no compara monedas.
- **CMP-01**: factura de proveedor por más de lo recibido. No se repitió; en el flujo 2 la factura igual a lo recibido dejó 2115 en 0,00.
- **607/608 → 500** (`compliance.service.ts:432`) y **FAC-INV-01** (límite Starter de 10 facturas/mes; con la cuota agotada, NC y anulaciones dan 500): no se tocaron. Esta sesión usó 4 documentos de venta en `qa-do-xflow` (FAC-1, NC-1, FAC-2, FAC-3) para no agotar la cuota.

## Estado final de los datos de prueba (qa-do-xflow)
Abiertos a propósito: `FAC-00000002` (DOP 2.913,59) y `FAC-00000003` (USD 118 / DOP 7.094,16); `PO-2026-000002` parcialmente recibida (5/10); borradores `QA-XF-29 FP` (factura de proveedor) y `AJ` `QA-XF-31`; extractos `bb031719…` (importado) y `e3b5c857…` (reabierto). Noviembre 2026 reabierto y enero–octubre 2026 cerrados (el tenant no tiene movimientos en esos meses). Tasa USD→DOP de QA el 07-11 (60,1234) y el 08-11 (61,00). Impuesto y producto revertidos a 18 %; cuentas 5100 y 2115 desbloqueadas.

## Lo que no se pudo verificar
- El flujo 3 en vivo (requiere un segundo aprobador; lo cubre NOM).
- La cuenta por defecto del cliente (XF-10).
- XF-09 en cobros, pagos y facturas de proveedor (solo por código).
- La conciliación con más volumen (la cubre TES).
- MX más allá del preview (sin CSD; timbrar sería un efecto externo).
- Concurrencia entre módulos (p. ej. dos emisiones simultáneas sobre la última unidad en stock).
