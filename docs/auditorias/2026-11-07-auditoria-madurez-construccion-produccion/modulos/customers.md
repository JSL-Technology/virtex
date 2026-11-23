# Ficha de módulo — `customers` (clientes, contactos, direcciones, grupos, recibos de cobro y su aplicación)

> ⚠️ **CRÍTICO (TES-01)**: un recibo en USD se aplica 1:1 contra una factura en DOP sin conversión. La factura queda PAGADA y se contabiliza una **ganancia cambiaria ficticia** (prueba real: USD 200 contra factura de DOP 200 → banco +12.400 DOP, CxC −200, diferencia cambiaria +12.200). Alcanzable desde la UI (el formulario ofrece todas las facturas abiertas sin filtrar por moneda).

Familia TES · auditor: TES · tenant propio `qa-do-tes@virtex.test` (org e95b6ef1-…) · fecha 2026-11-07 · evidencia de ejecución en `…/scratchpad/agents/tes/` (scripts s4, s7, s8, s9, s17; notas `NOTES.md`).

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/customers/` — 26 archivos, 3.746 líneas. Núcleo: `customer-payments.service.ts` (969 l.), `customers.service.ts` (285), `customer-payments.controller.ts`, `customers.controller.ts`, `customer-groups.*`, `customer-statement.*`, DTOs `create-customer.dto.ts`, `create-customer-payment.dto.ts`.
- **Endpoints**: `POST/GET/GET:id/PATCH/DELETE /customers`, `GET /customers/:id/dependents`, `GET /customers/:id/statement`, `/customer-groups`; `POST /customer-payments` (@Idempotent, PeriodLockGuard), `GET /customer-payments`, `GET /customer-payments/aging`, `GET /customer-payments/advances/:customerId`, `GET /customer-payments/:id`, `POST /customer-payments/:id/void` (@Idempotent).
- **Tablas**: customers, customer_contacts, customer_addresses, customer_groups, customer_payments, customer_payment_lines (+ escribe `invoices.balance/status`).
- **Frontend**: `features/contacts` (clientes, `/e/<slug>/contacts/customers[/new]`), `features/customer-receipts` (lista + formulario, 1.743 l. no-spec), reporte `reports/aging/receivables` (`features/contacts/data/aging.service.ts`).
- **Pruebas**: `customer-payments.spec.ts` (17 tests, BD real), `customers-search.spec.ts` (6), `customers-final-consumer.spec.ts`; todas verdes en la corrida del coordinador.
- **Países**: los 19 declarados (validación de documento por catálogo `IdentityDocumentService`). **Núcleo para vender: sí** (CxC y cobros son básicos de cualquier ERP).

## 2. Estándar de referencia (resumen)
(a) Básicas: maestro de clientes con identificación fiscal validada por país y sin duplicados; condiciones de pago/crédito; recibos con aplicación a una o varias facturas, cobro parcial, anticipo/saldo a favor, retenciones, descuento pronto pago, anulación con reversa contable; antigüedad de saldos que cuadre con la cuenta control; multimoneda con diferencia cambiaria realizada. Avanzadas: aplicación automática por regla, límite de crédito con bloqueo, estado de cuenta enviado al cliente, portal de pago, cobros por lote/importación bancaria, write-off de diferencias pequeñas.
(b) Invariantes: Σ saldos abiertos = cuenta control CxC; un recibo no puede aliviar más que el saldo; la conversión se hace siempre en la moneda del documento; anulación restituye exactamente; idempotencia ante reintento; concurrencia no sobreaplica.
(c) Líderes: NetSuite / Dynamics 365 / SAP B1 obligan a que el pago se aplique en la moneda de la factura o convierten con tipo de cambio explícito y registran ganancia/pérdida realizada (confianza alta, conocimiento de producto, no verificado con fuente web en esta sesión); Odoo concilia pagos multimoneda con asiento de diferencia (media); Alegra/Siigo validan RNC/NIT y bloquean duplicados (media). Normativo DO (RNC/cédula, retenciones ITBIS/ISR) — verificar con contador local.
(d) Construcción: servicio de dominio transaccional con bloqueo de filas de factura, puerto de contabilización, sin escribir tablas ajenas directamente (evento o puerto del dueño de `invoices`).

## 3. Resultado
- **Madurez: 48 (42–55, confianza media-alta)** — tope por hallazgo crítico (≤59) y eje 2.
- **Preparación comercial: 50 (44–57)** · **Veredicto: No listo** (compuerta 2 incumplida por TES-01; en un tenant mono-moneda DOP el flujo sería "piloto controlado").
- **Eje más débil**: 2 (corrección/integridad multimoneda).
- **Críticos abiertos**: 1 (TES-01).

## 4. Ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad/completitud | 62 (55–68, alta) | Flujos reales probados: alta, parcial, multi-factura, anticipo, aplicación de anticipo, anulación, antigüedad (s7). No hay límite de crédito aplicado (grep `creditLimit` solo en baseline/entidad), ni write-off de diferencias, ni aplicación de notas de crédito desde el recibo. | Límite de crédito con bloqueo/aviso; write-off; estado de cuenta enviable; importación de cobros. |
| 2 | Corrección/integridad | 35 (28–45, alta) | TES-01 (USD vs DOP); TES-02 (línea de banco sin importe en divisa). Correcto: FOR UPDATE de facturas (2 cobros simultáneos del saldo total → 1×201, 1×400 `status_cannot_take`), anulación concurrente 1×200/1×400, idempotencia (misma clave → mismo id; cuerpo distinto → 409), sobrepago → anticipo 200, anulación de anticipo consumido bloqueada, CxC mayor = saldo abierto = 2.200,00 (SQL y `controlAccountDifference: 0`). | Validar `invoice.currencyCode === receipt.currencyCode` o convertir con tasa explícita; registrar importes en divisa; bloqueo explícito de anticipos (hoy seguro solo por el lock implícito de numeración, TES-18). |
| 3 | Multi-país | 55 (45–62, media) | RNC con dígito verificador OK (malo 422, bueno 201); RFC MX ok/malo; NIT GT malo 422; US sin tipo asume SSN/ITIN y rechaza un EIN válido "12-3456789" (422) salvo `identityDocumentTypeCode:"EIN"` (201). RNC con guiones "1-31-18551-7" → 422 pese a comentario de normalización. `country:"ZZ"` aceptado (`@IsString`). | Tipo por defecto según persona jurídica/natural por país; normalizar formato oficial; `country` ISO validado; pruebas por país. |
| 4 | Arquitectura | 58 (50–65, media) | Transacción única recibo+líneas+factura+asiento; DTOs con whitelist (organizationId rechazado). `totalBilled` (estadística derivada) escribible por POST/PATCH (PATCH → 123456.78 aceptado). Lista de clientes/recibos sin paginación por defecto (`customers.service.ts` findAll sin `limit` = lista completa; `customer-payments.service.ts` findAll sin límite). | DTO sin campos derivados; paginación obligatoria; contrato de errores de dominio. |
| 5 | Higiene/separación | 45 (38–52, media) | Escribe tabla ajena `invoices` (balance/status) en `customer-payments.service.ts:361,639`; importa `AgingReport` desde `accounts-payable.service`; importa entidades de organizations/users/treasury/ledger (boundaries: ventas→identidad 66 private-imports, incl. archivos de customers). | Puerto de `invoices` para aplicar/restituir saldo; tipos de antigüedad en contrato compartido. |
| 6 | Calidad de código | 60 (55–68, media) | Servicio de 969 líneas con comentarios extensos (muchos narran historia/QA en vez de reglas); lint api con warnings (no-explicit-any/no-non-null) presentes en el módulo. | Partir create() en pasos; comentarios de regla, no de historia. |
| 7 | Robustez/rendimiento | 55 (48–62, media) | Bloqueo ordenado de facturas (`lockInvoices` ORDER BY id) evita interbloqueos; listados sin límite; aging carga todas las facturas abiertas en memoria. | Paginación; aging en SQL agregado. |
| 8 | Seguridad/aislamiento | 78 (70–84, alta) | qa-do-b contra recursos de qa-do-a/tes: GET/PATCH/DELETE cliente 404, recibo 404, void 404, pago con customerId/bankAccountId ajenos 404/400, invoiceId ajeno 400; member 403 en list/create/aging. Triggers `tg_same_tenant_*` en customers/customer_payments. Step-up no exigido para anular cobros (operación sensible, solo permiso `accounts_receivable:void`). | Step-up o doble aprobación en anulación; pruebas automáticas de IDOR. |
| 9 | Pruebas | 50 (42–58, media) | 17 tests de integración con BD real (buenos: retenciones, anticipos, FX positivo, antigüedad vs control). No hay test de moneda distinta recibo/factura, ni concurrencia, ni autorización, ni países distintos de DO. | Tests de TES-01/02, concurrencia, IDOR, países. |
| 10 | Operabilidad | 62 (55–68, media) | `audit_logs` genérico con previous/new (customer_payments CREATE 8/UPDATE 10); logger con nº de recibo; eventos de negocio tras commit. Sin columna `voided_by_user_id` (se depende del audit genérico). | Auditoría de negocio explícita en anulación (quién/motivo). |
| 11 | UX/idiomas | 60 (52–66, media) | Pantallas cargan (Playwright): Clientes, Nuevo cliente, Recibos, Nuevo recibo, Antigüedad. Formulario de recibo: moneda la decide la cuenta, pero lista facturas de cualquier moneda (`form.page.ts:223-230`) → induce TES-01. Claves sin traducir `common.skip_to_content`, `charts.*` (globales). | Filtrar/convertir facturas por moneda en el form; i18n completo. |
| 12 | Competitividad | 48 (40–55, media) | Básicas casi completas (sin límite de crédito efectivo, sin write-off); localización DO buena (RNC, retenciones); sin portal de pago/cobro por lote. | Límite de crédito, write-off, cobros masivos, portal. |

Promedio simple ≈ 56; la madurez (48) queda por debajo por el tope de crítico y eje 2.

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, básicas presentes | Cumple con reservas | Flujos reales; falta límite de crédito/write-off. |
| 2 | Integridad escrituras críticas | **No cumple** | TES-01, TES-02. |
| 3 | AuthZ y aislamiento | Cumple | s9: 404/403 en todos los intentos. |
| 4 | Validación servidor | Cumple con reservas | country libre, totalBilled escribible. |
| 5 | E2E sin 500 | Cumple | Sin 500 en api.log durante pruebas TES. |
| 6 | Cumplimiento por país | No cumple (US) | EIN rechazado sin tipo explícito. |
| 7 | Pruebas en CI | No cumple | La rama está en rojo (GLOBAL-RESULTS) y faltan casos críticos. |
| 8 | Auditoría de negocio | Cumple con reservas | audit_logs genérico. |
| 9 | Migraciones | Cumple | Índices únicos por org (taxId, email), CHECK de anticipo. |
| 10 | Observabilidad | Cumple con reservas | Logs sin correlación de tenant explícita en mensaje. |
| 11 | UI/traducciones | Cumple con reservas | claves globales faltantes. |
| 12 | Documentación | No cumple | No hay guía operativa de cobros multimoneda. |

## 6. Hallazgos
**TES-01** · customers (eje 2) · Integridad de datos · **Crítica** · `customer-payments.service.ts` bucle de líneas (~l. 300-370: `relieved` comparado con `invoice.balance` y `convert(relieved, invoiceRate)` sin mirar `invoice.currencyCode`) · Pasos: cuenta USD (97c041de…), factura FAC-00000006 DOP 200, `POST /customer-payments {currencyCode:"USD", bankAccountId:USD, amountReceived:200, lines:[{invoiceId, amount:200}]}` → 201; factura PAID; asiento a977ff95: Dr 1121 12.400, Cr 1130 200, Cr 5750 12.200. Ganancia ficticia y cliente que debía 200 DOP "pagó" 200 USD. · Forma correcta: rechazar si la moneda del recibo ≠ la de la factura salvo que se indique monto en moneda de factura y tasa; convertir ambos lados. · Impacto: bloquea la venta (estados financieros falsos). · Esfuerzo S.
**TES-02** · customers/treasury (eje 2) · Integridad · **Alta** · `customer-payments.service.ts` `push()` (sin `currencyCode/foreignCurrencyDebit/exchangeRate` en línea de banco) · Tras cobrar USD 200 en cuenta USD, `GET /treasury/cash-position` → `balanceInAccountCurrency: 1000` (debería 1.200) con base 72.400. Las transferencias sí guardan divisa. Rompe conciliación y revaluación de cuentas en divisa. · Forma: registrar importe y tasa en divisa en la línea de banco (y anticipos). · Riesgo operativo · S.
**TES-11** · customers (eje 4/8) · Seguridad/validación · Media · `create-customer.dto.ts:126-129` (`totalBilled`), `country` solo `@IsString` · PATCH totalBilled=123456.78 aceptado; country "ZZ" aceptado. · Quitar campos derivados del DTO; `@IsISO31661Alpha2`. · Deuda · S.
**TES-12** · customers (eje 3) · Multi-país · Media · `identity-document.service.ts:239-266` (default por país) · US sin tipo → SSN/ITIN rechaza EIN; RNC con guiones rechazado. · Default por tipo de persona; normalización de formatos oficiales. · Brecha competitiva · S.
**TES-14** · customers (eje 5) · Mezcla de contexto · Media · `customer-payments.service.ts:361,639` escriben `invoices`; import de `accounts-payable.service` · Extraer el módulo exige tocar invoices y AP. · Puerto `ReceivablesLedgerPort` del dueño de invoices. · Deuda · M.
**TES-17** · customers (eje 7) · Rendimiento · Media · `customers.service.ts` findAll / `customer-payments.service.ts` findAll sin límite por defecto. · Paginación obligatoria. · Deuda · S.
**TES-18** · customers (eje 2) · Concurrencia · Media · `advanceOutstanding` sin bloqueo · 2 consumos simultáneos del mismo anticipo → 1×201, 1×400 (correcto hoy), pero solo porque `nextReceiptNumber` serializa por la fila de secuencia antes de leer el anticipo. Un cambio de orden lo rompe. · `SELECT … FOR UPDATE` sobre cliente/anticipos. · Deuda · S.
**TES-16** · customers (eje 10) · Operabilidad · Baja · `customer_payments` sin `voided_by_user_id`. · Columna explícita. · S.

## 7. Camino mínimo a producción
1. TES-01 validación/conversión de moneda (S) — rehacer bloque de líneas; todos los países.
2. TES-02 importes en divisa en el asiento del cobro (S).
3. Tests de integración: moneda distinta, concurrencia, IDOR, US/MX (M).
4. TES-11/12 validaciones (S).
5. Paginación (S).

## 8. Camino a 100
TES-01/02 (+12 pts) · límite de crédito con bloqueo (+6, M) · write-off/ajuste de diferencias (+4, S) · puerto de invoices (TES-14, +4, M) · pruebas por país (+4, M) · cobros masivos/importación (+5, L) · portal de pago (+5, L, depende de saas-payment).

## 9. Competitividad
Brechas básicas: límite de crédito efectivo, write-off, multimoneda correcta. Avanzadas: aplicación automática desde extracto, portal, cobranza por lote. Diferenciador: validación fiscal del documento por catálogo y antigüedad que cuadra con el mayor (no todos los locales lo hacen). Fuentes: conocimiento de producto (confianza media, no verificado web en esta sesión).

## 10. Fortalezas a preservar
Bloqueo ordenado de facturas; idempotencia con detección de cuerpo distinto; anticipos con tasa promedio; anulación que restituye y bloquea anticipo consumido; antigüedad con diferencia vs cuenta control; índices únicos por organización.

## 11. No verificado
Retenciones/descuento vía API (solo por tests); períodos cerrados para cobro (no cerré período); recibos con sucursales; plan de facturas limitó a 10 facturas (starter: 10/mes) — no pude probar más casos en DOP/USD con factura USD.
