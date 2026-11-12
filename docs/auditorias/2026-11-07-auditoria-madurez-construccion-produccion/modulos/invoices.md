# Ficha: `invoices` (facturas de venta, notas de crédito, anulación, numeración fiscal) — familia FAC

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/invoices/` (≈7.990 líneas). Núcleo: `invoices.service.ts` (1.924 líneas, god class), `invoices.controller.ts` (356), `services/invoice-posting.service.ts` (442), `services/withholding-resolver.service.ts` (360), `sales-tax.engine.ts` (357), `adapters/dominican-republic-fiscal.adapter.ts`, `adapters/regime-numbering.adapter.ts` (493, CO/PE/EC/CL/BR), `adapters/generic-fiscal.adapter.ts`, `adapters/fiscal-adapter.factory.ts`.
- **Endpoints:** `POST /invoices` (@Idempotent, crea y emite por defecto), `POST /invoices/preview`, `POST /:id/issue/preview`, `POST /:id/issue` (@Idempotent), `PUT /:id` (borrador), `DELETE /:id` (descartar borrador), `GET /invoices`, `GET /context`, `GET /:id`, `POST /:id/credit-note` (@Idempotent, permiso `invoices:void`), `GET /:id/pdf`, `POST /:id/send`, `POST /:id/compose-message`, `GET /:id/print`. Todos con `@HasPermission`.
- **Tablas:** `invoices`, `invoice_line_item` (mezcla de convenciones: `"invoiceId"`, `"productId"`, `"taxRate"` en camelCase junto a `credited_quantity`, `line_subtotal`), `ncf_sequences` (de compliance), `fiscal_document_ranges` (de einvoicing), `document_sequences`, `saas_usage_metrics`, `journal_entries`.
- **Frontend:** `features/invoices/` (list 378, new 884, detail 846 líneas); menú `ventas.manifest.ts:19-49`.
- **Pruebas:** 9 specs en el módulo (motor de impuestos, retenciones, numeración por régimen, renderer, costo); **ninguna spec de integración de `InvoicesService.create/issue/createCreditNote`**; el flujo E2E lo cubre `tools/verify/invoicing-lifecycle.ts` (`npm run verify:invoicing`, en CI `ci.yml:403`).
- **Países:** DO (NCF/e-NCF completo), CO/PE/EC/CL/BR (numeración por rango), MX (tipos I/E), resto genérico. **Núcleo para vender: sí, el más importante.**

## 2. Estándar de referencia
- (a) Básicas: borrador/emisión, numeración fiscal correlativa sin huecos por tipo y serie, cálculo por línea (descuento de línea y global, impuesto por tasa, exento/gravado, redondeo documentado), multimoneda con tasa, notas de crédito parciales/totales ligadas a la original con tope acreditable, anulación con trazabilidad (608 en DO), asiento contable automático y cuadrado, PDF/representación impresa, envío por correo, retenciones, períodos cerrados, idempotencia. Avanzadas: notas de débito, facturación recurrente, anticipos, facturas proforma, pagos parciales en documento, portal de cliente, aprobación.
- (b) Invariantes: un número fiscal se consume solo al emitir y una sola vez; ningún hueco por fallos; total = Σ componentes; Debe = Haber; Σ notas de crédito ≤ total; documento emitido inmutable; aislamiento por tenant.
- (c) Líderes: Odoo (borrador→publicado, secuencias sin huecos por diario, notas rectificativas), NetSuite, SAP B1; locales DO: Alegra RD y facturadores e-CF certificados por DGII — confianza media (conocimiento previo, no verificado con WebFetch en esta sesión). Norma DGII 06-2018 / Ley 32-23 (e-CF obligatoria por fases) — **verificar con contador local**.
- (d) Construcción: agregado `Invoice` con servicio de dominio + motor de cálculo puro + adaptador de numeración por país + puerto contable; transacción única para número+stock+asiento; outbox para transmisión.

## 3. Resultado
- **Madurez: 55 (48–60, confianza media-alta)** (tope 59 por crítico abierto FAC-INV-01; más ejes 3 y 9 débiles).
- **Preparación comercial: 50. Veredicto: No listo** (compuerta 6 incumplida; un crítico abierto). Para **DO**: piloto controlado tras corregir FAC-INV-01/02 y FAC-CMP-01.
- Eje más débil: 3 (multi-país) — fuera de DO se emite sin documento fiscal (UY) o con numeración sin transmisión (MX/CO…, ver einvoicing).
- Críticos abiertos: **FAC-INV-01**.

### Pruebas ejecutadas (tenant qa-do-fac salvo indicación)
1. **Cálculo** (`POST /invoices/preview`, `inv1.json`): L1 3,333 × 1.234,5678 desc. 7,5 %; L2 exenta 1,5 × 99,995; L3 libre 7 × 0,333; descuento global 5 %. Rehecho a mano: L1 bruto 4.114,8145→4.114,81, desc. 308,61, sub 3.806,20, global 190,31, base 3.615,89, ITBIS 650,86; L2 149,99/7,50/142,49; L3 2,33/0,12/2,21/0,40. Totales subtotal 3.958,52, ITBIS 651,26, total 4.411,85 — **coincide al centavo**. Redondeo por línea (half-up a 2 decimales), consistente con el e-CF. Montos de 3–6 decimales aceptados (`@IsNumber({maxDecimalPlaces:6})`).
2. **Borrador** (`issue:false`): `status Draft`, número interno `FAC-00000001`, `ncf_sequences.current_sequence` B01=0 → **no consume NCF**. (El número interno sí se consume; huecos en `FAC-` al descartar — aceptable, no es fiscal.)
3. **Emisión** `POST /:id/issue {"fiscalDocumentType":"B01"}` → `B0100000001`, asiento `247aabf7…`: 1130 CxC D 4.411,85; 4300 Descuentos D 197,93; 4100 Ventas C 2,33; 4200 Servicios C 3.956,19; 2130 ITBIS por pagar C 651,26 → **Debe 4.609,78 = Haber 4.609,78**.
4. **Idempotencia**: misma clave en issue ×2 → ambas 200, una sola numeración (B01 current=1). Sin clave → 400 `common.idempotency_key_required`.
5. **Concurrencia** 19–20 `POST /invoices` B02 en paralelo: numeración `B0200000001…09`, `count=9, distinct=9`, `current_sequence=9` → **sin duplicados ni huecos**; pero **10 respuestas HTTP 500** (ver FAC-INV-02). Una 2.ª ráfaga de 20 → 20×403 `SAAS_LIMIT_REACHED` (plan Starter: 10 facturas).
6. **Nota de crédito parcial** sobre B0100000001 (1,111 de 3,333) → **HTTP 500**; 5 en paralelo → 5×500; reintento con la misma clave → 500 (FAC-INV-01). No se pudo probar doble acreditación ni anulación total en este tenant. El script `verify:invoicing` (BD `virteex_test`) sí la cubre: "la nota de crédito parcial se emite con su propio e-NCF — E340000000001", "no se puede acreditar más de lo facturado" (✓, 54 checks, EXIT 0).
7. **Aislamiento** (qa-do-a crea borrador `bf40d4d8…`, cliente `4ae39a85…`, producto `1295ab6d…`; ataca qa-do-b): GET/PDF/PUT/DELETE/issue/credit-note → **404**; preview con `customerId` de A → 404; con `productId` de A → 400 producto no encontrado; `organizationId` en el body → 400 whitelist; `GET /invoices?customerId=<A>` → lista vacía. `GET /einvoicing/invoices/<A>/status` → 200 `null` (no filtra datos, pero responde distinto que 404).
8. **Otros países**: UY `POST /invoices` → 201 `Pending`, IVA 22 % (220,00), `fiscalNumber:null` (sin CFE); US → 201 con impuesto 0 (sin jurisdicciones configuradas, `ready:true`); MX `context`: tipos `I/E` electrónicos bloqueados por certificado; CO: `01/91` bloqueados por rango. GT: no probado (throttle de login).
9. **Autorización con qa-do-a-member**: **no ejecutada** — login bloqueado por 429 (`AUTH_THROTTLE_LIMIT=5`/min compartido por todos los agentes). Verificado en código: cada ruta lleva `@HasPermission` (`invoices.controller.ts:67-331`); crear/emitir `invoices:create`, NC `invoices:void`, editar `invoices:edit`.

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 65 (58–72, media) | Flujo real de punta a punta (borrador, emisión, asiento, NCF, NC en script). Falta: nota de débito de venta (no hay endpoint; `grep -n "debit-note\|DEBIT_NOTE" invoices/` → solo tipos e-CF 33 en catálogo), anulación directa sin NC, recurrentes, anticipos. | ND, anulación con motivo (608), recurrentes. |
| 2 Corrección | 52 (45–60, alta) | Cálculo exacto; asiento cuadrado; numeración sin huecos bajo concurrencia; bloqueo `FOR UPDATE` en issue (`invoices.service.ts:290`) y `pessimistic_write` en NC (`:1218`). **Pero**: NC imposibles con plan agotado (FAC-INV-01), 500 en concurrencia (FAC-INV-02), tasa "Fijo" tratada como % (FAC-TX-01). | Corregir saas `incrementUsage` (savepoint/UPSERT), excluir NC del cupo. |
| 3 Multi-país | 30 (22–38, media) | `fiscal-adapter.factory.ts:63` switch por país; UY/PY/BO/VE/PA/CR/GT/SV/HN/NI/US caen en `GenericFiscalAdapter`: emiten sin documento fiscal y sin advertir que el país exige e-factura (UY CFE, CR FE 4.4, GT FEL, etc.). DO no se filtra a otros (UY usó IVA 22 %, no ITBIS). Fechas `YYYY-MM-DD`, moneda base por país correcta (UYU, USD, MXN, COP). | Declarar "no soportado para facturación fiscal" por país y bloquear o etiquetar. |
| 4 Arquitectura | 45 (38–52, media) | Servicio de 1.924 líneas con cálculo, numeración, stock, contabilidad, e-CF, retenciones; motor de cálculo extraído (`sales-tax.engine.ts`, positivo); transacción única; outbox `registerPending`. Guard `PlanLimitCheckGuard` antes del interceptor de idempotencia → la reproducción de una clave ya usada devuelve 403 en vez de la respuesta guardada. | Partir en agregados (emisión, NC, consultas); orden guard/interceptor. |
| 5 Higiene | 40 (32–48, media) | 21 violaciones de frontera (`bnd.log`), transacciones cruzadas a contabilidad/inventario/plataforma/identidad (`invoices.service.ts:473,707,819,1098,1390`; `invoice-posting.service.ts:231,295`); depende de `compliance/entities/ncf-sequence` y `einvoicing/services/fiscal-range`; ciclo compras↔ventas. | Puertos explícitos. |
| 6 Calidad | 55 (48–62, media) | 2 archivos con avisos de lint; comentarios extensos y útiles, alguno contradice el código (`resolveLine` dice "la tasa sale del catálogo, el request solo puede cambiar el tratamiento" pero usa `dto.taxRate`, `invoices.service.ts:984-990`). | — |
| 7 Robustez | 55 (45–62, media) | Listado paginado (`limit` 50). Transmisión e-CF fuera de la transacción (job). Bajo carga concurrente responde 500 (FAC-INV-02). | — |
| 8 Seguridad | 72 (62–80, media) | Aislamiento A/B probado en 9 operaciones: sin fugas. Permisos declarados en todas las rutas. Asignación masiva rechazada. RLS no aplica en este entorno (rol superusuario). Prueba con member no ejecutada. | Prueba automatizada de member; RLS efectivo con rol no superusuario. |
| 9 Pruebas | 45 (38–52, media) | Specs unitarias buenas del motor; sin integración del servicio; `verify:invoicing` E2E en CI (54 checks) **pero contacta a la DGII real** (FAC-EINV-02). Ninguna prueba de concurrencia de emisión ni de cupo de plan. | Integración BD de issue/NC/concurrencia/plan. |
| 10 Operabilidad | 55 (45–62, baja) | Logs pino con `req.id`, `organizationId`, `userId`; errores sin traza al cliente (`INTERNAL_ERROR`). Log de emisión en español; auditoría de negocio: no verificada en detalle (`financial-audit.subscriber.ts`). | Auditoría antes/después de NC/anulación. |
| 11 UX | 50 (40–58, baja) | Formulario usa `/preview` (una sola aritmética, positivo). UI **no probada en navegador** (prioridad del coordinador). | Prueba E2E de UI. |
| 12 Competitividad | 50 (40–58, media) | DO competitivo en lo básico (NCF/e-NCF, ITBIS, propina 10 %, retenciones); falta ND, recurrentes, anticipos; fuera de DO muy por detrás de Alegra/Siigo/CONTPAQi. | — |

Madurez 55 vs promedio simple ≈52: coherente.

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple en DO / no fuera | DO real; UY emite sin CFE. |
| 2 Integridad | **No cumple** | FAC-INV-01/02. |
| 3 AuthZ/aislamiento | Cumple (aislamiento probado; member no probado) | §3 punto 7. |
| 4 Validación | Cumple | class-validator + reglas de tasa por país. |
| 5 Humo sin 500 | **No cumple** | 500 en NC y concurrencia. |
| 6 Cumplimiento país | **No cumple** | países genéricos sin declarar no soportados. |
| 7 Pruebas CI | Parcial | verify:invoicing en CI; API typecheck/test en rojo global. |
| 8 Auditoría | Parcial | — |
| 9 Migraciones | Cumple (global) | — |
| 10 Observabilidad | Cumple | logs con req.id/tenant. |
| 11 UI | No verificado | — |
| 12 Documentación | Parcial | comentarios extensos; sin guía operativa. |

## 6. Hallazgos
- **⚠️ FAC-INV-01** — invoices+saas / eje 2 — bug / integridad — **Crítica** — `invoices.service.ts:472-473` (`issueWithin` llama `saasService.enforceLimit(…INVOICES)` también para notas de crédito, `:1277`) + `saas/repositories/usage-metric.repository.ts:52-108`. **Qué está mal:** con el cupo del plan agotado, el UPDATE condicionado no devuelve fila, se intenta INSERT, falla con 23505 dentro de la transacción y el reintento corre sobre una transacción abortada → `QueryFailedError: current transaction is aborted` → **HTTP 500**. Probado: `POST /invoices/c3e536ca…/credit-note` (1,111 uds.) → 500; 5 en paralelo → 5×500 (log `api.log` 08:48:12, stack `UsageMetricRepository.incrementUsage ← SaasService.enforceLimit ← InvoicesService.issueWithin ← createCreditNote`). Consecuencia: un cliente que llega al tope **no puede emitir notas de crédito ni anular** facturas (corrección fiscal bloqueada), y las NC consumen cupo de "facturas". **Forma correcta:** NC fuera del cupo (o cupo propio); `INSERT … ON CONFLICT DO UPDATE … WHERE count + $1 <= $limit RETURNING` en una sola sentencia, o SAVEPOINT. **Impacto:** bloquea la venta (riesgo legal del cliente). **Esfuerzo:** S.
- **FAC-INV-02** — eje 2/7 — robustez — **Alta** — mismo origen — en ráfaga concurrente cerca del límite, las solicitudes que debían recibir 403 reciben **500** (10/19 en la prueba). Numeración intacta (rollback correcto). S.
- **FAC-INV-03** — eje 3 — multi-país — **Alta** — `adapters/fiscal-adapter.factory.ts:63-80`, `generic-fiscal.adapter.ts` — UY (y US, PY, BO, VE, PA, CR, GT, SV, HN, NI) emiten facturas `Pending` sin documento fiscal ni aviso; probado UY 201 `fiscalNumber:null`. En UY, CR, GT, PY, etc. la factura electrónica es obligatoria — **verificar con contador local**. Forma correcta: matriz de cobertura por país que bloquee o marque "documento no fiscal". M.
- **FAC-INV-04** — eje 4 — arquitectura — **Media** — `PlanLimitCheckGuard` corre antes de `IdempotencyInterceptor`: reintento con clave ya usada → 403 en lugar de la respuesta original (probado `fac-k1`). Además el guard bloquea **crear borradores** al llegar al cupo aunque el comentario dice que el cupo se cuenta al emitir. S.
- **FAC-INV-05** — eje 1 — funcionalidad — **Alta** — no existe nota de débito de venta ni anulación sin NC desde facturas (`grep -rn "debit" invoices/invoices.controller.ts` → nada). DGII e-CF 33 y B03 existen en el catálogo pero no son emitibles. M.
- **FAC-INV-06** — eje 3 — multi-país — **Media** — US: `ready:true` y factura con impuesto 0 sin jurisdicciones configuradas, pese a `configurationRequired:true` en `country-tax-schemes.ts` (probado). Debería exigir nexo configurado o confirmar explícitamente. S.
- **FAC-INV-07** — eje 4/6 — calidad — **Media** — `invoices.service.ts` 1.924 líneas, 30+ métodos; comentario de `resolveLine` contradice el código. M.
- **FAC-INV-08** — eje 4 — modelo de datos — **Baja** — `invoice_line_item` mezcla `"invoiceId"`/`"taxRate"` con `credited_quantity`. S (migración).

## 7. Camino mínimo a producción (DO primero)
1. FAC-INV-01/02: cupo con UPSERT atómico y NC fuera del cupo (S). 2. Orden guard/idempotencia (S). 3. Integración BD de issue/NC/concurrencia/cupo en CI sin red externa (M; depende de FAC-EINV-02). 4. Nota de débito (M). 5. Matriz de países: bloquear emisión fiscal donde no hay régimen (M). Retocar, no rehacer.

## 8. Camino a 100
Corrección cupo (+5, S) → ND y anulación (+6, M) → partir el servicio (+5, L) → países con régimen real (ver einvoicing, +15, XL) → recurrentes/anticipos (+5, M) → pruebas de integración (+5, M) → UI probada E2E (+3, S).

## 9. Competitividad
Básicas faltantes: ND, recurrentes, documentos fiscales fuera de DO. Diferenciadores: preview de emisión que muestra asiento y número antes de emitir (`/issue/preview`), retenciones por régimen del comprador, propina legal DO. Frente a Alegra RD (media), paridad parcial en DO; en MX/CO muy inferior a CONTPAQi/Siigo (media).

## 10. Fortalezas
Aritmética única servidor (preview = emisión), cálculo exacto al centavo, bloqueo pesimista y numeración sin huecos bajo concurrencia, idempotencia obligatoria en escrituras fiscales, aislamiento correcto en todas las operaciones probadas, asiento cuadrado con cuentas de descuento y servicios separados.

## 11. No verificado
Member (403 en crear/anular) por throttle de login; NC parcial/total y doble acreditación en `erp` (bloqueado por FAC-INV-01; cubierto solo por verify:invoicing); UI de punta a punta y consola del navegador (prioridad del coordinador tras reinicios); GT/CO/MX emisión real (sin certificado/rango).
