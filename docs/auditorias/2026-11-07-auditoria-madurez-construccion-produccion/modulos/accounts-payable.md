# accounts-payable — Cuentas por pagar (familia CMP)

## 1. Identificación
- **Alcance backend**: `apps/backend/api/src/app/accounts-payable/` (~8.300 líneas; `accounts-payable.service.ts` tiene 1.897). Controladores: `accounts-payable` (crear, listar, antigüedad, detalle, pagos, editar, NCF, enviar a aprobación, `payments`, anular, DELETE que se rechaza), `accounts-payable/capture|attachments` (captura con IA y adjuntos), `vendor-debit-notes`, `vendor-payments` (listar, detalle, anular), `suppliers/:id/statement`. Tablas: `vendor_bills`, `vendor_bill_line`, `vendor_payment`, `payment_batches`, `vendor_debit_note`, `vendor_bill_attachments`.
- **Frontend**: `apps/core/client-web/src/app/features/accounts-payable/` (lista, formulario con captura IA, detalle, pagos, notas de débito); antigüedad en `features/reports/aging` (ruta `reports/aging/payables`). Menú en `compras.manifest.ts`.
- **Pruebas**: `accounts-payable.spec.ts` (1.395 líneas, contra BD real) y otros specs. 14 suites / 143 tests del dominio CMP en verde (`jest.log`). `npm run verify:purchasing` EXIT 0.
- **Países**: DO tiene implementación completa (NCF, 606, retenciones). US: sin retención en factura, por diseño. MX/CO/CL/PE/AR/BR y el resto: "configurar localmente" (sin regímenes de retención hasta que el inquilino los cargue).
- **Dependencias**: contabilidad (puerto de contabilización), inventario (`GoodsReceiptPort`), tesorería (cuentas bancarias), workflows (aprobación), localización (NCF, retenciones), monedas.
- **¿Núcleo para vender?** Sí.

## 2. Estándar de referencia
(a) **Básicas**: factura de proveedor con impuestos y retenciones; conciliación a 3 vías contra OC y recepción, con tolerancias y retención por excepción; detección de duplicados; aprobación; pagos parciales, totales y por lote; notas de débito/crédito; anulación con reversa; antigüedad de saldos que cuadre con la cuenta de control; estado de cuenta del proveedor; reportes fiscales (606 en DO). **Avanzadas**: OCR/IA, propuesta de pagos, archivo bancario/ACH, pagos anticipados, portal de proveedores, multimoneda con diferencia cambiaria.
(b) **Invariantes**: CxP en el mayor = suma de saldos abiertos; ningún sobrepago; un documento fiscal se registra una sola vez por emisor; impuesto deducible ≤ impuesto según la tasa; asientos cuadrados; no se anula lo ya pagado; período cerrado bloqueado.
(c) **Líderes**: SAP (MIRO con tolerancias y bloqueo de pago), NetSuite y Dynamics 365 (match exceptions/holds), Odoo (control de facturas sobre cantidades recibidas), QuickBooks/Xero (sin 3 vías nativa). Confianza media: conocimiento general, sin verificarlo en la web en esta sesión. En DO: Alegra DO, con 606 y retenciones (confianza baja).
(d) **Construcción**: servicio de dominio transaccional; motor de match separado; reglas fiscales como datos con vigencia; restricciones únicas en BD.

## 3. Resultado
- **Madurez: 58 (52–64, confianza media)**, con tope min(ejes 1, 2, 8) = 58. Preparación comercial: **62 → Piloto controlado (DO)**. Para los demás países: piloto solo sin retenciones automáticas.
- **Eje más débil**: 2 (corrección): el match a 3 vías no retiene y el impuesto declarado no se valida.
- **Críticos abiertos**: ninguno. Aislamiento entre tenants y authZ verificados en vivo (ver §4, eje 8).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 72 (65–78, media) | Ciclo real de punta a punta: factura → contabilización → pago → nota de débito → anulación, todo con asientos (ver §6). Captura IA real; sin clave responde 503 `ai.not_configured`. | Propuesta de pagos, archivo bancario, anticipos. |
| 2 Corrección | 58 (50–65, media) | Cuadres verificados por SQL: CxP 2110 = 13.673 = suma de saldos abiertos; 0 asientos descuadrados; la antigüedad muestra `controlAccountDifference: 0`. Sobrepago rechazado; misma factura dos veces en un pago rechazada. Pero: CMP-01, CMP-02, CMP-03. | Retención por excepción a 3 vías con tolerancias, validación del impuesto contra la tasa, unicidad de NCF por RNC en BD. |
| 3 Multi-país | 55 (45–62, media) | El resolver toma el país de la organización y no cae en DO por defecto (`withholding-regimes.ts:225`). US: retención rechazada si se declara. Regímenes DO en código, sin vigencia (CMP-05). | Regímenes como datos versionados; 606 y equivalentes por país. |
| 4 Arquitectura | 62 (55–68, media) | Servicio de 1.897 líneas; bloqueos `FOR UPDATE` en orden de id; locks advisory; puerto de contabilización. Listado sin paginación (CMP-07). | Partir el servicio (match, pagos, anulación); paginar. |
| 5 Higiene | 55 (48–62, media) | `module-boundaries`: compras→contabilidad 18 importaciones privadas y 12 transacciones entre módulos (`createWithManager(…, manager)`); entidades de AP registradas en datasheets/overview. | Consumir solo contratos; eventos o puertos explícitos. |
| 6 Calidad | 62 (55–68, baja) | Lint sin errores (warnings globales). Código muy comentado; varios comentarios cuentan la historia de auditorías anteriores ("QA C-07", "AP-04"). | Quitar narrativa histórica; reducir `any`. |
| 7 Robustez | 58 (50–65, media) | 500 con número en notación científica (CMP-06). Bloqueo pesimista en pagos. `findAll` sin límite. | Paginación; validación numérica robusta. |
| 8 Seguridad | 74 (66–80, media-alta) | Prueba en vivo del 2026-11-07 a las 13:47, con AUTH_THROTTLE_LIMIT=200. qa-do-b sobre la factura, el pago y el proveedor de qa-do-cmp: GET, void, payments, debit-note y statement → 404; pagar la factura ajena → 400 `bill_id_does_not_exist_organization`; crear una factura con vendorId ajeno → 404; con purchaseOrderLineId ajeno → 400; con productId ajeno → 400. Pero acepta en borrador un `expenseAccountId` de otro tenant (201, ver CMP-25); al contabilizarla se rechaza. qa-do-a-member → 403 en create, list, aging, payments, void, debit-notes, vendor-payments y capture. Step-up `move_funds` de un solo uso; `@Idempotent`; whitelist. Adjunto servido inline (CMP-09). | Validar la propiedad de las cuentas en el alta; CMP-09. |
| 9 Pruebas | 66 (58–72, media) | 143 tests contra BD real y verify:purchasing en verde. Ninguna spec cubre la concurrencia de pagos; la prueba en vivo la pasa (CMP-12). | Spec de concurrencia; caso CMP-01. |
| 10 Operabilidad | 60 (50–68, baja) | Logs pino con requestId; motivo, autor y fecha de las anulaciones en el documento; procedencia IA registrada. | Auditoría antes/después en ediciones. |
| 11 UX | 60 (50–68, baja) | Pantallas completas en el manifiesto; captura IA con avisos (NCF, RNC, aritmética); antigüedad con estados de carga y error. No se hizo humo con Playwright (§11). Un borrador con error no se corrige ni se borra (CMP-08). | Editar líneas en borrador; humo de UI. |
| 12 Competitividad | 60 (50–68, baja) | Por encima de QuickBooks/Xero en 3 vías y retenciones DO; por debajo de SAP/NetSuite en holds, tolerancias y propuesta de pagos. | Holds, pagos por lote con archivo bancario, portal. |

Promedio simple ≈ 61,4; la madurez (58) la fija el tope del eje 2.

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple | Flujo completo real y asientos verificados. |
| 2 Integridad | Cumple con reservas | Transacciones, bloqueos e idempotencia sí; CMP-01/02/03 abiertos. |
| 3 AuthZ y aislamiento | Cumple | 404 o 400 en todos los ataques con ids ajenos, en URL y en body; 403 del member en todo el módulo (eje 8). Reserva: CMP-25. |
| 4 Validación en servidor | Cumple con reservas | DTOs con whitelist; el impuesto declarado no se valida (CMP-02). |
| 5 Humo sin 500 | No cumple | 500 en `receive` con `0.0000001` (CMP-06, transversal a class-validator). |
| 6 Cumplimiento por país | Parcial | DO casi completo; los demás declaran "configurar localmente". |
| 7 Pruebas en CI | Cumple en el módulo / no cumple global | Suites verdes; la rama global está en rojo (GLOBAL-RESULTS). |
| 8 Auditoría | Parcial | Anulaciones registradas; sin bitácora antes/después. |
| 9 Migraciones | Cumple | Global sin deriva. |
| 10 Observabilidad | Cumple mínima | requestId en logs. |
| 11 UI y traducciones | No verificado | |
| 12 Documentación | Parcial | Swagger con resúmenes en español. |

## 6. Hallazgos
**CMP-01** · AP/procurement · eje 2 · Integridad · **Alta** · `accounts-payable.service.ts:766-800` (`matchAgainstReceipts`), POST `/accounts-payable/:id/submit-for-approval`.
Factura ligada a OC: 70 unidades a 105, cuando se habían recibido 60 a 100. Se contabilizó sin excepción. Asiento: GRNI 2115 D 6.000, inventario 1140 D 1.050 (las 10 no recibidas) y D 300 (diferencia de precio). El stock pasó de 60 a 70: la factura dio entrada a mercancía que nadie recibió. Sin tolerancia de precio (+5 % aceptado). Solo se rechaza superar lo ordenado (`bill_exceeds_ordered_quantity`, probado).
Forma correcta: retener la factura (hold de pago) cuando lo facturado supera lo recibido o el precio se sale de la tolerancia, con liberación aprobada. Impacto: riesgo operativo (pagar lo no recibido). Esfuerzo: M.

**CMP-02** · AP · ejes 2 y 3 · Cálculo fiscal · **Alta** · `accounts-payable.service.ts:253` (`taxAmount = dto.taxAmount ?? 0`).
Factura de 1.000 de servicios con `taxAmount: 900` (90 %) aceptada: total 1.900, y 900 de ITBIS deducible al débito de 1150. Infla el crédito fiscal y el 606.
Forma correcta: calcular el impuesto desde la tasa del producto/línea y exigir motivo si difiere más allá del redondeo, como ya se hace con las retenciones. Impacto: riesgo fiscal. Esfuerzo: S–M.

**CMP-03** · AP + suppliers · eje 2 · Integridad fiscal · **Alta** · `accounts-payable.service.ts:516-530` (la unicidad del NCF va por `vendor_id`); `suppliers` sin unicidad de RNC.
Se crearon 2 proveedores con el mismo RNC 131246753 (201 ambos). El NCF B0100000001 se rechazó con el mismo proveedor (409) pero se aceptó con el duplicado (201). El 606 reportaría el mismo NCF y RNC dos veces y el gasto se duplicaría.
Forma correcta: unicidad por (organización, RNC del emisor, NCF normalizado) con índice único parcial en BD, y unicidad (o advertencia bloqueante) de RNC en proveedores. Esfuerzo: S.

**CMP-04** · AP · eje 4 · Integridad · Media · El NCF no tiene restricción en BD (solo `UQ_vendor_bills_supplier_invoice` para el número interno); la unicidad depende de `pg_advisory_xact_lock`. Cualquier escritura fuera del servicio (importación, SQL) la salta. Esfuerzo: S.

**CMP-05** · AP/localización · eje 3 · Multi-país · Media-Alta · `localization/fiscal/withholding-regimes.ts:112-170`.
Regímenes DO en código, sin fecha de vigencia: ITBIS 100 % y ISR 10 % para servicios de persona física; 30 % y 5 % para pagos del Estado. Calculado a mano y correcto en el caso probado: honorarios de 10.000 + 1.800 de ITBIS, retenciones 1.800 + 1.000, CxP 9.000; asiento 5600 D 10.000, 1150 D 1.800, 2110 C 9.000, 2135 C 2.800. Faltan casos frecuentes: ISR sobre alquileres a personas físicas, retención de ITBIS del 30 % a personas jurídicas por ciertos servicios, pagos al exterior (609). La retención se registra al facturar, no al pagar. *Verificar con contador DO*. Esfuerzo: M.

**CMP-06** · procurement/AP · eje 7 · Bug · Media · POST `/procurement/orders/:id/receive` con `quantity: 0.0000001` → **500** (`TypeError ... isNumber ... reading 'length'`, `class-validator IsNumber maxDecimalPlaces` con notación científica; logs/api.log 08:45:46). Afecta a todos los DTOs con `maxDecimalPlaces`. Esfuerzo: S.

**CMP-07** · AP · eje 7 · Rendimiento · Media · `GET /accounts-payable` (`findAll`, línea 1507) sin paginación ni límite: devuelve todas las facturas con sus relaciones. Las OC sí paginan. Esfuerzo: S.

**CMP-08** · AP · eje 11 · UX · Media · Un borrador no admite editar líneas (`lines_existing_invoice_must_changed_through`) ni borrarse (DELETE siempre rechazado): un error de captura en borrador solo se corrige anulando y recapturando (probado), y deja documentos VOID de ruido. Esfuerzo: S.

**CMP-09** · AP · eje 8 · Seguridad · Baja-Media · GET `/accounts-payable/attachments/:id/download`: un archivo que empieza por `<` se acepta como `application/xml` (declarándolo pdf) y se sirve `inline` en el origen de la API. Mitigado por `nosniff` y CSP. La CSP de la API permite `script-src 'unsafe-inline'`. Forma correcta: `Content-Disposition: attachment` para XML y CSP `sandbox` en descargas. Esfuerzo: S.

**CMP-10** · AP · eje 2 · Baja · Se pagó 3.000 desde "Caja general" con saldo 0, sin advertencia (saldo negativo). Esfuerzo: S.

**CMP-11** · AP · eje 8 · Privacidad · Media · La captura IA envía el PDF o imagen completo a Anthropic (`ai-gateway.service.ts:147`, `ANTHROPIC_API_KEY`). En este entorno no hay clave: 503, sin datos enviados. No vi consentimiento por inquilino ni aviso de transferencia en el flujo (no verificado en la UI). Esfuerzo: S.

**CMP-12** · AP · eje 9 · Pruebas · Media · Probado en vivo: dos sesiones con step-up pagaron a la vez los 4.673 pendientes de la factura 37fb0300. Resultado: una 201 (PAY-2026-000002) y una 400 `bill_id_status_cannot_take_payment`. La factura quedó PAID con saldo 0. Pagos: 3.000 + 4.673 = 7.673, más la nota de débito de 1.000, igual al total de 8.673. CxP 2110 = 9.000 = suma de saldos abiertos. El bloqueo funciona (`FOR UPDATE`, línea 1270), pero falta una spec que lo fije. Esfuerzo: S.

**CMP-24** · AP · eje 3 · Multi-país · Media · En qa-us-a y en qa-mx-a, una factura con `taxWithheld: 100` sin motivo se guardó (201) con la retención en 0, sin error ni aviso. En US el código (`withholding-resolver.service.ts:195-205`) dice que debería rechazarse con `invoices.withholding_not_in_market`. El usuario cree haber registrado una retención que no existe. Forma correcta: devolver 400 o pedir el motivo. Esfuerzo: S.

**CMP-25** · AP · eje 8 · Seguridad · Baja · `POST /accounts-payable` desde qa-do-b con `expenseAccountId` de qa-do-cmp (5600 Honorarios) → 201: el borrador guarda el id ajeno. `submit-for-approval` lo rechaza con 400 `journal_entries.one_more_accounts_not_found_inactive`, así que no llega al mayor. Es una referencia cruzada persistida en el borrador y un mensaje confuso. Forma correcta: `assertTenantOwns` en el alta. Esfuerzo: S.

## 7. Camino mínimo a producción (DO)
1. CMP-02, validación del impuesto (S). 2. CMP-03/04, unicidad de NCF por RNC en BD y de RNC en proveedores (S). 3. CMP-01, holds por excepción a 3 vías con tolerancias (M). 4. CMP-06 (S). 5. Prueba en vivo de aislamiento y authZ (S). 6. CMP-07 paginación (S). 7. CMP-12, prueba de concurrencia (S). Retocar, no rehacer.

## 8. Camino a 100
Holds y tolerancias (+6, M); regímenes como datos con vigencia (+5, M); propuesta de pagos y archivo bancario (+5, L); partir el servicio (+3, M); bitácora antes/después (+3, M); 606 y equivalentes por país (+6, XL); portal de proveedores (+3, L).

## 9. Competitividad
Básicas faltantes: holds por excepción, propuesta de pagos. Avanzadas: archivo bancario, anticipos, portal. Diferenciadores: captura IA con chequeos deterministas por país (RNC, NCF, aritmética); antigüedad que se cuadra sola con el mayor. Fuentes: conocimiento general (confianza media-baja).

## 10. Fortalezas
Cuadre real de CxP contra el mayor (SQL y reporte); bloqueos e idempotencia; step-up de un solo uso para pagar; anulaciones con reversa y bloqueo de lo pagado; retenciones DO correctas en el caso probado; verify:purchasing que concilia kárdex y mayor.

## 11. No verificado
- Humo de UI con Playwright y consola (no ejecutado).
- Verificado después: aislamiento A↔B con ids ajenos en URL y body, 403 del member, facturas en qa-mx-a y qa-us-a (sin retención DO aplicada: retenciones 0 y `regimeCodes` vacíos, factura OPEN por 11.600) y la concurrencia de pagos. Ver eje 8, CMP-12 y CMP-24.
