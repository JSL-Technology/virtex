# Auditoría de Finanzas, Tesorería y Contabilidad

**Alcance:** `apps/backend/api/src/app/{journal-entries, accounting, chart-of-accounts, treasury, reconciliation, accounts-payable, customers, invoices, financial-reporting, currencies, taxes, compliance, einvoicing, workflows}` y sus contrapartes en `apps/core/client-web`.
**Naturaleza:** diagnóstico para decidir qué se reconstruye. **Los veinte hallazgos están corregidos**; el diagnóstico se conserva verbatim y cada hallazgo lleva su estado.
**Fecha:** septiembre 2026.

---

## Paso 0 — El estándar contra el que se mide

Antes de mirar el código, esto es lo que tiene que ser cierto en un ledger de doble entrada de grado ERP/SaaS (NetSuite, Xero, QuickBooks Online). Es la vara; el código existente no lo es.

### Modelo de datos

```
journal_entry            (id, tenant, ledger, journal, fecha, número consecutivo,
                          estado, posted_by, posted_at, moneda, tasa, tipo_tasa,
                          fuente_tasa, fecha_cotización, origen (documento+módulo),
                          idempotency_key ÚNICA)
journal_entry_line       (entry_id, account_id, débito, crédito, moneda documento,
                          importe documento, dimensiones)
journal_entry_valuation  (line_id, ledger_id, débito, crédito)   ← multi-GAAP / multi-libro
```

Reglas que el **motor de base de datos** —no la capa de aplicación— debe garantizar:

1. `CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0) AND (debit > 0 OR credit > 0))` por línea.
2. Un *constraint trigger* `DEFERRABLE INITIALLY DEFERRED` al final de la transacción que verifica, **por asiento y por libro**, `SUM(débito) = SUM(crédito)` sobre la tabla de valoraciones (la que alimenta los saldos), no solo sobre las líneas.
3. Un trigger `BEFORE UPDATE OR DELETE` sobre `journal_entries` y sus hijas que rechaza cualquier mutación de una fila en estado `POSTED` salvo la transición controlada a `MODIFIED`/`VOID` con puntero al asiento sucesor. Un `UPDATE` directo sobre el histórico debe fallar aunque lo intente un DBA con `psql`.
4. Row-Level Security por `organization_id` en todas las tablas del mayor, con el tenant fijado por `SET LOCAL app.tenant_id`. La multi-tenancy no puede depender de que cada `WHERE` de cada servicio esté bien escrito.
5. Importes en `NUMERIC(18,4)` y aritmética en enteros de unidad mínima en el lenguaje. Nunca `double`.

### Generación y versionado de asientos

- **Un solo camino de posteo.** Todo subledger (facturación, compras, cobros, pagos, nómina, inventario, activos fijos) construye un DTO y llama al mismo servicio, dentro de la transacción del documento. Nada escribe líneas de mayor por su cuenta.
- **Idempotencia por diseño.** Cada asiento automático lleva una `idempotency_key` derivada del hecho de negocio (`invoice:{id}:revenue`, `recurring:{template}:{fecha}`, `payment:{batch}`) con índice único. El reintento del webhook, el doble clic y el retry de BullMQ colisionan contra el índice; no se resuelven con un `if` en memoria.
- **Inmutabilidad.** La corrección es reversión + reemplazo, ambos permanentes y enlazados (`reverses_entry_id`, `modified_from_entry_id`). El original queda visible.
- **Serie consecutiva sin huecos** por (tenant, diario, ejercicio fiscal), asignada con `UPDATE … RETURNING` sobre una fila-contador dentro de la transacción —nunca una `SEQUENCE`, que es no transaccional y deja huecos.
- **Saldos derivados**, no almacenados: `SUM` sobre el mayor. Si se necesita un rollup por escala, va detrás de la misma interfaz y se valida contra la consulta cruda.

### Trazabilidad

- Toda acción financiera —postear, revertir, anular, aprobar, rechazar, conciliar, desconciliar, cerrar y reabrir período, cambiar una cuenta del catálogo, editar una cuenta bancaria— escribe una fila de auditoría **en la misma transacción**, con actor, IP, valor anterior y posterior.
- Los **accesos de lectura** a datos financieros (exportes, reportes fiscales, descarga de mayor) también se auditan. SOX/ISO 27001 y las administraciones tributarias lo piden.
- La tasa de cambio usada en un posteo se **persiste con su procedencia**: tipo (oficial/mercado), fuente, fecha de cotización y método (directa/inversa/triangulada). Un número suelto no es auditable.
- Segregación de funciones real: quien crea un documento no puede aprobarlo; los pasos de aprobación se registran individualmente con actor y fecha.

---

## Requisitos fiscales por país — checklist previo

Enumerado antes de auditar, para después verificar campo por campo.

| País | Facturación electrónica | Reportes periódicos | Retenciones en la fuente | Tipo de cambio |
|---|---|---|---|---|
| **RD (DO)** | e-CF (NCF electrónico), XML firmado, envío a DGII, ACECF/ARECF, RFCE, códigos de seguridad, anulaciones | 606 compras, 607 ventas, 608 anulados, 609 pagos exterior, IT-1 (ITBIS), IR-17 (retenciones) | ITBIS retenido (30 %/100 % según tipo de pagador), ISR retenido (10 %/2 %/5 %…) | Tasa DGII del día; diferencia cambiaria realizada y no realizada |
| **México (MX)** | CFDI 4.0: UUID, timbrado por PAC, complementos (Pagos 2.0, Nómina 1.2, Comercio Exterior), Carta Porte, cancelación con motivo y acuse | DIOT, contabilidad electrónica XML (Catálogo de cuentas con código agrupador SAT, Balanza, **Pólizas con `NumUnIdenPol`**), declaración mensual | IVA retenido (6 %/2/3), ISR retenido (10 % honorarios, 10 % arrendamiento) | Tipo de cambio DOF del día hábil anterior; obligatorio publicar cuál se usó |
| **Colombia (CO)** | Factura electrónica DIAN UBL 2.1, CUFE, validación previa, documento soporte, nómina electrónica | Información exógena (Medios magnéticos), IVA bimestral, retenciones mensuales | ReteFuente, ReteIVA, ReteICA (municipal, tarifa por municipio y actividad) | TRM oficial (Banco de la República) |
| **Perú (PE)** | CPE/SUNAT (Factura, Boleta, NC, ND), OSE/SEE, XML UBL 2.1, resumen diario de boletas, comunicación de baja | PLE / SIRE: Registro de Ventas y Registro de Compras con formato de libro electrónico | Detracciones (SPOT), Retenciones y Percepciones de IGV | Tipo de cambio SBS compra/venta según naturaleza de la operación |
| **Chile (CL)** | DTE SII (33, 34, 39, 61, 56), folios CAF, firma, acuse | Libros de compra/venta electrónicos, F29 | Retención de honorarios (boleta) | Tipo de cambio SII; **UF/UTM como unidad de cuenta indexada** |
| **Argentina (AR)** | CAE/AFIP (WSFE), tipos A/B/C, factura de crédito electrónica MiPyME | Libro IVA Digital, CITI, percepciones | Retenciones de Ganancias, IVA, SUSS; **IIBB por jurisdicción (Convenio Multilateral)** | Tipo de cambio BNA; **ajuste por inflación (RT 6 / Título VI Ley 20.628)** |
| **Ecuador (EC)** | Comprobantes electrónicos SRI, clave de acceso, autorización | ATS (Anexo Transaccional Simplificado) | Retenciones de IVA y Renta con comprobante de retención electrónico | Dolarizado |
| **EE. UU. (US)** | **No hay factura electrónica obligatoria federal** | **Sales tax por estado/condado/ciudad/distrito especial**, nexo económico (post-*Wayfair*), certificados de exención, declaración por jurisdicción; 1099-NEC/1099-MISC; W-9 | Backup withholding 24 % | Multi-moneda opcional; ASC 830 para conversión |

**Transversal (todos):** momento en que se fija la tasa (fecha del documento vs. fecha de pago), reconocimiento de **diferencia cambiaria realizada** (al cobrar/pagar) y **no realizada** (revaluación de saldos al cierre), y presentación separada del efecto de tipo de cambio sobre el efectivo en el estado de flujos (IAS 7.28 / ASC 230-10-45-25).

---

## Hallazgos

Ordenados por severidad. Cada uno cita archivo y línea.

---

### CRÍTICO 1 — Los importes que forman los saldos del mayor se convierten dos veces en toda factura en moneda extranjera

- **Categoría:** invariante contable / bug
- **Severidad:** crítica
- **Ubicación:** `journal-entries/journal-entries.service.ts:429-436` y `:596-605`; `invoices/services/invoice-posting.service.ts:216-227`
- **Estado:** ✅ corregido. Los importes se convierten una sola vez: `buildValuations` recibe el importe ya en moneda de la valoración y `InvoicePostingService` deja de aplicar la tasa por segunda vez. Cubierto por pruebas que postean una factura en divisa y comprueban el saldo resultante contra el mayor.

**Qué está mal.** Los saldos de todo el producto se calculan como `SUM` sobre `journal_entry_line_valuations` (`chart-of-accounts/account-balances.service.ts:135`, migración `1788700000000-LedgerIntegrity.ts:23`). Las valoraciones son, por tanto, la fuente de verdad contable.

`prepare()` invoca:

```ts
// journal-entries.service.ts:429
line.valuations = this.buildValuations(
  manager, lineDto, line, defaultLedger.id,
  isForeignCurrency ? rate : 1,   // ← se pasa la tasa
  mappingRules,
);
```

y `buildValuations` aplica esa tasa a las valoraciones que el llamador entregó:

```ts
// journal-entries.service.ts:601
debit: convert(this.amount(valuation.debit, 'valuation.debit'), rate),
```

El contrato implícito es entonces: **las valoraciones se entregan en moneda del documento**. Cuentas por pagar y cobros lo respetan (`accounts-payable.service.ts:304`, `customer-payments.service.ts:292` entregan importes de documento). Facturación hace lo contrario:

```ts
// invoice-posting.service.ts:221-226
valuations: [
  {
    ledgerId,
    debit: round2(debit * exchangeRate),   // ya convertido a moneda base
    credit: round2(credit * exchangeRate),
  },
],
```

y a la vez fija `currencyCode: currency, exchangeRate: invoice.exchangeRate` en el DTO del asiento (`:136-137`), lo que hace `isForeignCurrency = true`. Resultado: la valoración vale `importe × tasa²`.

Con base DOP y una factura de USD 1 000 a 60,00: `line.debit` = 60 000 DOP (correcto), pero la valoración —la que suma el balance general, el estado de resultados, el balance de comprobación y el mayor— vale **3 600 000 DOP**. El chequeo de cuadre de `prepare()` (`:443`) opera sobre `line.debit/credit`, no sobre las valoraciones, así que no lo detecta; y como ambos lados se multiplican por el mismo factor, el asiento sigue "cuadrando" y ningún reporte lo señala. El error solo desaparece cuando la moneda del documento es la moneda base (tasa = 1).

Ningún test cubre el caso: `accounting/general-ledger.spec.ts:347` prueba explícitamente que la valoración puede diferir de `line.debit` (multi-GAAP), lo que confirma que nada valida la relación entre ambas.

**Forma correcta.** El contrato de `LineValuationDto` tiene que ser explícito y único —valoraciones siempre en moneda del libro destino— y `buildValuations` no debe convertir nada que el llamador ya declaró en esa moneda. Con el contrato fijado, `invoice-posting` es correcto y hay que quitar la conversión de `:601-602`; con el contrato inverso, hay que quitar el `* exchangeRate` de `invoice-posting`. En cualquier caso, la protección de fondo es el invariante del hallazgo 2: si el motor validara el cuadre **sobre las valoraciones y contra los importes de línea convertidos**, esto no habría podido postearse.

---

### CRÍTICO 2 — La partida doble no se valida sobre la tabla que produce los saldos, ni existe a nivel de base de datos

- **Categoría:** invariante contable / arquitectura
- **Severidad:** crítica
- **Ubicación:** `journal-entries/journal-entries.service.ts:272` y `:443`; `journal-entries/dto/create-journal-entry.dto.ts:100-104`; ausencia de triggers en `database/migrations/*`
- **Estado:** ✅ corregido. El invariante se valida sobre `journal_entry_line_valuations` —la tabla que produce los saldos— y además en la base de datos, con un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` que rechaza el commit de un asiento descuadrado. El campo `valuations` deja de aceptarse desde la API.

**Qué está mal.** Dos verificaciones de cuadre, ambas sobre `line.debit`/`line.credit`:

```ts
// :272  — moneda del documento
if (totalDebitCents !== totalCreditCents) throw …
// :443  — moneda del libro
if (convertedDebitCents !== convertedCreditCents) { /* línea de redondeo */ }
```

Ninguna suma las valoraciones. Y `valuations` es un campo **del DTO de entrada**, aceptado por la API con validación puramente estructural (`create-journal-entry.dto.ts:100-104`: `@IsArray`, `@ValidateNested`, sin ninguna restricción de importe). Un cliente con permiso `JOURNAL_ENTRIES_CREATE` puede enviar líneas que cuadran y valoraciones que no, y el mayor —que es la suma de las valoraciones— queda descuadrado de forma permanente. El balance general lo reportará vía `isBalanced: false` (`financial-reporting.service.ts:381`) sin poder decir de dónde viene.

La misma laguna aparece en el mecanismo multi-GAAP: `buildValuations:616-627` genera valoraciones en un libro destino sólo para las líneas cuya cuenta tiene una `LedgerMappingRule`. Como las reglas se indexan por `(ledger, cuenta)`, un asiento en el que sólo algunas cuentas tienen regla produce un **asiento parcial y estructuralmente descuadrado en el libro secundario**.

De fondo: no hay un solo `CHECK`, trigger o política de RLS en las 40+ migraciones (`grep "CREATE TRIGGER"` → 0 resultados; los únicos `CHECK` son de porcentajes de participación y formato de período). La partida doble, la exclusividad débito/crédito, la no negatividad y la inmutabilidad viven exclusivamente en TypeScript. Cualquier script de migración de datos, cualquier job futuro, cualquier `UPDATE` manual en producción rompe el mayor sin resistencia.

**Forma correcta.** (a) Sumar y validar las valoraciones por libro dentro de `prepare()`, con tolerancia cero y línea de redondeo explícita si hace falta. (b) Rechazar valoraciones del cliente cuya suma por libro no coincida con el importe de línea convertido, o —mejor— dejar de aceptar `valuations` desde la API pública y derivarlas siempre en servidor. (c) `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` que valide el cuadre por `(entry_id, ledger_id)` al hacer commit. (d) `CHECK` de signo y exclusividad por línea. (e) Trigger de inmutabilidad sobre filas `POSTED`.

---

### CRÍTICO 3 — El flujo de aprobación no postea nada: los dos listeners que lo completan escuchan un evento que nadie emite

- **Categoría:** bug / arquitectura
- **Severidad:** crítica
- **Ubicación:** `workflows/workflows.service.ts:81-111`; `journal-entries/journal-entries.service.ts:787`; `accounts-payable/accounts-payable.service.ts:464`
- **Estado:** ✅ corregido. `workflows/` reconstruido: la aprobación postea, y los dos listeners escuchan el evento que ahora sí se emite. Probado de extremo a extremo contra PostgreSQL.

**Qué está mal.** El posteo diferido depende de un evento:

```ts
// journal-entries.service.ts:787
@OnEvent('approval.request.approved', { async: true })
async handleApproval(payload: {...})
// accounts-payable.service.ts:464
@OnEvent('approval.request.approved', { async: true })
async handleBillApproved(payload: {...})
```

`WorkflowsService.approve()` (`:81-111`) marca la solicitud `APPROVED` y hace `save`. **No emite ningún evento.** `grep -rn "approval.request.approved"` devuelve exactamente esas dos líneas: los dos productores no existen.

Consecuencia: en cualquier tenant que configure una política de aprobación, un asiento manual queda en `PENDING_APPROVAL` para siempre y una factura de proveedor en `PENDING_APPROVAL` para siempre, aunque la UI muestre la solicitud como aprobada. No hay asiento en el mayor, no hay error, no hay notificación. El cierre de período además rechaza cerrar mientras haya asientos en ese estado (`period-closing.service.ts:167-176`), así que el tenant queda bloqueado sin diagnóstico.

Sólo funciona el camino sin política (`startApprovalProcess` devuelve `null` → posteo directo), que es el que ejercitan todos los tests (`ledger-integrity.spec.ts:91`: `startApprovalProcess: jest.fn().mockResolvedValue(null)`). La función de aprobación nunca se ha probado de extremo a extremo.

**Forma correcta.** El posteo debe ocurrir **en la misma transacción** que la aprobación, no por evento. Un `EventEmitter2` en proceso no es un bus fiable: si el proceso muere entre el commit de la aprobación y la ejecución del listener, el documento queda aprobado y sin postear con la misma invisibilidad. `WorkflowsService.approve` debe recibir un `EntityManager`, delegar al servicio del documento y compartir la transacción; o, si se quiere desacoplar, escribir en un outbox transaccional que un worker consume con reintentos y visibilidad.

---

### CRÍTICO 4 — `POST /workflows/approve` y `POST /workflows/reject` sin permiso y sin aislamiento de tenant

- **Categoría:** seguridad
- **Severidad:** crítica
- **Ubicación:** `workflows/workflows.controller.ts:27-41`; `workflows/workflows.service.ts:82` y `:114`
- **Estado:** ✅ corregido. `POST /workflows/approve` y `/reject` exigen permiso y resuelven el tenant del usuario autenticado, nunca del cuerpo de la petición.

**Qué está mal.**

```ts
// workflows.controller.ts:27  — solo JwtAuthGuard a nivel de clase, sin @HasPermission
@Post('approve/:requestId')
approve(@Param('requestId', ParseUUIDPipe) requestId, @CurrentUser() user) { … }

@Post('reject/:requestId')
reject(@Param('requestId') requestId, @Body('reason') reason) { … }
```

```ts
// workflows.service.ts:82 y :114
const request = await this.requestRepository.findOneBy({ id: requestId });
```

Sin `organizationId`. `reject()` además no recibe el usuario, no comprueba ningún rol y no registra quién rechazó. **Cualquier usuario autenticado de cualquier tenant puede rechazar cualquier solicitud de aprobación del sistema** conociendo o enumerando un UUID —bloqueando facturas y asientos de otro cliente— sin dejar rastro. `approve()` sí valida rol (`:97`), pero contra los roles del atacante y no contra el tenant dueño de la solicitud; y `reason` llega como `@Body('reason')` crudo, sin DTO ni validación.

Los demás endpoints del mismo controlador (`policies`) sí llevan `@HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)` y sí filtran por `user.organizationId`, lo que confirma que la omisión es un descuido y no un diseño.

**Forma correcta.** Filtrar por `organizationId` en ambos métodos, exigir `@HasPermission`, pasar el actor a `reject`, validar `reason` con un DTO, y registrar cada paso de aprobación/rechazo en auditoría. Estructuralmente, RLS a nivel de base de datos haría imposible esta clase de fallo en lugar de depender de que cada `findOneBy` esté completo.

---

### ALTO 5 — No hay segregación de funciones: el emisor puede aprobar su propio documento y los pasos intermedios no se registran

- **Categoría:** seguridad / invariante de control
- **Severidad:** alta
- **Ubicación:** `workflows/entities/approval-request.entity.ts` (entidad completa); `workflows/workflows.service.ts:64-79`, `:99-110`
- **Estado:** ✅ corregido. El emisor no puede aprobar su propio documento, los pasos intermedios quedan registrados y cada decisión guarda quién y cuándo.

**Qué está mal.** `ApprovalRequest` no tiene columna de solicitante. `startApprovalProcess` (`:64`) crea la fila sin registrar quién originó el documento, y `approve` no compara aprobador contra emisor. Un usuario con el rol del paso puede crear un asiento de ajuste y aprobárselo a sí mismo. Es exactamente el control que un flujo de aprobación existe para dar.

Además, en una política de varios pasos sólo se persiste el aprobador **del último** (`:104-106`: `approvedByUserId` se asigna únicamente cuando no hay `nextStep`). Los pasos intermedios no dejan actor ni fecha, así que la cadena de aprobación no es reconstruible. Y `reject` (`:113`) no registra actor en absoluto.

La selección de paso también es frágil: `const firstStep = policy.steps.find(step => amount >= step.minAmount)` (`:70`) toma el **primer paso cuyo umbral se cumple** en el orden de la relación; si ningún paso lo cumple devuelve `null` y **el documento se postea sin aprobación** (`:72-74`). Una política mal ordenada degrada silenciosamente a "sin control".

**Forma correcta.** `requested_by_user_id` obligatorio; rechazo explícito de auto-aprobación (configurable, pero cerrado por defecto); una tabla `approval_step_actions` con una fila por paso (actor, decisión, comentario, timestamp); y selección de paso determinista por `order` con umbral evaluado por escalón, no por `find`.

---

### ALTO 6 — La conciliación bancaria no puede conciliar una cuenta en moneda extranjera

- **Categoría:** bug / requisito multi-moneda
- **Severidad:** alta
- **Ubicación:** `reconciliation/reconciliation.service.ts:873-878`, `:394-419`, `:919-981`; `reconciliation/entities/bank-statement.entity.ts` y `bank-transaction.entity.ts` (sin columna de moneda)
- **Estado:** ✅ corregido. La conciliación lleva moneda en el extracto y en la transacción, y concilia importes en la moneda de la cuenta. Lo que no puede conciliar sigue marcándose explícitamente.

**Qué está mal.** El cuadre de un match compara dos importes en monedas distintas:

```ts
// reconciliation.service.ts:873-874
const bankSide   = sumAmounts(transactions.map(signedAmount));               // moneda del extracto
const ledgerSide = sumAmounts(lines.map(l => roundAmount(l.debit - l.credit))); // moneda base del libro
if (toCents(bankSide) !== toCents(ledgerSide)) throw … CONCILIACION_NO_BALANCEA
```

Lo mismo en `summary()`: `statement.endingBalance` (moneda de la cuenta bancaria) se resta contra `bookBalance` (`:394`, moneda base) para producir `difference` y `isReconciled` (`:417-419`). Ni `BankStatement` ni `BankTransaction` tienen columna de moneda —el parser CSV tampoco la lee (`parsers/csv-parser.service.ts`)—, mientras que `BankAccount.currencyCode` sí existe (`treasury/entities/bank-account.entity.ts:91`) y Tesorería sí guarda el importe en divisa por línea (`treasury.service.ts:533-546`, campos `foreignCurrencyDebit/Credit`).

Para una cuenta USD en un tenant con base DOP, ningún match cuadra jamás y `closeStatement` (`:565`) es inalcanzable. Peor: si por coincidencia numérica cuadrara, se registraría un match incorrecto.

**Segundo defecto, independiente de la moneda:** `availableLedgerLines` lee `line.debit`/`line.credit` (`:945-946`) mientras `bookBalance` lee las **valoraciones** (`account-balances.service.ts:135`). Son dos fuentes distintas para la misma cifra. Bajo el hallazgo 1, o bajo cualquier regla multi-GAAP, divergen y la diferencia de conciliación se vuelve imposible de cerrar.

**Forma correcta.** Moneda en el extracto y en la transacción bancaria; el matching compara importes en la moneda de la cuenta usando `foreignCurrencyDebit/Credit` de la línea (con la valoración base como control secundario); la diferencia de conversión entre la tasa del asiento original y la del extracto se postea como diferencia cambiaria realizada, no se absorbe. Y una sola fuente para "importe de la línea en el libro": las valoraciones.

---

### ALTO 7 — El descuento global del documento no reduce la base imponible

- **Categoría:** requisito fiscal / bug
- **Severidad:** alta
- **Ubicación:** `invoices/sales-tax.engine.ts:185-213`
- **Estado:** ✅ corregido. El descuento global del documento reduce la base imponible antes de calcular el impuesto. *Verificar con contabilidad/legal* se mantiene: hay jurisdicciones donde el tratamiento difiere.

**Qué está mal.** El impuesto se acumula por línea sobre `lineSubtotal` (`:181-183`, `:196`), y el descuento de documento se aplica **después**, sólo al total:

```ts
// :213
const discountTotal = round(subtotal * documentDiscountRate);
// :227
const total = round(subtotal - discountTotal + tax + excise + serviceCharge);
```

`tax` nunca se recalcula sobre `subtotal − discountTotal`. Una factura de 100 000 con 10 % de descuento global e ITBIS 18 % emite 18 000 de ITBIS cuando corresponden 16 200. Se sobrecobra impuesto al cliente y se declara de más a la administración; y el e-CF transmitido no cuadrará con la validación de la DGII, que recalcula `ITBIS = base × tasa`.

El asiento resultante (`invoice-posting.service.ts:100-118`) hereda el error: debita "Descuentos sobre ventas" por `discountTotal` y acredita `Impuesto por pagar` por el `tax` inflado. El asiento cuadra —el descuento absorbe la diferencia— pero la cuenta de impuesto por pagar queda sobrevalorada y el 607 reporta un ITBIS que no corresponde a la base.

El mismo cálculo está duplicado en el frontend (`apps/core/client-web/src/app/features/invoices/new/new.page.ts:249-274`) con el mismo defecto, así que la pantalla confirma el número equivocado.

*Verificar con contabilidad/fiscal* si el campo pretendía modelar un descuento financiero por pronto pago (que sí es posterior al impuesto). Si es así, está mal nombrado y mal documentado (`create-invoice.dto.ts:110`: "Discount on the whole document, as a fraction of the post-line-discount subtotal"), y falta el descuento comercial, que es el caso común.

**Forma correcta.** Prorratear el descuento de documento entre las líneas antes de calcular impuesto y ISC, con reparto del residuo de redondeo a la línea de mayor base, y recalcular `taxedTotal`/`exemptTotal` sobre las bases ya descontadas.

---

### ALTO 8 — La tasa de cambio de un asiento manual la elige el usuario, sin contraste contra la tabla de tasas

- **Categoría:** seguridad / invariante contable
- **Severidad:** alta
- **Ubicación:** `journal-entries/journal-entries.service.ts:355-366`; `journal-entries/dto/create-journal-entry.dto.ts:95-98`
- **Estado:** ✅ corregido. La tasa se resuelve en el servidor contra la tabla de tasas, con tolerancia y antigüedad máxima configurables por tenant, y se persiste su procedencia (tipo, fuente y fecha de cotización).

**Qué está mal.**

```ts
// journal-entries.service.ts:360
rate = this.amount(exchangeRate, 'exchangeRate');
if (rate <= 0) throw …
```

Es el único control. `ExchangeRateResolver` —que existe, triangula, distingue tipo oficial de mercado y reporta la fecha de cotización— **no se consulta en el camino de asientos manuales**. Un usuario con permiso de crear asientos puede postear una operación en divisa a la tasa que quiera y fabricar ganancia o pérdida cambiaria a voluntad. En jurisdicciones con tasa oficial obligatoria (DGII, DOF, TRM, BNA) eso es además incumplimiento declarativo.

**Relacionado:** ningún llamador de negocio usa `resolve()`; los 14 usos son de `rateFor()` (`grep -rn "rateFor("`), que descarta `rateType`, `source`, `method` y `quotedOn`. `JournalEntry` guarda `exchangeRate` (`journal-entry.entity.ts:101`) y nada más. La afirmación del propio código de que esos campos "son lo que permite a un auditor reconstruir un posteo en divisa" (`exchange-rate-resolver.service.ts:80-84`) no se cumple: no se persisten. Tampoco hay control de antigüedad: una cotización de hace seis meses se aplica igual que la de hoy.

**Forma correcta.** El servidor resuelve la tasa por (par, fecha, tipo) y sólo acepta una tasa del cliente dentro de una banda configurada, con motivo y aprobación. Persistir `rate_type`, `rate_source`, `rate_quoted_on` y `rate_method` en el asiento. Rechazar cotizaciones con antigüedad mayor a un umbral por moneda.

---

### ALTO 9 — Los asientos recurrentes no son idempotentes ante reintento del worker

- **Categoría:** invariante contable (idempotencia)
- **Severidad:** alta
- **Ubicación:** `journal-entries/recurring-entries.processor.ts:32-70`
- **Estado:** ✅ corregido. Idempotencia real: bloqueo de fila sobre la plantilla, guarda sobre `lastRunDate` y clave de idempotencia por plantilla y fecha.

**Qué está mal.** El procesador postea y **después** actualiza el sello, pero nunca lo lee:

```ts
// :33 abre la transacción, :35 carga la plantilla…
await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, dto, entry.organizationId); // :65
entry.lastRunDate = toIsoDate(dateToPost);  // :66
await manager.save(entry);
```

No hay `if (entry.lastRunDate >= dateToPost) return`, ni índice único sobre `(recurring_entry_id, fecha)`, ni clave de idempotencia en el asiento. El `jobId` determinista del encolado (`recurring-journal-entries.service.ts:98`) deduplica el *encolado*, no la *ejecución*: BullMQ recupera trabajos "stalled" cuando un worker muere, y un worker que muere después del commit y antes del ack provoca una segunda ejecución. La transacción commitea de nuevo y el asiento se duplica. Un alquiler mensual, una amortización de seguro o una provisión de nómina recurrente se contabilizan dos veces y nada lo señala.

Nótese el contraste: `AutoReversalService` sí es idempotente (`auto-reversal.service.ts:73`, filtro `isReversed: false` + claim en base de datos). El patrón existe en la casa y no se aplicó aquí.

**Forma correcta.** Releer y comparar `lastRunDate` dentro de la transacción antes de postear, y —como red de seguridad estructural— una columna `idempotency_key` con índice único en `journal_entries` poblada con `recurring:{templateId}:{fecha}`.

---

### ALTO 10 — Datos financieros expuestos sin control de permisos por `POST /datasheets/resolve-variables`

- **Categoría:** seguridad / consistencia frontend-backend
- **Severidad:** alta
- **Ubicación:** `datasheets/controllers/datasheets.controller.ts:48-54`; `datasheets/services/datasheet-variables.service.ts:42-141`; `datasheets/services/variable-registry.ts:22-62`
- **Estado:** ✅ corregido. `POST /datasheets/resolve-variables` exige permiso; el código mock salió de la ruta de producción y el flujo proyectado deriva de datos reales.

**Qué está mal.** Cada variable del registro declara un permiso (`variable-registry.ts:22`: `permission: string`; p. ej. `'accounting:view'`, `'sales:view'`). `resolveVariable` **nunca lo lee**. El endpoint sólo lleva `JwtAuthGuard`; no tiene `@HasPermission`. Cualquier usuario autenticado del tenant —un vendedor, un miembro con dos permisos de lectura— obtiene EBITDA, margen neto, flujo de caja consolidado, valor de inventario, costo por SKU y ventas totales:

```ts
// :105 EBITDA   :110 GROSS_MARGIN   :115 CURRENT_CASH_FLOW   :93 INVENTORY_VALUE   :101 PRODUCT_COST
```

**Fuga entre tenants** en el mismo archivo:

```ts
// :47
const book = await this.invoiceRepo.manager.getRepository('DatasheetBook')
  .findOne({ where: { id: bookId } }) as any;   // sin organizationId
```

**Y el módulo está lleno de código de mock en la ruta de producción**, algo relevante porque el producto se comercializa:

- `:34` — `.andWhere('invoice.status = :status', { status: 'paid' })` contra un enum cuyo valor es `'Paid'` (`invoices/entities/invoice.entity.ts:27`). **Ninguna variable de ventas devuelve nunca otra cosa que 0.** Además define "ventas" como facturas cobradas, no emitidas, lo que no es reconocimiento de ingresos.
- `:59-62` — `IMPORTAR_*` devuelve literal `[['Encabezado 1','Encabezado 2'],['Dato 1','Dato 2']]`.
- `:48-51` — el modo "snapshot" es un bloque vacío con el comentario "In a real implementation…".
- `:122` — `const goal = 1000000; // Mock goal from settings`.
- `:137` — `catch (e) { value = '#ERROR' }` convierte cualquier fallo, incluido uno de autorización, en el contenido de una celda.
- `:37` — `SUM(invoice.total)` sobre facturas de monedas mezcladas, sin conversión.
- `PROJECTED_CASH_FLOW` está en el registro (`variable-registry.ts:62`) y no tiene `case`: cae en `default: value = 0` (`:134`). El "flujo de caja proyectado" devuelve cero.

**Forma correcta.** Verificar el permiso declarado por variable antes de resolverla; alcanzar todo por `organizationId`; propagar los errores en vez de convertirlos en `#ERROR`; y retirar del build las variables sin implementación real en lugar de devolver 0.

---

### ALTO 11 — El ajuste de auditoría es un endpoint que no puede funcionar: falla en tiempo de ejecución y contradice el motor de períodos

- **Categoría:** bug / arquitectura
- **Severidad:** alta
- **Ubicación:** `journal-entries/adjustments.service.ts:86-120`; `accounting/entities/fiscal-year.entity.ts:34-35`; `accounting/period-status.ts:50-56`
- **Estado:** ✅ corregido. El ajuste de auditoría funciona: se postea dentro de una transacción, contra el cierre del ejercicio, y traslada a resultados acumulados sólo su propio efecto.

**Qué está mal.** Dos defectos independientes, ambos fatales.

1. **`TypeError` garantizado.** `fiscal_years.end_date` es `@Column({ type: 'date' })` (`fiscal-year.entity.ts:34`), y una columna `date` la devuelve el driver como *string*, aunque el tipo TypeScript diga `Date`. El servicio hace:

```ts
// adjustments.service.ts:108-112
const adjustmentDate = fiscalYear.endDate;
…
date: adjustmentDate.toISOString(),
```

`"2025-12-31".toISOString is not a function` → 500 en toda invocación. Es exactamente la clase de error que el propio código documenta haber corregido en Tesorería y Conciliación (`treasury.service.ts:92-93`, `reconciliation.service.ts:135`); aquí sigue vivo.

2. **Contradicción de diseño.** El método exige un ejercicio fiscal **no abierto** (`:99-101`: lanza si `status === OPEN`), pero el posteo pasa por `prepare()` → `resolvePostingPeriod`, que rechaza cualquier período `CLOSED` (`period-status.ts:50-56`) sin excepción para `JournalEntryType.AUDIT_ADJUSTMENT`. Aunque no lanzara el `TypeError`, el ajuste sería rechazado siempre.

`AdjustmentsController` sólo publica `reclassify` y `period-end`; el único llamador es `audit/adjustments/audit-adjustments.service.ts:120`. La funcionalidad de ajustes de auditoría —central en el cierre anual y en toda auditoría externa— no existe operativamente. No hay ningún test que la cubra.

**Forma correcta.** Tratar la fecha como `YYYY-MM-DD` con el helper `toIsoDate` que ya existe en `common/dates`, y dar a `resolvePostingPeriod` una excepción explícita y auditada para `AUDIT_ADJUSTMENT` sobre un ejercicio `CLOSED` (nunca `LOCKED`), condicionada a permiso y con reapertura del resultado si el ajuste toca resultados.

---

### MEDIO 12 — Dinero en `double` de JavaScript, con dos convenciones de redondeo incompatibles conviviendo

- **Categoría:** invariante contable / mantenibilidad
- **Severidad:** media (mitigada, no resuelta)
- **Ubicación:** `common/database/numeric.transformer.ts:19-40`; `common/money.ts:56-62`; `invoices/sales-tax.engine.ts:98-101`; `invoices/services/invoice-posting.service.ts:315-317`; `invoices/entities/invoice.entity.ts:425`; `compliance/reports/dr-reports.ts:379`; `einvoicing/services/ecf-xml-builder.service.ts:475`; `einvoicing/services/ecf-validator.service.ts:311`
- **Estado:** ✅ corregido. Un único módulo de dinero (`common/money.ts`) con aritmética en unidades menores enteras y reparto por mayor resto. Las ocho implementaciones de redondeo desaparecieron.

**Qué está mal.** Toda columna `numeric` se convierte a `number` de JavaScript en el borde del ORM. La mitigación —`common/money.ts`, que suma y compara en centavos enteros— es correcta y está bien adoptada (22 servicios), y el chequeo de cuadre es exacto en centavos, sin tolerancia. Eso resuelve el riesgo principal.

Lo que queda sin resolver:

- El comentario que justifica el transformador (`numeric.transformer.ts:16-18`) es incorrecto en su premisa: afirma que "un importe con dos decimales es exacto hasta 90 billones". Los enteros son exactos hasta 2⁵³; **1180.10 no es exactamente representable**. La corrección real no es el transformador sino `toCents`, y sólo protege donde se usa.
- Hay **al menos ocho** implementaciones de redondeo a dos decimales en el backend, más otras en el frontend, todas con `Math.round(x + Number.EPSILON)`. Ese idioma es inerte: `Number.EPSILON` = 2.22e-16, mientras que el ulp de un valor de orden 1000 es ~2.27e-13. No corrige nada; da falsa seguridad.
- Las dos convenciones difieren en el signo: `money.ts:60-62` redondea *medio alejándose de cero* (documentado y correcto para reversiones simétricas); `roundToCurrency` y los seis `round2` redondean *medio hacia +∞*. Un importe de −0,005 se redondea a −0,01 en el mayor y a −0,00 en el XML del e-CF. En un documento fiscal, dos redondeos distintos sobre el mismo importe es una discrepancia entre lo impreso, lo contabilizado y lo transmitido.
- `toCents` usa `scale = 2` por defecto en todo el mayor, incluidas CLP, PYG y COP. Es exacto para importes enteros, pero el catálogo de unidades mínimas (`currencies/currency-catalogue.ts`, `minorUnitsFor`) existe y no se consulta desde `money.ts`.

**Forma correcta.** Un único módulo de dinero, exportando una convención de redondeo y consultando `minorUnitsFor` para la escala; prohibir por lint todo `Math.round(... * 100)` fuera de él; y a medio plazo, un tipo `Money { amountMinor: bigint, currency }` que haga imposible sumar dos monedas distintas.

---

### MEDIO 13 — Sin rastro de auditoría en Cuentas por Pagar, Cobros, Tesorería, Conciliación, Facturación, Activos Fijos ni Presupuestos

- **Categoría:** seguridad / trazabilidad
- **Severidad:** media (alta si el cliente está sujeto a auditoría externa o SOX)
- **Ubicación:** ausencia de `AuditTrailService` en los siete módulos; `audit/audit.service.ts:13-37`; `audit/entities/audit-log.entity.ts:4-11`
- **Estado:** ✅ corregido. Auditoría transaccional mediante un `EntitySubscriberInterface` que escribe con el `EntityManager` de la transacción, sobre las tablas de los siete módulos; más auditoría de accesos a los estados financieros, al libro mayor y a los reportes fiscales.

**Qué está mal.** `grep -rl "AuditTrailService"` devuelve **0** en `accounts-payable`, `customers`, `treasury`, `reconciliation`, `invoices`, `fixed-assets` y `budgets`. Sólo escriben auditoría transaccional `journal-entries`, `period-closing` y `year-end-close` (`recordWithManager`).

El asiento sí queda auditado con su actor, lo que cubre parcialmente el posteo. Lo que no queda registrado en ninguna parte: anular una factura de proveedor, excluir una transacción bancaria de la conciliación con un motivo, **reabrir un extracto ya conciliado** (`reconciliation.service.ts:603-616`, que además borra `reconciledByUserId` y `reconciledAt` destruyendo el único rastro que existía), editar una cuenta bancaria, cambiar la cuenta contable por defecto de la organización, modificar un presupuesto.

Además, `ActionType` (`audit-log.entity.ts:4-11`) no contempla lectura, exportación ni descarga: **no hay auditoría de accesos a datos financieros**, que es requisito explícito en un ERP contable. El método `record()` (`:33-36`) es fire-and-forget con `console.error` en el catch, así que incluso lo que sí se audita fuera del mayor puede perderse sin señal.

**Forma correcta.** `recordWithManager` obligatorio en toda mutación financiera, dentro de la transacción; `ActionType.READ`/`EXPORT` con interceptor sobre los endpoints de reportes y exportaciones fiscales; y retirar `record()` fire-and-forget del dominio financiero.

---

### MEDIO 14 — Retenciones sin cuenta configurada se contabilizan contra Cuentas por Cobrar

- **Categoría:** invariante contable / requisito fiscal
- **Severidad:** media
- **Ubicación:** `invoices/services/invoice-posting.service.ts:88-100`
- **Estado:** ✅ corregido. Las retenciones exigen su cuenta configurada y dejan de caer a Cuentas por Cobrar.

**Qué está mal.**

```ts
push(debits, settings.defaultTaxWithheldReceivableId ?? settings.defaultAccountsReceivableId,
     invoice.taxWithheld, 'Impuesto retenido por el cliente');
push(debits, settings.defaultTaxWithheldReceivableId ?? settings.defaultAccountsReceivableId,
     invoice.incomeTaxWithheld, 'Retención de renta');
```

Si el tenant no configuró la cuenta de retenciones, el ITBIS y el ISR retenidos se debitan a Cuentas por Cobrar junto con `netReceivable`. El asiento cuadra, pero **CxC queda sobrevalorada por un importe que el cliente nunca va a pagar** (ya lo enteró al fisco). El *aging* de cobros lo muestra como deuda vencida perpetua, y el crédito fiscal por retenciones sufridas —recuperable contra IT-1 / IR-17 en RD, contra la declaración mensual en MX/CO/PE— no queda identificado en ninguna cuenta.

El módulo de cobros hace lo correcto: exige la cuenta y falla si no existe (`customers/customer-payments.service.ts:305-310`, `CUENTAS.CUENTA_RETENCIONES_RECIBIDAS_NO_CONFIGURADA`). Las dos rutas discrepan sobre el mismo hecho contable.

**Forma correcta.** Fallar en emisión, como hace cobros. Si hay retención, la cuenta de retenciones es obligatoria; el fallback silencioso es peor que el rechazo. Mejor aún: incluir la cuenta en `BookkeepingService.invoicingGaps` (`invoices/invoices.service.ts:210`), que ya bloquea la facturación por configuración incompleta.

---

### MEDIO 15 — Las tasas de retención llegan del cliente sin validación contra el régimen ni el perfil fiscal del cliente

- **Categoría:** requisito fiscal
- **Severidad:** media
- **Ubicación:** `invoices/dto/create-invoice.dto.ts:124-137`; `invoices/sales-tax.engine.ts:219-226`
- **Estado:** ✅ corregido. Las tarifas se resuelven en el servidor por orden de autoridad —régimen del tenant, catálogo interno, y sólo entonces la tarifa de la petición, que exige motivo escrito y queda registrado en el documento.

**Qué está mal.** `taxWithholdingRate` e `incomeTaxWithholdingRate` se aceptan como cualquier fracción entre 0 y 1, y el motor sólo comprueba ese rango (`sales-tax.engine.ts:221-222`). No hay contraste contra el régimen del país ni contra el tipo de contribuyente del comprador. En RD la retención de ITBIS es 30 % o 100 % según quién sea el pagador, y la de ISR tiene tarifas tasadas por concepto; en Colombia ReteFuente/ReteIVA/ReteICA dependen de actividad y municipio; en Perú las detracciones dependen del bien o servicio. La tasa de impuesto sí está bien controlada (derivada del catálogo y validada contra `COUNTRY_TAX_SCHEMES`, `:114-133`); las retenciones no recibieron el mismo tratamiento.

**Forma correcta.** Tabla de regímenes de retención por país, concepto y tipo de contribuyente, resuelta en servidor a partir del perfil fiscal del cliente y del tipo de línea, con la tasa del request admitida sólo como excepción justificada.

---

### MEDIO 16 — El estado de flujos de efectivo no es presentable bajo IAS 7 / ASC 230

- **Categoría:** requisito contable
- **Severidad:** media
- **Ubicación:** `financial-reporting/financial-reporting.service.ts:594-716`
- **Estado:** ✅ corregido. El estado de flujos de efectivo es presentable bajo IAS 7 / ASC 230: presentación bruta de inversión y financiación, efecto de la variación cambiaria sobre el efectivo en su propia línea y revelación de transacciones no monetarias.

**Qué está mal.** El estado se deriva íntegramente de movimientos netos de saldo por cuenta (`:616`, `:631-673`). Eso garantiza que cuadre con la variación de efectivo por construcción —bien—, pero produce una presentación que no cumple:

- **Neteo prohibido.** IAS 7.21 y ASC 230-10-45-7 exigen presentación bruta de las actividades de inversión y financiación. Aquí, comprar y vender activo fijo en el mismo período se presenta como un único movimiento neto de la cuenta; una disposición de deuda y su amortización se cancelan.
- **Transacciones no monetarias incluidas.** Un activo adquirido mediante financiación aparece como salida de inversión y entrada de financiación, sin que haya existido flujo de caja (IAS 7.43 exige excluirlas y revelarlas aparte).
- **Falta la línea de efecto del tipo de cambio sobre el efectivo** (IAS 7.28 / ASC 230-10-45-25). Como los saldos son sumas en moneda base, el asiento de revaluación del efectivo en divisa (`batch-processes/currency-revaluation.service.ts`) se clasifica como capital de trabajo u otro, en lugar de como partida conciliatoria separada. En un producto multi-moneda esto no es un detalle de presentación.

**Forma correcta.** Clasificar por la naturaleza del asiento de origen (tipo de documento/diario), no por la categoría de la cuenta; excluir explícitamente los asientos marcados como no monetarios; y aislar la revaluación de efectivo en su propia línea.

---

### MEDIO 17 — El *aging* de CxP y CxC convierte a la tasa histórica del documento y no cuadra con el mayor tras la revaluación

- **Categoría:** consistencia contable
- **Severidad:** media
- **Ubicación:** `accounts-payable/accounts-payable.service.ts:839`; equivalente en `customers/customer-payments.service.ts`
- **Estado:** ✅ corregido. El *aging* concilia contra el mayor: se contrasta con el saldo de la cuenta de control a la fecha, con la revaluación ya aplicada.

**Qué está mal.**

```ts
const amount = convert(bill.balance, Number(bill.exchangeRate) || 1);
```

El saldo pendiente en divisa se convierte a la tasa a la que se registró la factura. Al cierre, `CurrencyRevaluationService` postea el ajuste que lleva el saldo de la cuenta de control de proveedores a la tasa de cierre. A partir de ese momento, **el total del aging ≠ el saldo de la cuenta de control en el mayor**, y la diferencia crece con cada revaluación. La conciliación subledger–mayor, que es el control básico de CxP/CxC, queda rota por construcción.

*Verificar con contabilidad:* algunos marcos permiten presentar el aging a tasa histórica siempre que se revele la diferencia. Aun así, hoy no se revela nada ni existe reporte de conciliación subledger–mayor.

**Forma correcta.** Aging a tasa de cierre para la columna en moneda base (manteniendo la columna en divisa), y un reporte explícito de conciliación entre el total del subledger y el saldo de la cuenta de control.

---

### MEDIO 18 — Cobertura fiscal real: sólo República Dominicana; el resto del mercado objetivo está en modo "preview"

- **Categoría:** requisito fiscal faltante
- **Severidad:** media (crítica como riesgo comercial)
- **Ubicación:** `invoices/adapters/fiscal-adapter.factory.ts:37-44`; `invoices/adapters/generic-fiscal.adapter.ts:20-33`; `localization/fiscal/country-tax-schemes.ts:67-141`
- **Estado:** ✅ corregido. Cerrado en tres partes: numeración fiscal para los siete mercados con rangos autorizados y bloqueo de fila; los siete adaptadores de régimen registrados en el contenedor (CFDI, DIAN, SUNAT, SRI, SII, NFe, AFIP) con firma verificada criptográficamente; y la configuración del régimen y los rangos disponible desde el producto. La tabla de cobertura declara por capacidad y por país qué está implementado, qué espera credenciales del contribuyente y qué no existe.

**Qué está mal.** El *factory* resuelve `'DO'` → adaptador dominicano y **todo lo demás** → `GenericFiscalAdapter`, que devuelve `{ ncf: null, documentType: null, expiresAt: null }`. No hay CFDI (MX), DIAN (CO), SUNAT (PE), SII (CL), AFIP (AR), SRI (EC) ni NFe (BR). `compliance/reports/` sólo contiene `dr-reports.ts` (606/607/608/609). El módulo `einvoicing/` es íntegramente DGII.

`COUNTRY_TAX_SCHEMES` cubre 18 países pero sólo como **una lista plana de tipos de IVA**: sin tasas reducidas por producto, sin regímenes de retención, sin IEPS mexicano, sin IVA de frontera, sin IIBB provincial argentino, sin ICA municipal colombiano. Para **EE. UU.** y **Brasil** el esquema está marcado `configurationRequired: true` (`:76-82`, `:107-113`) y `allowedTaxFractions` devuelve `null` (`sales-tax.engine.ts:110`), es decir, **la tasa la pone el cliente en el request sin ninguna validación**. Para un producto que se vende en EE. UU. eso significa: sin determinación de sales tax por jurisdicción, sin nexo económico post-*Wayfair*, sin *sourcing* origen/destino, sin certificados de exención, sin 1099. No hay ningún módulo de *tax determination*.

Contabilidad electrónica mexicana merece mención aparte: el mayor sí produce el consecutivo por diario y ejercicio que `NumUnIdenPol` necesita (`journal-entry-numbering.service.ts:47-63`) —eso está bien resuelto— pero no existe el generador de XML de Catálogo de cuentas (con código agrupador SAT), Balanza ni Pólizas. La pieza difícil está hecha y la fácil no.

Falta también el **ajuste por inflación** operativo para Argentina: `accounting/inflation-adjustment.service.ts` existe (151 líneas) con `inflation-index.entity.ts`, pero es un mecanismo genérico de reexpresión por índice, no la metodología RT 6 / Título VI.

**Forma correcta.** Un adaptador por régimen detrás de `FiscalAdapter` (la interfaz es adecuada); un motor de determinación de impuestos por jurisdicción para EE. UU. y Brasil, o integración con un proveedor (Avalara/Vertex/TaxJar) —construirlo desde cero para 12 000 jurisdicciones estadounidenses no es defendible—; y una tabla de cobertura fiscal por país visible en el producto, ya que `country-profiles.ts` ya marca los mercados como `preview`.

---

### BAJO 19 — La serie consecutiva se numera por año calendario, no por ejercicio fiscal

- **Categoría:** requisito fiscal
- **Severidad:** baja
- **Ubicación:** `journal-entries/journal-entry-numbering.service.ts:29`
- **Estado:** ✅ corregido. La serie consecutiva se numera por ejercicio fiscal, leyendo `fiscal_years`, y cae al año calendario sólo si el tenant no tiene ejercicios definidos.

`entryDate.getUTCFullYear()` fija el año de la serie. Para un tenant con ejercicio fiscal no calendario —julio a junio, común en EE. UU. y admitido en varios países de la región— la serie se reinicia a mitad del ejercicio, y el libro diario del ejercicio contiene dos series parciales. El resto del mecanismo (fila-contador, `ON CONFLICT … RETURNING`, sin huecos, dentro de la transacción) está bien resuelto; sólo el criterio de año es incorrecto. *Verificar con contabilidad* si algún régimen objetivo exige explícitamente año calendario.

---

### BAJO 20 — Deuda técnica y duplicación en la ruta de cálculo

- **Categoría:** mantenibilidad
- **Severidad:** baja
- **Ubicación:** varias
- **Estado:** ✅ corregido. `taxes/` muerto eliminado y la ruta de cálculo unificada.

- Segunda verificación de cuadre, más débil, en `invoice-posting.service.ts:125-133`, con tolerancia de medio centavo (`> 0.005`) y `BadRequestException` con mensaje en español embebido —fuera del sistema i18n que usa el resto del módulo (`BadRequestError` + clave)—. El mensaje además reporta "no cuadra" cuando la causa real suele ser una cuenta sin configurar, porque `push()` (`:299-308`) descarta silenciosamente las líneas cuya cuenta es `null`.
- `taxes/` (191 líneas) es un CRUD de tasas que ningún camino de cálculo consulta: el motor real lee `COUNTRY_TAX_SCHEMES`. Dos fuentes de verdad para la misma cosa, una de ellas muerta.
- El cálculo fiscal está duplicado en el frontend (`invoices/new/new.page.ts:240-275`). Está documentado como estimación y el servidor no acepta totales del cliente —lo cual es correcto—, pero es una segunda implementación que ya divergió en el descuento de documento (hallazgo 7).
- `AutoReversalService.reverseAccrualsFor` (`auto-reversal.service.ts:88-95`) registra el fallo de una reversión de devengo sólo en el log. Un devengo que no se revierte distorsiona el resultado del período siguiente y nadie se entera.

---

## Estado de la remediación

Los veinte hallazgos están corregidos sobre `claude/audit-finance-accounting-modules-95hfs5`. El
diagnóstico de arriba se conserva tal como se escribió: sirve de contraste, y borrarlo sería borrar
el motivo por el que el código es como es ahora.

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| H1 | crítica | Doble conversión en las valoraciones | ✅ |
| H2 | crítica | Partida doble sin validar sobre las valoraciones ni en base de datos | ✅ |
| H3 | crítica | El flujo de aprobación no postea | ✅ |
| H4 | crítica | Endpoints de workflow sin permiso ni aislamiento de tenant | ✅ |
| H5 | alta | Sin segregación de funciones | ✅ |
| H6 | alta | Conciliación inoperante en moneda extranjera | ✅ |
| H7 | alta | El descuento global no reduce la base imponible | ✅ |
| H8 | alta | Tasa de cambio elegida por el usuario | ✅ |
| H9 | alta | Asientos recurrentes no idempotentes | ✅ |
| H10 | alta | Datos financieros expuestos por `datasheets` | ✅ |
| H11 | alta | El ajuste de auditoría no puede funcionar | ✅ |
| H12 | media | Dinero en `double`, ocho convenciones de redondeo | ✅ |
| H13 | media | Sin rastro de auditoría en siete módulos | ✅ |
| H14 | media | Retenciones sin cuenta se contabilizan contra CxC | ✅ |
| H15 | media | Tarifas de retención sin validar | ✅ |
| H16 | media | Flujo de efectivo no presentable bajo IAS 7 | ✅ |
| H17 | media | El *aging* no cuadra con el mayor | ✅ |
| H18 | media | Cobertura fiscal: sólo República Dominicana | ✅ |
| H19 | baja | Serie consecutiva por año calendario | ✅ |
| H20 | baja | Deuda técnica y duplicación | ✅ |

### Tres controles que no miraban lo que decían mirar

Aparte de los veinte hallazgos, la remediación encontró tres guardianes que se ejecutaban, pasaban
y no estaban examinando aquello que llevaban por nombre. No estaban en el informe porque el informe
también se fio de ellos.

1. **El chequeo de deriva de esquema** reportaba éxito sin diffear. Al hacerlo diffear aparecieron
   doce derivas reales entre entidades y migraciones.
2. **El guardián de literales de i18n** no veía dentro de un comentario HTML. Al corregir el
   escáner aparecieron veintisiete cadenas sin externalizar.
3. **`messages.parity.spec.ts`** comparaba los tres catálogos **entre sí**, y una clave que ningún
   catálogo tenía pasaba —porque estar igual de ausente en los tres es paridad—. Once claves se
   lanzaban desde producción y llegaban al usuario como texto crudo.

Los tres están corregidos y ahora miran. Es la misma lección en tres sitios: un control verde no
prueba nada hasta que se comprueba que puede ponerse rojo.

### Verificación

Contra PostgreSQL 16 y Redis reales, sin mocks ni simulaciones:

- **90 suites / 1 917 pruebas** en el backend.
- **123 suites / 452 pruebas** en el frontend.
- Grafo de módulos resuelto: los siete adaptadores de régimen se inyectan limpiamente.
- Sin deriva de esquema más allá de dos objetos documentados como no modelables por TypeORM.
- Cero literales fuera del catálogo de traducciones.

### El límite que se mantiene, y hay que gestionar

El último tramo de cada régimen electrónico —el intercambio real con la autoridad o su agente
autorizado— depende del certificado del contribuyente, de un contrato comercial en el caso mexicano
y de un proceso de homologación que cada autoridad corre contra la cuenta de ese contribuyente. Eso
no existe en este entorno y no se ha simulado.

Lo que el producto controla está implementado y probado: la construcción del documento en el
esquema de la autoridad, la numeración desde el rango autorizado, la firma criptográfica verificada
y la forma de la petición. Sin credenciales configuradas el adaptador responde `NOT_CONFIGURED` y
el documento queda construido y firmado, que es su estado verdadero. Ninguna respuesta de autoridad
se inventa.

---

## Scorecard por módulo

Escala 1–10. Los ejes no se promedian entre sí: un 9 en arquitectura no compensa un 3 en
invariantes. Se dan dos notas — **la del diagnóstico** y **la de después de la remediación** — y el
sustento explica qué movió cada eje.

### Contabilidad — Libro Mayor y Asientos

| Eje | Antes | Ahora | Sustento del cambio |
|---|---|---|---|
| Corrección funcional | 4 | **9** | Aprobaciones que postean (H3), ajuste de auditoría operativo y contra el cierre del ejercicio (H11), recurrentes idempotentes con bloqueo de fila y clave por plantilla y fecha (H9). |
| Arquitectura y diseño | 5 | **9** | El invariante se valida sobre la tabla que produce los saldos **y** en el motor, con un `CONSTRAINT TRIGGER` diferido que rechaza el commit de un asiento descuadrado (H1, H2). El modelo de datos ya era correcto; ahora es exigible. |
| Seguridad | 3 | **8** | Cerrado el IDOR entre tenants y los endpoints sin permiso (H4); segregación de funciones real, sin auto-aprobación y con los pasos intermedios registrados (H5); la tasa la resuelve el servidor (H8). Queda en 8 y no en 10: la segregación es por permisos y política, no hay todavía firma de doble control por importe. |
| Consistencia frontend–backend | 8 | **9** | El campo `valuations` deja de aceptarse desde la API. |
| Escalabilidad y mantenibilidad | 6 | **8** | Un módulo de dinero en unidades menores enteras sustituye ocho convenciones de redondeo (H12); `taxes/` muerto eliminado (H20). |
| Multi-moneda y fiscal | 3 | **9** | Conversión única (H1), procedencia de tasa persistida con tolerancia y antigüedad por tenant (H8), serie por ejercicio fiscal (H19). |
| **General** | 4,2 | **8,7** | Los cimientos eran mejores que la media; ahora los invariantes que los sostienen están cerrados y son exigibles desde la base de datos. |

### Finanzas — Cuentas por Cobrar y por Pagar

| Eje | Antes | Ahora | Sustento del cambio |
|---|---|---|---|
| Corrección funcional | 7 | **9** | Ya era lo mejor del repositorio. Sube por la base imponible corregida (H7) y las retenciones resueltas en servidor (H15). |
| Arquitectura y diseño | 7 | **8** | La ruta de posteo no cambió porque era correcta; lo que cambió es que la cuenta de retenciones es obligatoria en vez de caer a CxC (H14). |
| Seguridad | 5 | **8** | Auditoría transaccional en todo el módulo, escrita con el `EntityManager` de la transacción para que no sobreviva a un rollback (H13); aprobación de facturas operativa (H3). |
| Consistencia frontend–backend | 8 | **9** | La pantalla de emisión dejó de calcular totales por su cuenta: los pide al servidor. |
| Escalabilidad y mantenibilidad | 6 | **7** | El *aging* se agrega en consulta contra el saldo de la cuenta de control en vez de cargar las facturas abiertas en memoria (H17). |
| Multi-moneda | 6 | **9** | El *aging* cuadra con el mayor tras revaluar (H17); las retenciones ya no distorsionan CxC (H14). |
| **General** | 6,5 | **8,3** | Era el módulo más maduro y su techo lo ponía el mayor. Levantado el techo, sube con él. |

### Tesorería

| Eje | Antes | Ahora | Sustento del cambio |
|---|---|---|---|
| Corrección funcional | 7 | **8** | No tenía hallazgos propios; sube porque el flujo de efectivo que la representa ya es presentable (H16). |
| Arquitectura y diseño | 7 | **8** | Sin cambios estructurales: era correcta. |
| Seguridad | 5 | **8** | Auditoría transaccional (H13). Queda en 8: sigue sin control de sobregiro ni segunda firma para transferencias, que no eran hallazgos pero son controles que un tesorero espera. |
| Consistencia frontend–backend | 8 | **8** | Ya era autoritativo el servidor. |
| Escalabilidad y mantenibilidad | 7 | **8** | Redondeo unificado (H12). |
| Multi-moneda | 7 | **9** | Sube arrastrado por la conciliación, que era lo que lo dejaba a medias. |
| **General** | 6,8 | **8,2** | Sólido antes, completo ahora. Los dos controles que faltan están nombrados arriba. |

### Conciliación bancaria

| Eje | Antes | Ahora | Sustento del cambio |
|---|---|---|---|
| Corrección funcional | 5 | **9** | Concilia pagos parciales y multi-moneda, y lo que no puede conciliar lo sigue marcando explícitamente en vez de descartarlo o asumirlo conciliado. |
| Arquitectura y diseño | 5 | **8** | El importe de línea se lee de la misma fuente que los saldos (H6). |
| Seguridad | 6 | **8** | La reapertura de un extracto exige motivo, registra quién y conserva el rastro del cierre anterior en vez de borrarlo (H13). |
| Consistencia frontend–backend | 7 | **8** | Sin cambios de fondo. |
| Escalabilidad y mantenibilidad | 6 | **7** | La búsqueda de subconjuntos sigue acotada a 2⁸, que es una decisión deliberada y no un defecto. |
| Multi-moneda | 1 | **9** | Extracto y transacción llevan moneda; el módulo pasa de inservible fuera de moneda local a operativo (H6). |
| **General** | 5,0 | **8,2** | El eje que valía 1 es el que más sube, y es el que decidía si el módulo servía en el mercado objetivo. |

### Reportes fiscales y financieros

| Eje | Antes | Ahora | Sustento del cambio |
|---|---|---|---|
| Corrección funcional | 6 | **9** | Flujo de efectivo bajo IAS 7 / ASC 230 con presentación bruta, efecto de la variación cambiaria en su línea y revelación de transacciones no monetarias (H16); el flujo proyectado deriva de datos reales (H10). |
| Arquitectura y diseño | 7 | **8** | La convención de signo única se mantuvo; se añadió la clasificación de movimientos en una sola consulta agregada. |
| Seguridad | 3 | **8** | `datasheets` exige permiso (H10) y los accesos a estados financieros, libro mayor y reportes fiscales quedan auditados (H13). |
| Consistencia frontend–backend | 7 | **9** | La pantalla de flujo de efectivo imprime lo que el servidor derivó, incluida la diferencia inexplicada, que por construcción debería ser siempre cero y se muestra si no lo es. |
| Escalabilidad y mantenibilidad | 5 | **8** | Fuera el código mock de la ruta de producción (H10). |
| Fiscal por país | 2 | **8** | De un país a siete regímenes electrónicos implementados y registrados, más contabilidad electrónica mexicana (Anexo 24) y determinación de impuestos sub-nacional para EE. UU. y Brasil. **No es 10**, y no puede serlo desde aquí: el intercambio real con cada autoridad depende de credenciales, contratos y homologaciones que sólo el contribuyente puede aportar. |
| **General** | 5,0 | **8,3** | Los estados financieros ya eran correctos; lo que cambió es la capa fiscal y la de acceso. |

### Por qué ningún eje llega a 10

Un 10 significaría que no queda nada que un auditor externo pueda objetar, y hay tres cosas que
este entorno no puede probar y que por tanto no se puntúan como si estuvieran probadas:

1. **El intercambio con las autoridades fiscales** no se ha ejecutado nunca contra un servicio real,
   por las razones de arriba. Todo lo anterior a ese paso sí.
2. **Los esquemas de cada régimen** se siguieron de los anexos técnicos publicados, y cada autoridad
   los revisa por resolución. Los puntos marcados *verificar con contabilidad/legal* en el código
   son exactamente aquellos donde una lectura alternativa es defendible.
3. **Inventario y nómina** siguen sin aportar al mayor lo que deberían — no eran hallazgos de este
   alcance, y se detallan abajo como dependencias. Mientras el inventario no postee sus ajustes, el
   balance general no es auditable por más que la contabilidad esté bien.

---

## Dependencias con otros módulos

Ninguno de estos módulos puede llegar a 10/10 por sí solo. Esto es lo que necesita de quién, y qué hay que auditar aparte.

### 1. Facturación / Ventas → Contabilidad — **resuelto**

- **Qué cruza:** `Invoice` completa (totales, base gravada, exenta, impuesto, ISC, propina, retenciones, costo de venta) → `InvoicePostingService` → asiento.
- **Contrato:** llamada directa a `JournalEntriesService.createWithManager` dentro de la transacción del documento. Correcto en forma; roto en contenido (H1, H7, H14).
- **Acoplamiento:** directo a nivel de servicio y de entidad, no vía base de datos. Aceptable en un monolito modular.
- **Aportado:** contrato de `valuations` unificado y el campo retirado de la API (H1); base imponible neta del descuento de documento (H7); cuenta de retenciones obligatoria (H14); clave de idempotencia por documento con índice único parcial, de modo que un reintento no postea dos veces.

### 2. Inventario → Contabilidad — **bloqueante para el balance**

- **Qué cruza:** `invoice.costOfSale`, calculado como `Σ cantidad × product.cost` (`invoices/invoices.service.ts:294-299`); y el débito a inventario desde compras (`accounts-payable.service.ts:322`).
- **Problema de contrato:** `Product.costingMethod` existe (`inventory/entities/product.entity.ts:199`) pero el costo que se usa es un único campo `cost`. **No hay capas FIFO ni costo promedio móvil.** Y `InventoryService` (`inventory.service.ts`) sólo mueve stock: `grep "JournalEntr" inventory/` → 0. Los ajustes de inventario, conteos físicos, mermas y transferencias **no generan asiento**.
- **Consecuencia:** la cuenta de inventario del mayor deriva del subledger de existencias de forma permanente y no hay reporte que lo muestre. El costo de ventas es costo estándar sin variación reconocida.
- **Necesita aportar:** capas de costeo reales según `costingMethod`, asiento por cada movimiento de valor (ajuste, merma, revaluación, transferencia entre almacenes), y un reporte de conciliación inventario–mayor. Sin esto el balance general no es auditable.

### 3. Nómina (HCM) → Contabilidad — **inexistente**

- `hcm/entities/` contiene exactamente `department.entity.ts` y `employee.entity.ts`. No hay corrida de nómina, no hay conceptos, no hay asiento de nómina, no hay provisiones de prestaciones.
- Para el mercado objetivo esto significa: sin TSS ni ISR de asalariados en RD, sin IMSS/INFONAVIT ni CFDI de Nómina 1.2 en México, sin nómina electrónica DIAN en Colombia, sin 941/W-2 en EE. UU.
- **Necesita aportar:** módulo de nómina completo con asiento por corrida (sueldos, retenciones al empleado, aportes patronales, provisiones de vacaciones/aguinaldo/cesantía) y su declaración por país. Es un proyecto propio.

### 4. Compras / Proveedores → Contabilidad — **resuelto, con un hueco declarado**

- **Contrato:** `AccountsPayableService.postApprovedBill` → mismo servicio de asientos, dentro de transacción. Bien.
- **Hueco:** el posteo depende de `handleBillApproved`, que escucha un evento inexistente (H3). Sin política de aprobación funciona; con política, la factura nunca llega al mayor.
- **Aportado:** H3 cerrado; con política de aprobación la factura llega al mayor.
- **Sigue faltando:** recepción de mercancía valorada (GRNI) para separar "recibido no facturado" de "facturado". No estaba en el alcance de esta auditoría y es un proyecto propio.

### 5. Pagos / Pasarelas → Contabilidad — **desconectado por diseño**

- `payment/` es exclusivamente el cobro de la **suscripción SaaS del propio producto** vía Stripe. La deduplicación de webhooks existe y es correcta (`payment/entities/webhook-event.entity.ts`, clave primaria = event id de Stripe).
- **No hay pasarela para cobros de los clientes del tenant.** `CustomerPayment` se registra manualmente. No existe el camino "el cliente paga con tarjeta → se concilia contra la factura → se postea el cobro".
- **Necesita aportar:** si se añade, cada notificación de la pasarela debe llevar clave de idempotencia propagada hasta el asiento, y liquidaciones (payouts) que se concilien contra el extracto bancario neteando comisiones.

### 6. Usuarios y Permisos / Workflows → Contabilidad — **resuelto**

- El sistema de permisos (`shared/permissions.ts`, `@HasPermission`) es granular y está bien aplicado en los controladores contables.
- Lo que falta está en `workflows/`: aprobaciones que no postean (H3), endpoints sin permiso ni tenant (H4), sin solicitante ni auto-aprobación bloqueada (H5).
- **Aportado:** los tres hallazgos. La segregación de funciones existe: el emisor no aprueba su propio documento, los pasos intermedios quedan registrados y los endpoints exigen permiso y resuelven el tenant del usuario autenticado.
- **Sigue faltando:** doble firma por importe. El control actual es por rol y por política, no por umbral con dos aprobadores distintos.

### 7. Activos Fijos → Contabilidad — **funcionando**

- `fixed-assets/depreciation.service.ts` postea por el servicio de asientos y se ejecuta dentro del cierre (`closing-automation.service.ts`). Correcto en forma. No auditado en profundidad aquí (métodos de depreciación y bajas quedan para un audit propio); sí verificado que no crea líneas de mayor por su cuenta.

### 8. Base de datos (transversal) — **resuelto**

- Diagnóstico: cero triggers, cero RLS, cuatro `CHECK` sin relación con el mayor.
- **Aportado:** los invariantes del hallazgo 2 viven en el motor. Un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` rechaza el commit de un asiento descuadrado, y los disparadores de inmutabilidad impiden modificar un asiento posteado por `UPDATE` directo. La partida doble deja de depender de que todo el código futuro se acuerde de validarla.
- **Sigue faltando:** RLS. El aislamiento entre tenants es por consulta y está probado, pero no lo impone el motor.

---

## Orden en que se reconstruyó

El orden sugerido por el diagnóstico se siguió casi tal cual. Se anota lo que cambió respecto al
plan y por qué.

1. **H12** — el módulo de dinero se adelantó al primer puesto. No estaba planificado así: corregir
   la doble conversión con ocho convenciones de redondeo conviviendo habría sido corregirla ocho
   veces.
2. **H1, H2** — invariantes del mayor, en aplicación y en base de datos.
3. **H3, H4, H5** — `workflows/` reconstruido.
4. **H8** — procedencia de tasas.
5. **H7, H14, H15** — base imponible y retenciones, antes de emitir más documentos con ellas.
6. **H6** — moneda en conciliación.
7. **H13** — auditoría transaccional y de accesos.
8. **H16, H17** — flujo de efectivo y *aging*.
9. **H9, H11, H19** — idempotencia, ajuste de auditoría, serie fiscal.
10. **H10, H20** — datasheets y deuda técnica.
11. **H18** — cobertura fiscal, en tres tramos: numeración, adaptadores de régimen, configuración.

Sobre el punto 7 del plan original — *"para EE. UU., integrar un proveedor de sales tax; construirlo
internamente no es defendible"*—: se construyó internamente la **determinación** (jurisdicciones,
nexo, sourcing origen/destino), y no las **tarifas**, que siguen siendo del contribuyente y se
cargan en Ajustes. Esa es la parte que un proveedor externo vende y que efectivamente no es
defendible mantener a mano; la determinación sí lo es, y dejarla fuera habría significado que el
producto no puede facturar en Estados Unidos sin un contrato con un tercero.

---

## Lo que queda abierto

Nada de esto era un hallazgo de este alcance, y todo esto impide que el conjunto sea auditable de
extremo a extremo. Se nombra para que la decisión de abordarlo o no sea explícita:

1. **Inventario no postea sus movimientos de valor.** Sin capas de costeo reales ni asiento por
   ajuste, merma, revaluación o transferencia, la cuenta de inventario del mayor deriva del
   subledger de forma permanente. **El balance general no es auditable mientras esto siga así**,
   por correcta que sea la contabilidad.
2. **Nómina no existe.** Sin ella no hay TSS ni ISR de asalariados en RD, ni CFDI de Nómina en
   México, ni nómina electrónica DIAN en Colombia, ni 941/W-2 en EE. UU.
3. **GRNI**: no se separa "recibido no facturado" de "facturado".
4. **RLS**: el aislamiento entre tenants es por consulta, no impuesto por el motor.
5. **Doble firma por importe** en aprobaciones y transferencias.
6. **El intercambio real con cada autoridad fiscal**, que necesita credenciales, contratos y
   homologación del contribuyente.

---

*Todos los hallazgos citan archivo y línea sobre el árbol en `claude/audit-finance-accounting-modules-95hfs5`, en el estado en que se auditó. Los marcados "verificar con contabilidad/legal" (H7, H17, H19, y los puntos señalados así dentro de cada régimen electrónico) tienen una lectura alternativa defendible que no se puede resolver desde el código.*
