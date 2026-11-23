# procurement — Requisiciones, órdenes de compra y recepciones (familia CMP)

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/procurement/` (~4.400 líneas). Rutas:
  - `procurement/requisitions`: CRUD, submit, approve, reject, reopen.
  - `procurement/orders`: CRUD, `from-requisition`, submit, approve, reject, reopen, send, receive, receipts, cancel.
  - `procurement/receipts`: listar, crear, detalle, void.
  - `procurement/replenishment-agent`: settings, run.
- **Tablas**: `purchase_requisitions` (+lines), `purchase_orders`, `purchase_order_lines` (`received_quantity`, `billed_quantity`), `purchase_order_receipts` (líneas en **JSONB**), `replenishment_settings`, `supplier_portal_users`.
- **Frontend**: `features/purchasing` (órdenes, recepciones, requisiciones) en `compras.manifest.ts`.
- **Pruebas**: `procurement.spec.ts`, `procurement-lifecycles.spec.ts`, specs de reposición; verify:purchasing EXIT 0.
- **Dependencias**: inventario (`GoodsReceiptPort`), contabilidad (GRNI), suppliers, workflows.
- **Países**: neutro, salvo el impuesto por línea.
- **¿Núcleo?** Sí.

## 2. Estándar de referencia
(a) **Básicas**:
- requisición → OC con aprobación por montos;
- envío al proveedor;
- recepciones parciales con valoración (GRNI);
- anulación y devolución;
- cierre de OC;
- tolerancias de recepción.

**Avanzadas**: RFQ y comparativo de cotizaciones, contratos y OC abiertas (blanket), costos de importación (landed cost), portal de proveedores, reposición automática.

(b) **Invariantes**:
- recibido ≤ ordenado (o dentro de la tolerancia);
- recepción = movimiento de stock + asiento Inventario/GRNI por el mismo valor;
- no se anula lo ya facturado;
- separación de funciones entre quien crea y quien aprueba.

(c) **Referencia**: SAP MM, NetSuite, D365 y Odoo Purchase cubren RFQ, blanket y landed cost. Confianza media, conocimiento general.

(d) **Construcción**: líneas de recepción relacionales; costo de recepción contra kárdex vía puerto.

## 3. Resultado
- **Madurez: 60 (52–66, confianza media)**.
- **Preparación: 60 → Piloto controlado**.
- **Eje más débil**: 12 / 1 (faltan RFQ, blanket, landed cost y tolerancias).
- **Críticos abiertos**: 0.

## 4. Ejes
| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Autenticidad | 62 (55–68, media) | En vivo: OC PO-2026-000001 (100 × 100, ITBIS 0,18) → submit → approve → send → receive 60 → `PARTIALLY_RECEIVED`. Stock 0→60, costo 100; `stock_movements` PURCHASE_RECEIPT; asiento 1140 D 6.000 / 2115 C 6.000. Requisiciones y agente de reposición existen, pero no los ejercí. | RFQ, blanket, landed cost aplicado (ver supply-chain). |
| 2 Corrección | 64 (56–70, media) | Recibir 50 más (110 > 100) → 400 `receipt_exceeds_ordered`. Negativo → 400. Anular una recepción facturada → 400 `receipt_already_billed`. Anular una sin facturar → VOID, stock 80→70, asiento de reversa. Bloqueo `FOR UPDATE` en orden de id (`purchase-orders.service.ts:402-410`). verify:purchasing: mayor = kárdex en recibir, vender, facturar a otro precio y anular. | Tolerancias; prueba de concurrencia. |
| 3 Multi-país | N/A (70) | Sin reglas por país; moneda y tipo de cambio en la OC. | — |
| 4 Arquitectura | 58 (50–65, media) | Líneas de recepción en JSONB (`purchase_order_receipts.lines`): sin FK ni consultas por producto (CMP-14). Servicio de 674 líneas razonable. OC paginadas. | Tabla `goods_receipt_lines`. |
| 5 Higiene | 58 (50–65, media) | Stock por `GoodsReceiptPort` (bien). Ciclo compras↔ventas reportado por `module-boundaries`. `supplier_portal_users` vive aquí sin portal visible. | Romper el ciclo; mover o quitar la entidad del portal. |
| 6 Calidad | 62 (55–68, baja) | Código claro; comentarios históricos. | — |
| 7 Robustez | 58 (50–66, media) | 500 con notación científica en `receive` (CMP-06). | — |
| 8 Seguridad | 70 (62–76, media) | Prueba en vivo del 2026-11-07 a las 13:47, con AUTH_THROTTLE_LIMIT=200. qa-do-b: receive de la OC ajena → 404; `POST /procurement/receipts {orderId ajeno}` → 404; crear una OC con el supplierId ajeno → 400 `supplier_not_found`. Con el productId ajeno → 400 `FOREIGN_KEY_VIOLATION`: lo frena la FK de mismo inquilino, no el servicio, y el mensaje es genérico. qa-do-a-member → 403 en orders, requisitions, receipts y approve. La autoaprobación solo se impide si la organización tiene más de un usuario (CMP-13). | Validar el producto en el servicio; política de aprobación. |
| 9 Pruebas | 62 (55–70, media) | Specs verdes con BD real + verify:purchasing. | Concurrencia de recepción. |
| 10 Operabilidad | 58 (50–65, baja) | Anulaciones con motivo, autor y fecha. | Bitácora de cambios de OC. |
| 11 UX | 55 (45–65, baja) | Pantallas de lista, documento y nuevo en el manifiesto; sin humo de UI. | Humo. |
| 12 Competitividad | 50 (40–60, baja) | Al nivel de QuickBooks/Zoho; por debajo de Odoo/SAP. | RFQ, blanket, landed cost, portal. |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple | Recepción real que mueve stock y mayor. |
| 2 Integridad | Cumple | Exceso, anulación y reversa probados. |
| 3 AuthZ y aislamiento | Cumple | Probado en vivo (eje 8). |
| 4 Validación | Cumple con reservas | CMP-06. |
| 5 Humo sin 500 | No cumple | CMP-06. |
| 6 Por país | N/A | — |
| 7 Pruebas | Cumple en el módulo | — |
| 8 Auditoría | Parcial | — |
| 9 Migraciones | Cumple | — |
| 10 Observabilidad | Cumple mínima | — |
| 11 UI | No verificado | — |
| 12 Documentación | Parcial | — |

## 6. Hallazgos
**CMP-01** (compartido con accounts-payable, Alta): una factura con más cantidad que la recibida da entrada a stock sin recepción ni hold. Ver accounts-payable.md.

**CMP-06** (Media): 500 en `receive` con `quantity: 0.0000001`. Ver accounts-payable.md.

**CMP-13** · eje 8 · Seguridad · Media · `purchase-orders.service.ts:328`.
- La separación de funciones depende de cuántos usuarios hay y no de una política.
- No hay límites de aprobación por monto ni por rol.
- Un ADMINISTRATOR aprueba cualquier OC de otro usuario.

Forma correcta: matriz de aprobación por monto, centro de costo y rol (ya existe `workflows`), y prohibir siempre la autoaprobación salvo que la política lo permita de forma explícita. Esfuerzo: M.

**CMP-14** · eje 4 · Arquitectura · Media · `purchase_order_receipts.lines` es JSONB.
- No hay FK a `purchase_order_lines` ni a productos.
- No se puede reportar lo recibido por producto con SQL indexado.
- Riesgo de deriva entre el JSON y `received_quantity`.

Esfuerzo: M.

**CMP-15** · eje 1 · Competitividad · Alta · Faltan capacidades básicas del mercado medio:
- RFQ y cotizaciones;
- OC abierta o contrato;
- tolerancias de recepción y precio;
- cierre forzado de saldo de OC;
- devolución a proveedor desde la recepción (solo existe anular completa).

Búsqueda en `procurement/` (grep de quote/rfq/blanket/tolerance/return): sin resultados funcionales. Esfuerzo: L.

## 7. Camino mínimo
1. CMP-06 (S).
2. Prueba en vivo de aislamiento (S).
3. Tolerancias y holds con AP, CMP-01 (M).
4. CMP-13, política de aprobación (M).

## 8. Camino a 100
- RFQ y comparativo: +6, L.
- Landed cost real: +6, L (con supply-chain).
- Tabla de líneas de recepción: +3, M.
- Devoluciones parciales: +4, M.
- Portal de proveedores: +4, L.

## 9. Competitividad
- Básicas faltantes: tolerancias, devolución parcial.
- Avanzadas faltantes: RFQ, blanket, landed cost.
- Diferenciador: conciliación kárdex↔mayor verificada por script.

Confianza baja-media.

## 10. Fortalezas
- Recepción valorada en GRNI con el kárdex conciliado.
- Anulación con reversa que bloquea lo facturado.
- Bloqueos ordenados.
- Numeración por secuencia.

## 11. No verificado
- Requisiciones → OC y el agente de reposición (no ejercidos).
- Humo de UI.
- Recepción concurrente.
- Aislamiento y authZ: verificados en vivo después (eje 8).
