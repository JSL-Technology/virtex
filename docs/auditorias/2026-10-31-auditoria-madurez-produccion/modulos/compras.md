# M15 — Compras (`procurement`)

> **Hallazgo CRÍTICO abierto (integridad, confirmado en el flujo cruzado):** FLOW-01. Las recepciones concurrentes de una OC reciben de más. `procurement/purchase-orders.service.ts:401-430` lee la OC y sus líneas sin bloqueo, y `POST /procurement/orders/:id/receive` no exige Idempotency-Key. No se re-investigó aquí; se cita.
> **Portal de proveedores:** no existe. `supplier_portal_users` es una tabla dormida, sin endpoints, sin autenticación y sin pantallas.
> No se encontró fuga entre tenants (IDOR → 404).

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/procurement/` (29 archivos, ~3 560 LOC sin specs, 4 specs). Controladores:
  - `procurement/requisitions` (10 endpoints: CRUD, submit, approve, reject, reopen)
  - `procurement/orders` (15 endpoints: CRUD, from-requisition, submit, approve, reject, reopen, send, receive, receipts, cancel)
  - `procurement/receipts` (4 endpoints)
  - `procurement/replenishment-agent` (3 endpoints)
- **Entidades:** `purchase_requisitions(+lines)`, `purchase_orders(+lines)`, `purchase_order_receipts` (líneas en jsonb), `supplier_portal_users`, `replenishment_settings`.
- **Frontend:** `features/purchasing` (requisitions, orders, receipts; 8 ts + 3 specs).
- **Dependencias:** inventario (`GoodsReceiptPort`), divisas, workflows (eventos de aprobación), numeración compartida, sucursales. CxP lee y escribe `purchase_order_lines.billedQuantity`.
- **Países:** el módulo es agnóstico al país; los impuestos de la OC son un `taxRate` libre por línea. **¿Es núcleo?** Sí.

## 2. Estándar de referencia
- **Básico:** requisición → aprobación → OC → aprobación por importe y nivel → envío → recepciones parciales con asiento (Dr inventario / Cr GRNI) → cierre (incluido el cierre corto) → match a 3 vías con tolerancias de cantidad y precio → devolución al proveedor.
- **Avanzado:** acuerdos marco y contratos, RFQ y comparativo de cotizaciones, reposición automática, portal de proveedores (confirmación de OC, ASN, facturas), landed cost.
- **Invariantes:** recibido ≤ pedido con concurrencia; facturado ≤ recibido según la política; la recepción mueve existencias y GRNI de forma atómica; segregación solicitante/aprobador; ninguna factura sobre una OC no aprobada.
- **Referencias:** NetSuite, Dynamics BC, SAP B1 y Odoo tienen match a 3 vías con tolerancias, portal o colaboración con proveedores (Odoo y NetSuite) y control de facturación sobre lo recibido. Confianza media: conocimiento público general.

## 3. Resultado
**Madurez 40** (32–48, media) · **Preparación 38 — No listo** · eje más débil: Integridad · críticos: 1 (FLOW-01) · altos: 3.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Autenticidad/completitud | 55 (48–62, media) | Ciclo real con máquina de estados (`procurement-lifecycles.ts`), recepciones parciales y su anulación con reversión, reposición. Faltan el portal, RFQ, devoluciones al proveedor y el cierre corto. | Portal, RFQ, devoluciones, cierre corto. |
| 2 | Integridad | 35 (28–45, alta) | FLOW-01 crítico; PRC-02 (transacción anidada); PRC-03 (factura sobre OC no aprobada). | Bloqueos, una sola transacción, estado de OC en el match. |
| 3 | Multi-país | N/A parcial: 50 (baja) | El impuesto es un `taxRate` libre en la OC, sin catálogo por país. | Impuestos por código fiscal. |
| 4 | Arquitectura | 58 (50–65, media) | Puerto de inventario y ciclos de vida declarativos. Recepción embebida en el servicio de OC; las líneas de recepción en jsonb impiden FK e índices. | Tabla de líneas de recepción. |
| 5 | Higiene | 55 | CxP escribe `billedQuantity` en tablas de compras (`accounts-payable.service.ts:703`). Compras importa `Supplier` directamente. | Contrato de matching propio. |
| 6 | Calidad de código | 62 | Limpio, i18n. | — |
| 7 | Robustez | 50 | Listados paginados; `receiveDocument` sin lock. | Locks. |
| 8 | Seguridad | 68 (60–75, media) | IDOR qa-b → 404 en GET y en POST receive; `@HasPermission`; autoaprobación bloqueada si hay otros usuarios (probado: approve propio → 403). Portal inexistente: nada que atacar, pero tampoco hay capacidad. | Límites de aprobación por importe; rol restringido probado. |
| 9 | Pruebas | 45 (baja) | 4 specs unitarios, sin integración de concurrencia. | Prueba de FLOW-01. |
| 10 | Operabilidad | 55 | Logs por transición; eventos de negocio. Los documentos de compras no están en `AUDITED_TABLES` (`audit/financial-audit.subscriber.ts:156`). | Auditoría de OC y recepciones. |
| 11 | UX | 55 (baja) | Pantallas completas; no probadas en navegador. | — |
| 12 | Competitividad | 40 | Ver §9. | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | No cumple (parcial) | Portal sin implementar; el resto es real. |
| 2 | Integridad | **No cumple** | FLOW-01, PRC-02. |
| 3 | Aislamiento | Cumple (endpoints probados) | — |
| 4 | Validación en servidor | Cumple | DTOs; `receipt_exceeds_ordered` (sin concurrencia). |
| 5 | E2E | Parcial | Approve → 403 por segregación (correcto), así que no se completó la recepción con un solo usuario; FLOW-01 sí la ejercitó. |
| 6 | Cumplimiento por país | N/A | — |
| 7 | CI | No verificado | — |
| 8 | Auditoría | No cumple | OC y recepciones no auditadas; AUD-01 transversal. |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos
**FLOW-01** (cita) — **Crítica**. Recepción concurrente que recibe de más. `purchase-orders.service.ts:401-430`, sin `FOR UPDATE` ni Idempotency-Key. `voidReceipt` sí bloquea las líneas (`goods-receipts.service.ts`). **Esfuerzo:** S.

**PRC-02** — eje 2 · Integridad · **Alta**
- **Ubicación:** `purchase-orders.service.ts` `createFromRequisition`.
- **Qué pasa:** abre `dataSource.transaction(manager)` pero llama a `this.create(...)`, que abre su PROPIA transacción con `this.dataSource`. La OC se confirma por separado, y si luego `markConverted` falla (requisición no aprobada o ya convertida), la OC queda huérfana, comprometida y sin vínculo. Lo mismo ocurre con dos conversiones concurrentes de la misma requisición: la requisición se lee sin bloqueo. Estático, no ejecutado.
- **Forma correcta:** pasar el `manager` a `create` y bloquear la requisición.
- **Esfuerzo:** S.

**PRC-03** — eje 2 · Integridad · **Alta** (compartido con AP-05)
- **Qué pasa:** una factura de proveedor se aceptó y contabilizó contra una línea de una OC en PENDING_APPROVAL y sin recepción. El stock del producto QA-F6-4195 subió a 4 por el evento de la factura. Pasos: `POST /procurement/orders` → submit (PENDING_APPROVAL) → `POST /accounts-payable` con `purchaseOrderLineId` → submit-for-approval → OPEN, asiento Dr 1140 401,48. El "three-way match" solo controla facturado ≤ pedido y reparte el GRNI; no valida estado, recepción ni precio.
- **Esfuerzo:** M.

**PRC-04** — eje 1 · Funcionalidad · **Alta**
- **Ubicación:** `entities/supplier-portal-user.entity.ts`.
- **Qué pasa:** no hay portal de proveedores. Búsqueda de `SupplierPortalUser|supplier_portal` en `apps/backend/api/src`: solo aparecen la entidad, el módulo y las migraciones. No hay controlador, ni autenticación separada, ni frontend. Positivo: se eliminó el segundo modelo de permisos (migración `1789006800000`).
- **Esfuerzo:** L.

**PRC-05** — eje 1/2 · **Media**
- Sin límites de aprobación por importe en la OC (se emite APPROVAL_REQUESTED con `amount`, pero no se verificó la política del workflow).
- Si el tenant tiene un único usuario, la autoaprobación se permite (`approve`, conteo de `user_organizations`); es una decisión que puede ser razonable para pymes; verificar con el equipo.
- Sin cierre corto ni devoluciones a proveedor.

**PRC-06** — eje 10 · **Media**. `purchase_orders`, `purchase_order_receipts` y `purchase_requisitions` no están en `AUDITED_TABLES`.

**PRC-07** — eje 4 · **Media**. Las líneas de recepción en jsonb (`purchase_order_receipts.lines`) impiden integridad referencial y reporting eficiente.

**PRC-08** — transversal · **Baja/Media**. `baseCurrency` recae en `'USD'` si faltan los ajustes (`purchase-orders.service.ts` `baseCurrency`). Redondeo de `common/money.ts:77-84` (coordinador).

## 7. Camino mínimo a producción
1. FLOW-01, con lock e Idempotency-Key (S)
2. PRC-02 (S)
3. PRC-03, estado de la OC y match configurable (M, junto con CxP)
4. Auditoría de OC y recepciones (S)
5. Pruebas de integración con concurrencia (M)

Todo son retoques.

## 8. Camino a 100
| Mejora | Puntos | Esfuerzo |
|---|---|---|
| Integridad (1–3) | +15 | S–M |
| Tolerancias, PPV y cierre corto | +8 | M |
| Devoluciones a proveedor | +5 | M |
| Aprobación por importe | +5 | M |
| Portal de proveedores con autenticación propia y alcance por `supplier_id` | +10 | L |
| RFQ y acuerdos marco | +7 | L |

## 9. Competitividad (40, 30–50, media)
- **Faltantes básicos:** match a 3 vías real, devoluciones, cierre corto.
- **Faltantes avanzados:** portal de proveedores (Odoo, NetSuite), RFQ.
- **Diferenciadores:** agente de reposición (`replenishment/`) y copiloto (`procurement.copilot-tools.ts`).
- **Frente a líderes locales:** Alegra y Siigo tienen OC más simples; Virteex está a la par o por encima en el ciclo de estados, pero por debajo en integridad.

## 10. Fortalezas
- Máquinas de estado declarativas.
- Recepción con asiento y anulación por reversión, que bloquea si ya se facturó.
- Segregación autor/aprobador.
- Paginación.

## 11. No verificado
- Recepción completa en este pase (FLOW-01 la cubrió).
- Conversión desde requisición.
- Reposición.
- UI.
- Specs con BD.

Cobertura: ~45 % de los archivos y 7 de 32 endpoints.

<!-- RESUMEN: modulo=compras; madurez=40; prep=38; veredicto=No listo; eje_debil=Integridad; criticos=1; altos=3; camino_min=M -->
