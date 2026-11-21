# Ficha — `pos` (backend `/pos` + aplicación `apps/pos`)

> ⚠️ **CRÍTICO (INV-01 = mismo hallazgo que FAC-CMP-01, confirmado también por FAC y el coordinador; referencia cruzada)**: los reportes DGII **607 y 608 responden 500 en todo tenant DO**. `ComplianceService.tillFiscalSales` consulta la columna `pos_sales.created_at`, que no existe (la columna es `"createdAt"`). Con esto, las ventas de caja nunca llegan a los formatos fiscales.

Familia INV · 2026-11-07 · tenant `qa-do-inv` (RNC 101123456). Scripts y capturas: `/tmp/claude-0/-home-user-virtex/18f6e197-474f-5038-b8e5-f1d402f375bd/scratchpad/agents/inv/` (`par.mjs`, `pos-ui*.cjs`, `posui-*.png`).

## 1. Identificación

- **Backend**: `apps/backend/api/src/app/pos/`, 1.459 líneas (635 en specs).
  - Archivos: `pos.service.ts` (664), `pos-posting.service.ts` (158), entidades `pos-sale` (162) y `pos-shift` (127), `pos.controller.ts` (124).
- **Endpoints**: catalog, context, shifts/active, POST shifts, shifts/:id/close, shifts/:id/report (X/Z), POST sales (`@Idempotent`), GET sales, sales/:id, POST sales/:id/void (`@Idempotent`, `pos:manage_shifts`).
- **Tablas**: `pos_shifts`, `pos_sales`, más `idempotency_records`, `stock_movements`, `journal_entries` y `ncf_sequences`.
- **Frontend**: aplicación aparte `apps/pos` (5.606 líneas, 8 suites y 37 pruebas OK según el coordinador).
  - Componentes: terminal, catálogo, ticket, pago, turno, diario, ajustes de terminal, recibo 80 mm.
  - Documento de diseño `docs/pos.md`.
- **Países**: los 19. Solo DO tiene documento fiscal (B02).
- **¿Núcleo para vender?** Sí, para retail y restaurantes.

## 2. Estándar de referencia (confianza media, sin verificación web)

- **(a) Básicas**:
  - turnos con fondo y arqueo (con conteo por denominación y conteo ciego);
  - X/Z con numeración;
  - cobro mixto y cambio;
  - descuentos con límite por rol;
  - anulación y devolución (también después del cierre) con supervisor;
  - identificación del cliente para el comprobante con crédito fiscal (B01/E31 en DO);
  - documento fiscal por venta según el país (DO: e-CF E32 o B02; MX: CFDI global de público en general; CO: documento equivalente POS electrónico; PE: boleta electrónica; CL: boleta electrónica; verificar con contador local);
  - ventas atómicas e idempotentes;
  - movimiento de inventario y asiento contable;
  - impresión de ticket.
- **(a) Avanzadas**: modo offline con cola y numeración de contingencia, multi-caja por sucursal, promociones, fidelidad, integración con datáfono, cajón e impresora fiscal, pantalla de cliente.
- **(b) Invariantes**:
  - una venta = un cobro = un movimiento de stock = un asiento = un comprobante, todo o nada;
  - el reintento no duplica;
  - el efectivo esperado = fondo + efectivo neto de cambio − retiros;
  - el descuadre se registra contablemente;
  - el NCF es correlativo, sin huecos ni duplicados;
  - un comprobante anulado se reporta (608 en DO).
- **(c) Líderes**: Odoo POS (offline, sesiones, control de caja; confianza alta); Square y Lightspeed (offline, devoluciones; confianza alta); Bsale (boleta electrónica CL; confianza media); Alegra POS (factura electrónica DO/CO; confianza media).
- **(d) Construcción**: transacción única con bloqueo de turno, clave de idempotencia en BD, numeración fiscal dentro de la transacción, ticket inmutable.

## 3. Resultado

- **Madurez: 55 (48–60, confianza alta)**. Queda topada en ≤59 por el crítico INV-01. La ingeniería transaccional es buena; las brechas son de cumplimiento y de funciones básicas.
- **Preparación comercial: 45. Veredicto: No listo**:
  - **DO**: no listo por INV-01, por la B02 omitida silenciosamente y por la ausencia de e-CF E32.
  - **MX, CO, PE, CL, AR, BR, EC**: no listo; el ticket no es fiscal y no hay CFDI global, documento equivalente POS ni boleta.
  - **US**: piloto controlado posible (no hay documento fiscal de venta; el impuesto sobre ventas es por jurisdicción, verificar).
  - **UY…NI**: no listo (sin documento fiscal).
- **Eje más débil**: 3 (multi-país, 30). **Críticos abiertos**: 1 (INV-01).

## 4. Ejes

| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 58 (50–65, alta) | Ejecutado: abrir turno; venta mixta (tarjeta 300 + efectivo 200 sobre 472 → cambio 28, `paymentMethod: mixed`); anulación con motivo; cierre con arqueo; X/Z; UI completa (Playwright: abrir turno → producto → F9 → efectivo 300 → venta 247,80, cambio 52,20, NCF B0200000012). **Ausentes**: descuentos (no hay campo en `process-sale.dto.ts`); devoluciones después del cierre (`voidSale` exige turno abierto, `pos.service.ts:500-503`); identificación del cliente con RNC/B01 (solo `customerName`); numeración propia de ticket (solo uuid + NCF); retiros y entradas de caja; conteo por denominación; offline (no lo declara: solo hay indicador de conexión, `connectivity.service.ts`). | Descuentos, devoluciones, B01/E31, retiros, numeración de ticket. |
| 2 | 76 (70–82, alta) | **Idempotencia**: misma venta y misma clave → una sola venta (201 replay); misma clave con otro cuerpo → 409 `idempotency_key_reused`. **Concurrencia**: 20 ventas simultáneas con existencia para 10 → 10×201 y 10×400 `not_enough_stock_in_warehouse`, stock 0, `salesCount` = 10, 10 NCF distintos y sin huecos (secuencia de 1 a 11). **Asientos**: venta Dr 1110 172 + Dr 1120 300 / Cr 4100 400 + Cr 2130 72; costo Dr 5100 40 / Cr 1140 40 (2×20, promedio correcto). **Anulación**: reversos exactos de los dos asientos, stock devuelto (+1 SALE_RETURN), `cashSalesTotal` reducido; segunda anulación → 400. **Arqueo**: esperado 1000 + 172 = 1172, contado 1150 → varianza −22 ✔. **Pero el descuadre no se contabiliza** (0 asientos de faltante o sobrante: INV-03). `pos_sales."shiftId"` no tiene FK a `pos_shifts` (`\d pos_sales`). El registro de idempotencia se completa fuera de la transacción de negocio: si el proceso cae entre el commit y el update, la clave queda `in_progress` para siempre (no hay TTL; `idempotency.interceptor.ts:86-97`), lo cual es seguro pero bloquea. | Asiento de descuadre, FK, TTL o recuperación de claves huérfanas. |
| 3 | 30 (22–38, media-alta) | **Remate MX/US ejecutado**: `qa-mx-a`: ajuste +5@40 → asiento; venta POS 100 + IVA 16 % = 116 → asiento Dr 1110 116 / Cr 4100 100 / Cr 2130 «IVA por Pagar (Débito Fiscal)» 16, costo 40; `fiscal_number` NULL → **sin CFDI (ni global de público en general)**, el ticket es «no fiscal»; no se filtra B02/NCF de DO ✔; terminología «Débito Fiscal» no es la usual en MX («IVA trasladado», verificar con contador). `qa-us-a`: `taxRequiresConfiguration:true`, `standardTaxRate: 0` → venta aceptada con impuesto 0 (sales tax por jurisdicción no resuelto), asientos en inglés ✔, sin reglas DO ✔. Solo DO: `drawConsumerReceipt` emite **B02** si existe una secuencia activa y el RNC (`pos.service.ts:369-387`). **Sin secuencia, la venta se completa sin comprobante y sin aviso** (primera venta `fiscal_number` NULL antes de crear la B02: INV-02). No hay E32: según la Ley 32-23, todos los contribuyentes debían emitir e-CF a mayo de 2026 (verificar con contador o abogado local). Los demás países: «no fiscal». Las ventas POS no entran en 607/608 por el 500 (INV-01). | E32 vía einvoicing; bloquear la venta sin comprobante donde sea obligatorio; documento POS por país. |
| 4 | 70 (62–76, media) | Lógica en el servicio; transacción única con `lockShift` (pesimista); servidor autoritativo en precio e impuesto (`pos.prices_changed` / `pos.totals_changed`); ticket inmutable con anulación auditada. `pos.service.ts` con 664 líneas mezcla turnos, ventas, reportes y fiscalidad. | Separar `ShiftService`, `SaleService` y `FiscalReceiptPort`. |
| 5 | 55 (48–62, media) | Transacción compartida con inventory (`pos.service.ts:257/507`, `logs/boundaries-report.log:1111-1112`) e importa `InventoryService` (privado, línea 264). La fiscalidad (`compliance.getNextNcf`) va dentro de la transacción, lo cual es correcto aunque es acoplamiento. compliance lee `pos_sales` con SQL crudo y nombres de columna erróneos (INV-01). | Puerto de existencias y puerto de comprobante; vista o contrato de ventas de caja para compliance. |
| 6 | 65 (58–72, media) | 17 avisos de lint en `app/pos/`; 0 en `apps/pos`. | Limpiar. |
| 7 | 68 (60–75, media) | Bloqueo por turno: serializa las ventas del mismo turno (correcto para una caja). Hasta 500 líneas por ticket. `GET /pos/sales?shiftId` sin paginación (acotado por turno). | Paginación del diario. |
| 8 | 82 (75–88, alta) | Remate (API con AUTH_THROTTLE_LIMIT=200): `qa-do-a-member` (products:view, invoices:view) → GET /inventory 200 y GET /inventory/categories 200; **403** en POST/PATCH /inventory, POST categorías, GET /inventory/stock, POST ajustes y post de ajuste, POST transferencias, POST/PATCH /wms/warehouses, POST /pos/shifts, POST /pos/sales, POST /pos/sales/:id/void, POST manufacturing work-centers/orders, POST /units-of-measure/company ✔ (autorización en servidor verificada). Además: `qa-do-a` contra recursos de `qa-do-inv`: report del turno → 404; venta → 404; anulación → 404; `sales?shiftId=` → `[]`. La anulación exige `pos:manage_shifts` + `@BranchScoped`. `assertMayActOnShift`: solo el dueño del turno o un supervisor. No ejecuté el caso de cajero sin `manage_shifts` (429 en el login del member); verificado por código. | Matriz real cajero/supervisor. |
| 9 | 58 (50–65, alta) | `pos.service.spec.ts` (429 líneas) se apoya en **mocks** (`jest.fn`, `dataSource.transaction` falso); `pos-branch-scope.spec` y `pos-posting.spec` pasan con BD real. No hay pruebas de idempotencia ni concurrencia contra BD, y **ninguna prueba cubre `tillFiscalSales`** (grep en specs → 0), lo que explica que INV-01 no se detectara. | Pruebas de integración de venta, anulación, concurrencia y 607/608 con ventas POS. |
| 10 | 62 (55–70, media) | Logs estructurados `pos_sale_voided` y aviso de cierre con varianza. La anulación guarda quién, cuándo y por qué. Turnos y ventas no se escriben en `audit_logs` (consulta por entidad: no aparecen `pos_*`). | Auditoría de negocio. |
| 11 | 70 (62–76, media) | La UI POS funciona de punta a punta (capturas `posui-*.png`); atajos de teclado; es, en, pt. Textos como «1 ventas» (plural). El catálogo muestra el stock de la empresa y no el del almacén de la caja («5 en existencia» con 2,5 en el almacén por defecto): el error aparece al cobrar. | Stock por almacén de la caja; pluralización. |
| 12 | 45 (38–52, media) | Frente a Odoo POS: no tiene offline, devoluciones, descuentos, promociones ni fidelidad. Frente a Alegra POS (DO): no tiene e-CF. A favor: idempotencia y atomicidad del servidor. | — |

## 5. Compuertas

| # | Estado | Evidencia |
|---|---|---|
| 1 | No cumple | Sin descuentos, devoluciones ni B01. |
| 2 | Cumple | Idempotencia, atomicidad y concurrencia ejecutadas. |
| 3 | Cumple | Aislamiento y matriz de permisos con member ejecutados (403 en abrir turno, vender, anular). |
| 4 | Cumple | El servidor recalcula precio y total. |
| 5 | **No cumple** | 607/608 → 500 después del flujo POS. |
| 6 | **No cumple** | DO: B02 opcional y silenciosa, sin E32. MX: venta sin CFDI (ejecutado). US: venta con impuesto 0 sin bloquear (ejecutado). Sin filtración de reglas DO a MX/US (ejecutado). |
| 7 | Parcial | Specs con mocks; CI en rojo global. |
| 8 | Parcial | No hay `audit_logs`. |
| 9 | Cumple | — |
| 10 | Cumple | — |
| 11 | Cumple con reserva | — |
| 12 | Cumple con reserva | `docs/pos.md` no menciona la fiscalidad. |

## 6. Hallazgos

- **INV-01 (= FAC-CMP-01)** — pos/compliance · ejes 2, 3, 5 · **Categoría**: bug / multi-país · **Severidad: CRÍTICA**
  - **Ubicación**: `apps/backend/api/src/app/compliance/compliance.service.ts:417-437` (`tillFiscalSales`).
  - **Qué está mal**: la consulta usa `created_at`, pero la columna real es `"createdAt"` (`\d pos_sales`). Pasos:
    1. `GET /compliance/reports/607?year=2026&month=11` con `qa-do-inv` → **HTTP 500**; el log muestra `QueryFailedError: column "created_at" does not exist at ComplianceService.tillFiscalSales`.
    2. `GET /compliance/reports/608?...` → **HTTP 500** con la misma causa.
  - **Consecuencia**: la consulta se ejecuta siempre, así que el 607 y el 608 son inutilizables para **todo** tenant DO, y las ventas POS con NCF y las anulaciones nunca se declaran. Ninguna spec cubre la función. El último commit del archivo es `94d125d8 fix(dgii): el 607 sigue el formato publicado…`.
  - **Forma correcta**: corregir la columna (o leer la entidad con TypeORM) y añadir una prueba de integración 607/608 con ventas POS y anulaciones.
  - **Impacto**: **bloquea la venta en DO** (incumplimiento de la declaración mensual).
  - **Esfuerzo**: S. (Notificar también a la familia FAC.)
- **INV-02** — pos · eje 3 · **Severidad: alta**
  - **Ubicación**: `pos.service.ts:369-387`.
  - **Qué está mal**: si el tenant DO no tiene una secuencia B02 vigente (o le falta el RNC), la venta se completa **sin comprobante fiscal** y sin advertencia al cajero ni al servidor. Ejecutado: venta `a1272cdb…` con `fiscal_number` NULL; tras provisionar la B02, la siguiente recibió `B0200000001`. Además, nunca usa E32 (e-CF de consumo), que es obligatorio para todos los contribuyentes desde 2026 según el calendario de la Ley 32-23 (verificar).
  - **Forma correcta**: política por país: rechazar la venta (o modo de contingencia explícito) si no hay comprobante; emitir E32 por einvoicing.
  - **Impacto**: riesgo fiscal para el cliente.
  - **Esfuerzo**: M/L.
- **INV-03** — pos · eje 2 · **Severidad: alta**
  - **Qué está mal**: el descuadre del arqueo no se contabiliza. Cierre con 1150 contados frente a 1172 esperados → `closingVariance: -22`, pero 0 asientos de faltante. La cuenta de caja 1110 queda 22 por encima del efectivo real. El fondo inicial tampoco se registra como traspaso de tesorería.
  - **Forma correcta**: asiento de diferencia de caja (gasto o ingreso) al cerrar, con aprobación del supervisor por encima de un umbral.
  - **Esfuerzo**: M.
- **INV-04** — pos · eje 1 · **Severidad: alta**
  - **Qué está mal**: no hay devoluciones ni notas de crédito después del cierre del turno (`voidSale` → `pos.sale_shift_closed`), ni descuentos, ni identificación del cliente para B01/E31 (crédito fiscal).
  - **Impacto**: bloquea la venta a retail.
  - **Esfuerzo**: L.
- **INV-17** — pos · eje 2 · **Severidad: media**
  - **Qué está mal**: `pos_sales."shiftId"` no tiene FK (`\d pos_sales`), no hay correlativo de ticket por caja y la Z no tiene número correlativo.
  - **Esfuerzo**: S.
- **INV-18** — pos · eje 11 · **Severidad: media**
  - **Qué está mal**: el catálogo POS muestra el stock total de la empresa (`/pos/catalog`), mientras la venta descuenta del almacén de la sucursal o del almacén por defecto (`stock-ledger.service.ts` en `resolveWarehouse`). Se pueden añadir unidades que luego fallan al cobrar.
  - **Esfuerzo**: S.
- **INV-19** — pos/shared · eje 2 · **Severidad: baja**
  - **Qué está mal**: el registro de idempotencia queda `in_progress` sin TTL si el proceso cae después del commit (`idempotency.interceptor.ts:86-97`).
  - **Esfuerzo**: S.

## 7. Camino mínimo a producción

1. **DO**:
   1. INV-01 (S).
   2. INV-02: bloqueo sin comprobante y E32 (M/L, depende de einvoicing).
   3. INV-03 (M).
   4. INV-04 (L).
   5. Pruebas de integración (M).
2. **MX, CO, PE, CL, AR, BR, EC**: documento POS fiscal por país (XL; depende de las familias FAC y LOC).
3. **US**: INV-03 e INV-04 (impuesto por jurisdicción, verificar).

Todo es retocar: el núcleo transaccional es correcto.

## 8. Camino a 100

| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Documento fiscal por país (E32, CFDI global, POS electrónico CO, boletas PE/CL) | +15 | XL |
| Devoluciones, descuentos y B01 | +8 | L |
| Asiento de descuadre, retiros y denominaciones | +5 | M |
| Offline con cola y contingencia | +6 | XL |
| Pruebas de integración | +4 | M |
| Promociones y fidelidad | +4 | L |
| Correlativos de ticket y Z | +2 | S |

## 9. Competitividad

- **Básicas faltantes**: devoluciones, descuentos, documento fiscal fuera de DO y e-CF.
- **Avanzadas faltantes**: offline, promociones, datáfono integrado.
- **Diferenciador**: servidor autoritativo con idempotencia y concurrencia probadas; asiento y costo de venta en línea.
- **Fuentes**: Odoo POS, Square y Alegra (confianza media).

## 10. Fortalezas a preservar

- Transacción única con bloqueo de turno.
- `@Idempotent` con `UNIQUE (organization_id, key)` y hash del cuerpo.
- NCF asignado dentro de la transacción: sin huecos ante fallos (comprobado: 10 fallidos no consumieron números).
- Precio e impuesto decididos en el servidor.
- Anulación con reverso contable exacto y restitución de stock.
- Reporte X/Z por medio de pago, neto de cambio.

## 11. No verificado

- Cajero con `pos:operate` pero sin `pos:manage_shifts` (no hay usuario QA con ese rol; member sin pos:* → 403 en todo).
- Impresión física.
- Ramas con sucursales (`@BranchScoped`), cubiertas por `pos-branch-scope.spec` pero no ejecutadas en real.
- Comportamiento de la UI al perder la conexión.
