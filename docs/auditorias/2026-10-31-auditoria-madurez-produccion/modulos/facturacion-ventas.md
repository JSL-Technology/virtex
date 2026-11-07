# M08 — Facturación de ventas (`invoices`) — Familia F5

> **HALLAZGOS CRÍTICOS ABIERTOS (resumen):**
> - **INV-01 — Numeración fiscal con HUECOS**: si se emite el mismo borrador varias veces a la vez, cada petición consume un NCF distinto y solo queda el último (probado: 6 peticiones → 5 NCF perdidos).
> - **INV-02 — Fuera de DO la "factura electrónica" no existe**: MX/CO/PE/EC/CL/BR/AR emiten con número/tipo fiscal pero nunca se construye, firma ni transmite el documento (ver M09 EINV-01). Probado en CO.
> - No hay hallazgo crítico de seguridad entre tenants en este módulo (IDOR probado → 404 en todas las rutas).

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/invoices/` — 30 archivos .ts (7 specs), ~6.356 LOC sin specs; `invoices.service.ts` tiene 1.883 LOC. 14 endpoints (`invoices.controller.ts`): crear, previsualizar, previsualizar emisión, emitir, editar borrador, descartar, listar, contexto, ver, nota de crédito, PDF, enviar por correo, redactar mensaje con IA, imprimir. Entidades/tablas: `invoices` e `invoice_line_item`. Índices únicos `UQ_invoices_org_number` y `UQ_invoices_org_fiscal_number (organization_id, fiscal_number)`.
- **Adaptadores fiscales**: `adapters/fiscal-adapter.factory.ts` (DO → `DominicanRepublicFiscalAdapter`; MX/CO/PE/EC/CL/BR/AR → `regime-numbering.adapter.ts`; resto → `GenericFiscalAdapter`, sin número fiscal).
- **Frontend**: `apps/core/client-web/src/app/features/invoices` (lista, nuevo 877 LOC, detalle 814 LOC, barra de herramientas, diálogo de correo); servicio `core/services/invoices.ts`.
- **Países**: los 19 declarados. Realmente: DO (NCF B y e-CF). MX/CO/PE/EC/CL/BR/AR solo asignan número. US calcula impuesto por jurisdicción (no lo probé emitiendo). Los demás caen en el adaptador genérico, sin número fiscal.
- **Dependencias**: compliance (NCF), einvoicing (rangos, constructores, envío e-CF), accounting/journal-entries, inventory, saas (cuotas), customers, tax-determination.
- **¿Núcleo para vender?** Sí. Sin esto no hay producto.

## 2. Estándar de referencia (Paso 3)
- **Básico**: ciclo borrador → emitida → pagada/anulada; NC y ND vinculadas a la factura; numeración por serie y país sin huecos ni duplicados; impuestos por línea y por jurisdicción; descuentos por línea y por documento; multimoneda con tasa histórica; asiento automático, cuadrado e idempotente; CxC integrada; PDF y correo; emisión idempotente.
- **Avanzado**: facturas recurrentes, anticipos, retenciones, portal del cliente, cobro en línea, plantillas por marca, e-factura nativa por país.
- **Invariantes**: (1) un número fiscal = un documento, sin huecos (en DO la DGII exige reportar los NCF anulados —verificar con contador—); (2) la emisión es atómica: número, asiento, stock y cuota juntos o nada; (3) un documento emitido es inmutable y se corrige con NC; (4) asiento = documento al centavo.
- **Líderes**: Odoo y NetSuite numeran con secuencias bloqueadas en transacción y validan el estado del documento con bloqueo de fila (confianza media). Alegra y Siigo integran DIAN/DGII de forma nativa (confianza alta, documentación pública de producto).
- **Construcción de referencia**: un agregado Invoice con una transición de estado protegida (UPDATE … WHERE status='DRAFT' o FOR UPDATE); un puerto de numeración; un puerto de e-factura invocado de forma asíncrona por un outbox; idempotencia en todas las operaciones que cambian estado.

## 3. Resultado
- **Madurez: 40** (rango 35–48, confianza media-alta) · **Preparación comercial: 35 → NO LISTO**.
- Eje más débil: **3 Multi-país (25)**. Le siguen 2 Corrección (40) y 7 Robustez (40).
- Hallazgos abiertos: **2 críticos**, 5 altos.

## 4. Doce ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 50 (45–58, media) | En DO el flujo es real: NCF, asiento, NC parcial/total, PDF (`GET /:id/pdf` → PDF de 1 página, 84 KB). Fuera de DO la emisión "electrónica" es fachada (INV-02). No hay nota de débito (grep `DEBIT_NOTE`; B03/E33 solo en catálogo) ni facturas recurrentes. | Conectar regímenes, ND, recurrentes |
| 2 | Corrección e integridad | 40 (35–48, alta) | Cálculo y asiento correctos (ver §6 PRUEBAS). Huecos de NCF por concurrencia (INV-01). `POST /invoices` no es idempotente (INV-03). | Transición bloqueada, idempotencia en create |
| 3 | Multi-país | 25 (20–35, media) | DO completo. Rangos CO probados. MX: ni UUID ni CFDI. US con jurisdicción. 11 países en genérico. | E-documento real por país; bloquear la emisión en países no soportados |
| 4 | Arquitectura | 58 (50–65, media) | Adaptadores por país, puerto de contabilidad, transacción única, e-CF post-commit con fila PENDING (outbox ligero). Servicio de 1.883 LOC. | Dividir el servicio; una máquina de estados |
| 5 | Higiene y fronteras | 45 (40–55, media) | `invoices/adapters/regime-numbering.adapter.ts:16-21` importa internos de `einvoicing` (builders, entidades); `invoices` llama a `compliance`, `einvoicing`, `saas`, `inventory`. | Contratos/puertos en lugar de imports internos |
| 6 | Calidad de código | 58 (50–65, media) | Tipado razonable; comentarios extensos y a veces engañosos (la fábrica dice que MX "will be stamped"). | Que los comentarios coincidan con el código real |
| 7 | Robustez | 40 (35–50, alta) | 5 de 12 emisiones concurrentes devolvieron 500 (bug en `usage-metric.repository.ts`, INV-04). La NC devuelve 500 cuando la cuota está agotada. | SAVEPOINT/UPSERT; errores 409 |
| 8 | Seguridad y aislamiento | 70 (62–78, media) | IDOR de qa-a sobre qa-b → 404 en ver, PDF, imprimir, enviar, NC, borrar, preview con cliente ajeno. Permisos por ruta. `send` pide solo `invoices:view` y acepta cualquier destinatario (INV-06). | Permiso propio para enviar; auditoría de envíos |
| 9 | Pruebas | 45 (35–55, media) | 7 specs unitarios (motor de impuestos, retenciones, renderer, numeración). Ninguno prueba concurrencia ni idempotencia de create. Las suites de integración se saltan sin DB_HOST. | Pruebas de concurrencia con BD real en CI |
| 10 | Operabilidad | 55 (45–62, baja) | Logs por emisión. `/einvoicing/messages` y pendientes e-CF. No hay métrica de huecos de NCF. | Alerta de huecos; reconciliación NCF ↔ documentos |
| 11 | UX | 55 (45–65, baja: UI no ejecutada) | El formulario usa el preview del servidor; la clave de idempotencia se crea por factura solo al emitir un borrador (`core/services/invoices.ts:335-348`), no en "crear y emitir". | Clave también en `createInvoice` |
| 12 | Competitividad | 45 (35–55, media) | Frente a Alegra/Siigo/Facturama: falta e-factura MX/CO real, ND y recurrentes. | Ver §9 |

Promedio simple ≈ 49. La madurez (40) queda por debajo por el tope de min(eje 1, eje 2, eje 8) y por los críticos abiertos.

## 5. Compuertas de producción
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, con capacidades básicas | **No cumple** | INV-02 (fuera de DO); falta ND |
| 2 | Integridad en escrituras críticas | **No cumple** | INV-01, INV-03 |
| 3 | Aislamiento entre tenants | Cumple | IDOR → 404 (§6) |
| 4 | Validación en servidor | Cumple | class-validator en DTOs; totales calculados en servidor |
| 5 | E2E sin 500 | **No cumple** | 500 en concurrencia y en NC con cuota agotada |
| 6 | Cumplimiento por país | **No cumple** | MX/CO/… sin documento electrónico; 11 países sin reglas pero sin bloqueo |
| 7 | Pruebas de flujos críticos en CI | No cumple | Sin pruebas de concurrencia/idempotencia; integración omitida |
| 8 | Auditoría de negocio | Parcial | Eventos `INVOICE_CREATED`/`invoice.issued`; no verifiqué una tabla de auditoría |
| 9 | Migraciones | Cumple | Paso 2 global |
| 10 | Observabilidad | Parcial | Logs pino con req id |
| 11 | UI / i18n | No verificado | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos

**PRUEBAS EJECUTADAS (API en :3000, tenants qa-a, qa-b, qa-co, qa-mx; scripts en scratchpad `f5/`)**
- **Cálculo**: qa-a, `POST /invoices/preview` y luego emisión B01 (FAC-00000001 / B0100000001). Líneas: 3 × 1.234,57 con −10 % (ITBIS 18 %); 1 × 999,99 (16 %); 2 × 333,33 (0 %); descuento de documento 5 %.
  - Resultado: subtotal 4.999,99; descuento 250,00 repartido 166,67 / 50,00 / 33,33; base 18 % = 3.166,67 → 570,00; base 16 % = 949,99 → 152,00; total 5.471,99.
  - **Rehecho a mano: correcto.**
- **Asiento** be86d433: Débito 1130 = 5.471,99 y Débito 4300 = 250,00; Crédito 4200 = 4.999,99 y Crédito 2130 = 722,00. **Cuadra.**
- **CO** (qa-co): 2 × 10.500,50 al 19 % y 1 × 1.000 al 5 % → IVA 4.040,19, total 26.041,19. Correcto.
- **MX** (preview): 3 × 333,33 + 0,07 al 16 % → IVA 160,01. Correcto.
- **Redondeo** (transversal, confirmado por el coordinador): `common/money.ts:77-84` redondea 1,25 × 18 % a 0,22 (redondeo bancario). Afecta a cualquier línea con medio centavo exacto. Verificar con contador si la DGII o el SAT exigen redondeo hacia arriba.
- **NC** (qa-b): sobre B0100000001 (1.534,00).
  - NC parcial de 1 unidad de 500 → 590,00 (B0400000001). Saldo de la factura 944,00. Asiento: Débito 4200 500, Débito 2130 90, Crédito 1130 590.
  - Después, 3 NC totales en paralelo → 1 × 201 (B0400000002 por 944,00) y 2 × 409. Factura queda Void, acreditado 1.534. **Correcto, bloqueo efectivo** (`invoices.service.ts:1181-1188`).
- **Aislamiento**: con la sesión de qa-a, `GET /invoices/{id de qa-b}`, `/pdf`, `/print`, `POST /send`, `/credit-note`, `DELETE`, `GET /customers/{id de qa-b}`, `PATCH` cliente, y preview con cliente de qa-b → todos 404. Listado filtrado por cliente ajeno → vacío.

**INV-01** · M08 (y M09) · Eje 2 · Integridad de datos · **CRÍTICA**
- **Ubicación**: `invoices.service.ts:280-292` (`issue`).
- **Qué está mal**: el borrador se lee con `findOne` sin `FOR UPDATE` y sin UPDATE condicionado al estado. Cada transacción concurrente pasa la comprobación `status === DRAFT` y toma su propio NCF (el bloqueo existe solo sobre la secuencia: `compliance.service.ts:120-129`). El último `save` gana.
- **Prueba**: qa-b, borrador 5c45fa46. 6 × `POST /invoices/:id/issue` en paralelo con Idempotency-Key distinta → 6 × 200. Cada respuesta trae un NCF distinto, de B0100000002 a B0100000007. La factura queda con B0100000007 y `ncf_sequences.current_sequence` = 7. **B0100000002–06 quedan consumidos sin documento.** El asiento sí se deduplicó (clave `invoice:<id>:revenue`), pero la cuota del plan sumó 6.
- **Cuándo pasa en la práctica**: con E31/E32 lo dispara cualquier cliente de API, dos pestañas o dos usuarios. El frontend solo lo mitiga dentro de una misma pestaña.
- **Forma correcta**: `UPDATE invoices SET status='ISSUING' WHERE id=$1 AND status='Draft'` (o `setLock('pessimistic_write')` al leer el borrador) antes de numerar.
- **Impacto**: bloquea la venta (los NCF perdidos deben reportarse y anularse ante la DGII; verificar con contador). **Esfuerzo**: S.

**INV-02** · M08/M09 · Ejes 1, 3 · Funcionalidad falsa · **CRÍTICA**
- **Ubicación**: `invoices.service.ts:1836-1848`; `einvoicing/regimes/fiscal-regime.registry.ts` sin consumidores.
- **Qué está mal**: la emisión solo transmite si el número cumple el formato DGII `^E\d{12}$` (`invoice.entity.ts:509-513`).
- **Prueba**: qa-co, factura SETP990000001 → `GET /einvoicing/invoices/:id/status` devuelve `null`; `/xml` → 404; `ecf_submissions` sin filas; `POST /einvoicing/invoices/:id/submit` → `einvoicing.do.invoice_has_no_electronic_ncf_assigned`.
- MX asigna `ncf: null` y no timbra nunca.
- **Impacto**: bloquea la venta en 7 países. **Esfuerzo**: XL (ver M09).

**INV-03** · Eje 2 · Integridad · **ALTA**
- **Ubicación**: `invoices.controller.ts:65` — `POST /invoices` crea **y emite** por defecto (`issue !== false`) sin `@Idempotent()`.
- **Prueba**: reenvío del mismo cuerpo con el mismo `Idempotency-Key` → segunda factura fiscal (FAC-00000003 / B0100000002).
- La pantalla "nuevo → Emitir" usa esta ruta sin clave (`features/invoices/new/new.page.ts:778-797`; `core/services/invoices.ts:310`). Un timeout con reintento duplica la factura fiscal.
- **Esfuerzo**: S.

**INV-04** · Ejes 7, 2 · Robustez (transversal: SaaS) · **ALTA**
- **Ubicación**: `saas/repositories/usage-metric.repository.ts:85-95`.
- **Qué está mal**: captura el error 23505 dentro de la transacción del llamador y reintenta sin SAVEPOINT → `current transaction is aborted`.
- **Prueba**: 12 emisiones en paralelo → 5 × 500. Los NCF quedaron sin huecos porque la transacción completa se revierte. Con la cuota agotada, cualquier escritura que consuma cuota sin pasar antes por el guard devuelve 500 en vez de 403.
- **Forma correcta**: `INSERT … ON CONFLICT DO UPDATE … WHERE count+$1<=$5`. **Esfuerzo**: S.

**INV-05** · Ejes 1, 2 · Bug · **ALTA**
- **Ubicación**: `invoices.service.ts:462` (`enforceLimit` dentro de `issueWithin`) también para notas de crédito.
- **Prueba**: qa-a con 10/10 facturas → `POST /invoices/:id/credit-note` → 500.
- Un tenant en su límite no puede anular ni corregir documentos fiscales. Además, cada emisión concurrente del mismo borrador suma cuota (7 contadas para 2 facturas en qa-b).
- **Esfuerzo**: S.

**INV-06** · Eje 8 · Seguridad · **MEDIA**
- **Ubicación**: `invoices.controller.ts:237-287`.
- **Qué está mal**: `POST /:id/send` exige solo `invoices:view` y acepta cualquier `to`. Un usuario de solo lectura puede enviar facturas con PDF a direcciones externas. Throttle de 10/min.
- **Forma correcta**: permiso `invoices:send` y registro de auditoría. **Esfuerzo**: S.

**INV-07** · Eje 1 · Funcionalidad · **ALTA**
- No hay nota de débito emitible: los tipos B03/E33 existen en `fiscal-document-type-catalogue.ts:83`, pero `SALES_NCF_TYPES` y `InvoiceType` solo contemplan factura y NC.
- No hay facturación recurrente (grep `recurr` en invoices: 0 resultados).
- **Esfuerzo**: M.

**INV-08** · Eje 2 · Integridad · **MEDIA**
- **Ubicación**: `invoice-posting.service.ts` (`postCost`).
- **Qué está mal**: si faltan las cuentas de costo o inventario, el asiento de costo se omite con un simple `logger.warn`, pero el stock sí sale. El inventario contable deja de coincidir con el kardex.
- **Forma correcta**: bloquear la emisión, igual que se hace con retenciones e ISC. **Esfuerzo**: S.

**INV-09** · Eje 3 · Multi-país · **MEDIA**
- **Ubicación**: `compliance.service.ts:157` compara el vencimiento del NCF con la fecha UTC (`new Date().toISOString()`), mientras los rangos de otros países usan la zona del tenant (`regime-numbering.adapter.ts`, `today()`).
- Una factura emitida en DO después de las 20:00 del último día de vigencia se rechaza. **Esfuerzo**: S.

**INV-10** · Eje 2 · **BAJA/MEDIA**
- Una línea con tasa 0 % se registra como `taxTreatment: TAXED` pero cuenta en `exemptTotal`. Mezcla "gravado al 0 %" con "exento", que la DGII y el SAT distinguen (verificar con contador).

## 7. Camino mínimo a producción (solo DO)
1. INV-01: transición bloqueada (S).
2. INV-03: idempotencia en create (S).
3. INV-04 y INV-05: corregir usage-metric y excluir las NC de la cuota (S).
4. INV-08 (S).
5. Pruebas de concurrencia con BD real en CI (M).
6. Para otros países: bloquear la emisión hasta que M09 esté conectado (S). Hoy se emiten documentos sin validez.

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo | Tipo |
|---|---|---|---|
| INV-01/03/04/05 | +12 | S | Retocar |
| Conectar M09 para MX y CO de punta a punta | +15 | XL | Rehacer el transporte |
| ND + recurrentes | +6 | M | — |
| Dividir el servicio y usar puertos en lugar de imports de einvoicing | +5 | M | — |
| Pruebas de integración en CI | +6 | M | — |
| Portal y cobro en línea | +5 | L | — |

## 9. Competitividad
- **Faltantes básicos**: e-factura real en MX y CO (Facturama, CONTPAQi, Alegra y Siigo la tienen nativa, con PAC o proveedor tecnológico; confianza alta), nota de débito, recurrentes.
- **Diferenciadores existentes**: previsualización del asiento y del bloqueo antes de emitir (`/issue/preview`), retenciones por régimen, nota de cobro redactada con IA.
- **Nota de competitividad: 45** (35–55, media).

## 10. Fortalezas a preservar
- Totales calculados solo en el servidor, con preview único.
- Bloqueo de secuencia por tipo de NCF.
- Índice único de número fiscal.
- NC con bloqueo y control del saldo acreditable.
- Asiento con clave de idempotencia y comprobación de cuadre (`invoice-posting.service.ts`).
- Envío e-CF post-commit con fila PENDING.
- Aislamiento entre tenants correcto.

## 11. No verificado
- UI con Playwright.
- Emisión en US, PE, EC, CL, BR y AR.
- Multimoneda (factura en USD con tasa).
- Contenido completo del PDF.
- Envío de correo (no ejecutado: efecto externo).
- e-CF E31/E32 en DO (no emití: se transmitiría a DGII CerteCF).

**Veredicto y nota por país (facturación de ventas)**
| País | Nota | Veredicto |
|---|---|---|
| DO | 45 | No listo; piloto controlado tras arreglar INV-01/03 |
| CO | 20 | No listo (número DIAN sin documento electrónico) |
| MX | 15 | No listo (sin CFDI ni UUID; no se pudo emitir: el período de octubre de qa-mx lo cerró otro auditor) |
| PE, EC, CL, BR, AR | 15 | No listo (mismo camino que CO; no probado) |
| US | 35 | No verificado (contexto listo con TX 8,25 %) |
| Otros 11 | 10 | No soportado, y la emisión no se bloquea |

**Cobertura honesta**: ~60 % del backend leído (controlador, emisión, numeración, NC, posting); 9 de 14 endpoints ejecutados; frontend ~15 % (servicio y submit); UI no ejecutada.

<!-- RESUMEN: modulo=facturacion-ventas; madurez=40; prep=35; veredicto=No listo; eje_debil=multi-pais; criticos=2; altos=5; camino_min=M -->
