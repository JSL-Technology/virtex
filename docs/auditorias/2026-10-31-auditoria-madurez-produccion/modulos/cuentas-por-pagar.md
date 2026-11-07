# M16 — Cuentas por pagar (`accounts-payable`)

> **Hallazgos CRÍTICOS abiertos (integridad contable y fiscal, no de seguridad):**
> - **AP-01** Anular una factura de proveedor que tiene una nota de débito contabilizada deja el mayor de CxP descuadrado contra el auxiliar (diferencia 118,00 reproducida por API).
> - **AP-02** (DO) En una compra de BIENES a persona física se retiene por defecto el 100 % del ITBIS y el 10 % de ISR como si fueran SERVICIOS (`servicesAmount` toma por defecto el subtotal). Reproducido por API.
> No se encontró fuga entre tenants en los endpoints probados (IDOR → 404).

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/accounts-payable/` (45 archivos, ~5 660 LOC sin specs, 7 specs). Servicio central `accounts-payable.service.ts` (1 519 líneas). Controladores: `accounts-payable` (CRUD, aging, submit-for-approval, payments, void), `vendor-payments`, `vendor-debit-notes`, `suppliers/:id/statement`, captura `bill-capture`. Entidades: `vendor_bills`, `vendor_bill_lines`, `vendor_bill_attachments`, `vendor_payment`, `payment_batches`, `vendor_debit_note`.
- **Frontend:** `features/accounts-payable` (list, form, detail, payment, payments, debit-notes; 9 ts + 4 specs).
- **Dependencias:** contabilidad (`AccountingPostingPort`), retenciones (`invoices/services/withholding-resolver.service.ts` + `localization/fiscal/withholding-regimes.ts`), compras (lee y escribe `purchase_order_lines.billedQuantity`), inventario (evento `vendor.bill.posted` después del commit), tesorería, workflows/presupuestos.
- **Países:** declara 19. Con retenciones de catálogo solo DO; CO, MX, PE, AR, CL, EC y BR dependen de que el tenant configure sus regímenes; para el resto no hay nada.
- **¿Es núcleo para vender?** Sí.

## 2. Estándar de referencia (Paso 3)
- **Básico:** factura de proveedor con impuesto por línea o código; número del proveedor (o NCF/CUFE/UUID) único por proveedor; aprobación; asiento automático; pagos parciales y en lote; notas de débito/crédito aplicadas; retenciones según régimen y base mínima; antigüedad de saldos que cuadre con la cuenta de control; anulación por reversión; conciliación a 2 y 3 vías (OC/recepción/factura) con tolerancias.
- **Avanzado:** captura OCR/IA, archivos bancarios de pago (ACH/NACHA/SEPA), términos y descuentos por pronto pago, varianza de precio de compra (PPV), certificados de retención, multimoneda con diferencia en cambio, aprobación por niveles e importes.
- **Invariantes:** auxiliar CxP = cuenta de control en todo momento; cada asiento cuadrado e inmutable; ningún pago supera el saldo, tampoco con concurrencia; sin duplicados por proveedor+número; retenciones = base × tasa del concepto correcto.
- **Líderes:** NetSuite y Dynamics BC detectan duplicados por proveedor+número y bloquean el pago si la recepción no está hecha (match a 3 vías con tolerancias). Bill.com y QuickBooks avisan de duplicados y generan pagos ACH. Siigo y Alegra calculan ReteFuente/ReteIVA/ReteICA por concepto con bases mínimas en UVT. Confianza media: conocimiento público general, no verificado en web durante esta auditoría.

## 3. Resultado
**Madurez 38** (30–45, confianza media) · **Preparación 35 — No listo** · eje más débil: Corrección e integridad · críticos abiertos: 2 · altos: 3 (+1 media/alta).
La madurez queda muy por debajo del promedio de los ejes (~52) porque se limita por min(eje1, eje2, eje8) y hay dos críticos abiertos.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad/completitud | 55 (48–62, media) | El ciclo es real: borrador → aprobación → asiento → pago → anulación, más notas de débito, aging con cuenta de control y adjuntos. Falta el número de factura del proveedor, no hay impuesto por línea ni archivo bancario. | Campo de número de proveedor, impuestos por línea, PPV, archivos de pago. |
| 2 | Corrección/integridad | 30 (25–40, alta) | AP-01 y AP-02 reproducidos. Asiento de la factura correcto y cuadrado (rehecho a mano). `payBills` lee las facturas sin bloqueo. | Corregir AP-01, AP-02 y AP-04 y añadir pruebas con BD. |
| 3 | Multi-país | 35 (25–45, media) | DO: NCF validado y deduplicado, pero solo 4 regímenes de retención y el defecto AP-02. CO: sin retenciones por defecto; el modelo no admite ReteICA ni base mínima en UVT. Los demás países: nada. | Catálogo por concepto con base mínima y municipio; 606 DO verificado. |
| 4 | Arquitectura | 55 (45–60, media) | Usa puerto contable, numeración compartida y `afterCommit`. Pero el servicio tiene 1 519 líneas, escribe tablas de compras y mueve el stock por un evento posterior al commit. | Separar posting, matching y pagos; mover stock dentro de la transacción. |
| 5 | Higiene | 50 (40–58, media) | Importa entidades de `procurement` y escribe `purchase_order_lines` directamente (`accounts-payable.service.ts:2-3, 703-705`). | Contrato de matching propiedad de compras. |
| 6 | Calidad de código | 60 (50–65, media) | Tipado razonable y errores i18n; comentarios extensos. | Reducir el servicio principal. |
| 7 | Robustez/rendimiento | 45 (35–55, media) | `findAll` sin paginación (`accounts-payable.service.ts:~1000`); aging carga todas las facturas abiertas en memoria. | Paginación y aging en SQL. |
| 8 | Seguridad/aislamiento | 70 (60–78, media) | IDOR desde qa-b → 404 en GET bill y GET payments. Pagos con `@RequireStepUp(MOVE_FUNDS)` de un solo uso más Idempotency-Key obligatoria. Permisos por endpoint. | Prueba de rol restringido; segregación creador/pagador. |
| 9 | Pruebas | 45 (35–55, baja) | 7 specs (`accounts-payable.spec.ts` 1 228 líneas). Las suites con BD se saltan sin DB_HOST; no se confirmó que corran en CI. Ninguna prueba cubre AP-01 ni AP-02. | Pruebas de integración de los invariantes. |
| 10 | Operabilidad | 55 (45–60, baja) | Logger por operación; auditoría de `vendor_bills`, `vendor_payment` y `payment_batches`, pero sin autor (AUD-01, transversal). | Correlación y autor. |
| 11 | UX | 55 (45–65, baja) | Pantallas completas. `detail.page.ts:134` traga el error de pagos con `catchError(() => of([]))`. UI no probada. | Mostrar errores; probar con Playwright. |
| 12 | Competitividad | 40 (30–50, media) | Sin detección de duplicados fuera de DO, sin pagos ACH y sin retenciones CO completas. | Ver §9. |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, con capacidades básicas | No cumple | Sin número de proveedor ni impuesto por línea. |
| 2 | Integridad en escrituras | **No cumple** | AP-01 (descuadre de 118) y AP-04 (sin bloqueo). |
| 3 | Aislamiento verificado | Cumple (parcial) | IDOR → 404 en los endpoints probados; no se probaron todos. |
| 4 | Validación en servidor | Cumple con reservas | DTOs con class-validator; no se valida `taxToCost + taxProportional ≤ taxAmount` ni `dueDate ≥ date`. |
| 5 | E2E sin 500 | Cumple (API) | Ciclo completo sin 500. |
| 6 | Cumplimiento por país | **No cumple** | AP-02 (DO); CO incompleto; los demás sin soporte y sin declararlo. |
| 7 | Pruebas en CI | No cumple / no verificado | Suites con BD omitidas. |
| 8 | Auditoría de negocio | Parcial | Tablas auditadas, pero sin autor (AUD-01). |
| 9 | Migraciones | Cumple | Global OK. |
| 10 | Observabilidad | Parcial | Logs sin correlación verificada. |
| 11 | UI/i18n | No verificado | — |
| 12 | Documentación | Parcial | Comentarios abundantes; no hay guía de operación. |

## 6. Hallazgos
**AP-01** — CxP, eje 2 · Integridad de datos · **Crítica**
- **Ubicación:** `accounts-payable.service.ts` `voidBill` (~líneas 1290-1380). El método comprueba los pagos pero no las notas de débito.
- **Qué pasa:** al anular una factura que tiene una nota de débito contabilizada, se revierte el asiento de la factura y el saldo pasa a 0, pero la nota de débito sigue POSTED con su asiento (Dr CxP / Cr gasto) y no se puede anular después, porque `voidNote` rechaza facturas anuladas (`vendor-debit-notes.service.ts`: `debit_note_bill_already_voided`).
- **Reproducción (qa-a):** factura sin producto de 1 180 → submit → nota de débito de 118 (impuesto 18) → `POST /accounts-payable/97ee01ac-…/void`. Aging antes: total 1 143,33 = control 1 143,33 (diferencia 0). Después: diferencia **118** (control 243,33 frente a 361,33). Tras pagar la otra factura: total 0 y control −118.
- **Forma correcta:** bloquear la anulación si hay notas de débito vigentes, o revertirlas en la misma transacción.
- **Impacto:** bloquea la venta. **Esfuerzo:** S.

**AP-02** — CxP, eje 3 · Multi-país (DO) · **Crítica**
- **Ubicación:** `accounts-payable.service.ts:~198-201`, `const servicesAmount = dto.servicesAmount ?? subtotal; scope = servicesAmount > 0 ? 'SERVICES' : 'GOODS'`.
- **Qué pasa:** una factura de bienes (con producto y ligada a una OC) de una persona física recibe `withholdingRegimeCodes: ["DO-ITBIS-100-PF","DO-ISR-10-SERV-PF"]`, con taxWithheld 72,27 e incomeTaxWithheld 40,15 sobre una base de 401,48 en bienes. Se retiene de más al proveedor y la retención se declara mal.
- **Además:** el catálogo DO (`localization/fiscal/withholding-regimes.ts`) tiene solo 4 regímenes. FOREIGN devuelve `[]`, así que no hay retención a no residentes, y faltan alquileres y otros conceptos. Verificar con contador local.
- **Forma correcta:** derivar bienes/servicios de las líneas (producto inventariable frente a servicio o cuenta de gasto); no asumir servicios por defecto.
- **Esfuerzo:** S–M.

**AP-03** — eje 1/2 · Integridad · **Alta**
- **Ubicación:** `entities/vendor-bill.entity.ts`. No existe un campo para el número de factura del proveedor; la deduplicación (`assertFiscalIdentity`) solo actúa si el país es DO y hay NCF.
- **Reproducción:** dos `POST /accounts-payable` idénticos sin NCF → 201 y 201 (ids 97ee01ac… y 9e33a8f3…). Afecta a CO, MX, US y al resto: pagos duplicados al proveedor. Con NCF repetido en DO → 409 correcto.
- **Esfuerzo:** M.

**AP-04** — eje 2 · Concurrencia · **Alta**
- **Ubicación:** `payBills` hace `manager.find(VendorBill, { where: { id: In(billIds) } })` sin `lock` (~línea 790). En cambio `voidPayment` y las notas de débito sí bloquean con FOR UPDATE.
- **Prueba:** 4 pagos concurrentes de la misma sesión → 1×201 y 3×401 `step_up_token_already_used`. El step-up de un solo uso serializa por sesión y mitiga el riesgo, pero dos usuarios con permiso `pay` podrían pagar dos veces el mismo saldo. Esto último no se probó (es análogo a FLOW-01 en recepciones).
- **Forma correcta:** `SELECT … FOR UPDATE` sobre las facturas ordenadas por id.
- **Esfuerzo:** S.

**AP-05** — eje 2/5 · Integridad de compras · **Alta**
- **Ubicación:** `assertPurchaseOrderLinks` y `matchAgainstReceipts` (~líneas 640-720).
- **Qué pasa:** la factura se acepta y se contabiliza contra una línea de una OC en PENDING_APPROVAL y sin recepción. Reproducido con la OC PO de qa-a 80412de3…: asiento Dr 1140 inventario 401,48 sin GRNI, y el evento posterior al commit sube el stock del producto QA-F6-4195 a 4 sin recepción. No se comprueba el estado de la OC, no hay tolerancia de precio (el precio de la factura frente al de la OC va íntegro a inventario) y el movimiento de stock ocurre fuera de la transacción (`afterCommit` + `vendor.bill.posted`), así que si falla el handler queda asiento sin existencias.
- **Forma correcta:** exigir OC aprobada o enviada; política de match a 2 o 3 vías configurable con tolerancias; PPV; stock dentro de la transacción o mediante outbox.
- **Esfuerzo:** M.

**AP-06** — eje 2 · Contabilidad · **Media/Alta**
- **Ubicación:** `payBills`, `resolveAccount(... AccountRole.SALES_DISCOUNTS, settings.defaultSalesDiscountsId)`.
- **Qué pasa:** el descuento por pronto pago de un proveedor se acredita a la cuenta de descuentos en VENTAS (contra-ingreso). Es una clasificación incorrecta; verificar con contador.
- **Esfuerzo:** S.

**AP-07** — eje 2/3 · Impuestos · **Media**
- **Qué pasa:** `taxAmount` es un número manual de cabecera, sin códigos por línea. `taxToCost` y `taxProportional` no se validan contra `taxAmount` (el ITBIS deducible puede salir negativo).
- **Esfuerzo:** M.

**AP-08** — eje 3 · DO · **Media**
- **Qué pasa:** la nota de débito acepta `ncf` sin `checkReceivedNcf` (no valida B04 ni duplicados), en `vendor-debit-notes.service.ts` `create`.
- **Esfuerzo:** S.

**AP-09** — eje 7 · Rendimiento · **Media**
- **Qué pasa:** `GET /accounts-payable` sin paginación (`findAll` hace `getMany()`), y el aging se calcula en memoria.
- **Esfuerzo:** S.

**AP-10** — transversal · **Media**
- **Qué pasa:** el redondeo de `common/money.ts:77-84` (toCents en float), confirmado por el coordinador, afecta a `toCents` en las comparaciones de saldo y total de este módulo.

Comprobación a mano del asiento de la factura (qa-a, id 9f054fee…): subtotal 4 × 100,37 = 401,48; ITBIS 18 % = 72,2664 → 72,27; ISR 10 % = 40,148 → 40,15; retenido 112,42; CxP 473,75 − 112,42 = 361,33. Asiento: Dr 1140 401,48 + Dr 1150 72,27 = Cr 2135 112,42 + Cr 2110 361,33 = 473,75. **Cuadra**; la aritmética es correcta, el defecto está en la clasificación (AP-02). Pago por 361,33 → saldo 0, PAY-2026-000001.
CO (qa-co): factura de servicios por 1 000 000 + IVA 190 000 sin regímenes configurados → 0 retenciones. Al declarar 4 % / 15 % → 400 `withholding_stated_not_what_applicable`; con motivo de excepción (override) → acepta, saldo 1 121 500 (cálculo correcto). No se puede modelar ReteICA (kinds VAT/INCOME) ni base mínima en UVT (`tenant-withholding-regime.entity.ts`: no tiene columna de umbral).

## 7. Camino mínimo a producción (DO y CO)
1. AP-01 (S)
2. AP-02 (S–M)
3. AP-04 (S)
4. AP-03, número del proveedor y deduplicación en todos los países (M)
5. AP-05, match configurable y OC aprobada (M)
6. Pruebas de integración con BD en CI para todo lo anterior (M)

Las correcciones son retoques; no hace falta rehacer.

## 8. Camino a 100
| Mejora | Puntos | Esfuerzo |
|---|---|---|
| Corregir AP-01, AP-02 y AP-04 | +12 | S |
| Número de proveedor y duplicados | +6 | M |
| Match a 3 vías con tolerancias y PPV | +8 | M |
| Impuestos por línea | +6 | M |
| Retenciones CO por concepto, base y municipio | +8 | L |
| Archivos de pago ACH y certificados de retención | +6 | L |
| Partir el servicio y mover el stock a outbox | +4 | M |

## 9. Competitividad (40, 30–50, confianza media)
- **Brechas básicas:** duplicados fuera de DO, match a 3 vías y ReteICA/bases en UVT frente a Siigo y Alegra.
- **Brechas avanzadas:** pagos ACH y portal de proveedores (como Bill.com), aprobación multinivel por importe (no verificado).
- **Diferenciadores:** captura por correo e IA (`bill-capture`, `inbox/bill-mail.handler.ts`), aging con diferencia contra la cuenta de control, step-up para mover fondos.

## 10. Fortalezas a preservar
- Asientos cuadrados y anulación por reversión.
- Idempotency-Key obligatoria.
- Step-up de un solo uso en los pagos.
- NCF DO validado contra la cédula/RNC del proveedor y deduplicado con advisory lock.
- Aging que reporta la diferencia con la cuenta de control (gracias a eso se detectó AP-01).

## 11. No verificado
- Pagos concurrentes de dos usuarios distintos.
- Flujo de aprobación multinivel.
- Multimoneda y diferencia en cambio.
- UI.
- Ejecución de las specs con BD.
- Formato 606.

Cobertura aproximada: 40 % de los archivos leídos (el servicio principal, completo) y 9 de ~20 endpoints ejecutados.

<!-- RESUMEN: modulo=cuentas-por-pagar; madurez=38; prep=35; veredicto=No listo; eje_debil=Correccion e integridad; criticos=2; altos=3; camino_min=M -->
