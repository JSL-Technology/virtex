# Ficha: `sales` (cotizaciones, pedidos, historial; leads/oportunidades) — familia FAC

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/sales/` (1.993 líneas): `services/quotes.service.ts` (447), `controllers/quotes.controller.ts` (115: `POST/GET/GET :id/PATCH :id`, `preview`, `:id/send|accept|reject|cancel|duplicate|convert-to-invoice`), `leads.controller.ts` (`POST/GET`, `:id/convert`), `opportunities.controller.ts` (`GET`), `inbox/order-mail.handler.ts` (pedidos por correo → cotización borrador, con IA), entidades `quotes`, `quote_lines`, `leads`, `opportunities`, `activities`.
- **Frontend:** `features/sales/` (1.403 líneas: `quotes/list`, `quotes/form` 513, `collections` 274, `history`); menú `ventas.manifest.ts:53-80,171-180` (`sales/history` = tickets del POS).
- **Pruebas:** `quotes.service.spec.ts` (192), `order-mail.handler.spec.ts`, `order-reading.spec.ts`.
- **¿Núcleo?** Sí (cotización→pedido→factura es el flujo comercial base).

## 2. Estándar de referencia
- (a) Básicas: cotización con versión/estado, envío, aceptación, **pedido de venta** (reserva de stock, entregas parciales, facturación parcial), conversión a factura, historial por cliente. Avanzadas: aprobación por descuento/margen, firma en línea del cliente, plantillas, CPQ, comisiones.
- (b) Invariantes: una cotización aceptada se factura una sola vez (o parcialmente con control de saldo); los precios/impuestos facturados son los cotizados o la diferencia se explica.
- (c) Odoo Sales (cotización = pedido tras confirmación, entregas y facturación parcial) — alta (conocimiento público); NetSuite Estimates→Sales Orders — media.
- (d) Construcción: agregados Quote y SalesOrder con máquina de estados; servicio de conversión transaccional.

## 3. Resultado
- **Madurez: 45 (38–52, confianza media). Preparación comercial: 40. Veredicto: No listo.**
- Eje más débil: 1 (no existe pedido de venta).
- Críticos abiertos: ninguno.

### Pruebas ejecutadas (qa-do-a, aislamiento con qa-do-b)
- `POST /sales/quotes` 1,5 × 1.000 → 201 `COT-00000001`, subtotal 1.500, total 1.770 (ITBIS 270 ✓ a mano).
- `send` → 200, `accept` → 200; **5 `convert-to-invoice` en paralelo** con claves distintas → **1×201** (`FAC-00000002`, borrador 1.770/270) **+ 4×409** `sales.quote_quote_number_has_already_invoiced` → sin doble facturación (reclamo atómico `UPDATE … WHERE status=ACCEPTED`, `quotes.service.ts:274-281`).
- qa-do-b sobre la cotización de A: `GET` → 404, `accept` → 404, `convert-to-invoice` → 404.
- Pedidos: `grep -rln "SalesOrder\|sales_order\|sales-order" apps/backend/api/src/app` → solo `ai/provenance/provenance.controller.ts`; **no hay pedidos de venta**. El "pedido por correo" crea una cotización borrador (`order-mail.handler.ts:29-37`).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 40 (32–48, alta) | Cotizaciones reales con estados y conversión; **sin pedido de venta, sin entregas/facturación parcial, sin reserva de stock**; oportunidades solo `GET`. | SalesOrder con entregas y facturación parcial. |
| 2 Corrección | 60 (52–68, media) | Conversión con reclamo atómico + compensación (`quotes.service.ts:274-321`) — no transaccional (crea factura fuera de la transacción del reclamo; si el proceso muere entre ambos, cotización queda INVOICED sin factura). Las líneas convertidas no llevan `taxRate`/`taxTreatment` de la cotización (`:300-306`): el impuesto se recalcula del catálogo al facturar. Usa `invoicesService.create` sin `actorUserId`. | Conversión en una transacción; copiar tratamiento fiscal. |
| 3 Multi-país | 55 (45–62, baja) | Usa el mismo motor de cálculo que la factura (`asInvoice` → preview); fecha en zona del tenant (`todayFor`). | — |
| 4 Arquitectura | 55 (48–62, media) | Máquina de estados explícita (`transition`, `:398-420`); eventos tras commit; transacciones cruzadas a plataforma (`documentSequencesService`, `exchangeRateResolver`). Permisos de cotización reutilizan `invoices:*` (no hay `quotes:*`). | Permisos propios. |
| 5 Higiene | 50 (40–58, media) | 5 violaciones de frontera; ciclo compras↔ventas; CRM (leads/oportunidades) mezclado en `sales`. | Separar CRM. |
| 6 Calidad | 55 (48–62, media) | 4 archivos con avisos de lint; tamaño razonable. | — |
| 7 Robustez | 50 (40–58, baja) | `findAll` de cotizaciones sin paginación visible (`quotes.service.ts:141-163`, solo filtros). | Paginación. |
| 8 Seguridad | 70 (60–78, media) | Aislamiento probado (404); permisos declarados; `@Idempotent` en convert/duplicate. Member no probado (throttle). `quotes/:id/edit` en el menú requiere solo `invoices:view` (`ventas.manifest.ts:74`) — el backend exige `invoices:create` para `PATCH`, así que solo es incoherencia de UI. | — |
| 9 Pruebas | 40 (30–48, media) | Spec unitaria del servicio; sin integración de conversión concurrente (la probé manualmente). | — |
| 10 Operabilidad | 45 (35–55, baja) | Eventos de negocio `announce`. | — |
| 11 UX | 45 (35–55, baja) | No probada en navegador. | — |
| 12 Competitividad | 35 (28–42, media) | Sin pedidos/entregas está por debajo de Odoo, Alegra, Siigo. Diferenciador: pedidos por correo con IA → cotización. | — |

Madurez 45 ≤ eje 1 (40)+5: tope por eje 1 aplicado de forma laxa por estar el flujo cotización→factura completo; si dudas, banda inferior (40).

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | **No cumple** | sin pedido de venta (básica). |
| 2 | Parcial | reclamo atómico; conversión no transaccional. |
| 3 | Cumple (aislamiento) / member no probado | — |
| 4 | Cumple | DTOs. |
| 5 | Cumple API | sin 500 en el flujo probado. |
| 6 | Parcial | hereda motor de factura. |
| 7 | Parcial | — |
| 8 | Parcial | eventos, sin auditoría antes/después. |
| 9–12 | Global | — |

## 6. Hallazgos
- **FAC-SAL-01** — sales / eje 1 — funcionalidad ausente — **Alta** — no existe pedido de venta ni entrega/facturación parcial (grep arriba). Bloquea distribución y manufactura bajo pedido. L.
- **FAC-SAL-02** — eje 2 — integridad — **Media** — `quotes.service.ts:274-321` conversión con compensación manual fuera de transacción; un fallo entre reclamo y creación deja la cotización `INVOICED` sin factura. Forma correcta: una transacción (crear borrador y marcar). S.
- **FAC-SAL-03** — eje 2 — integridad fiscal — **Media** — `quotes.service.ts:300-306` no traslada `taxTreatment`/`taxRate` de la línea cotizada; si el catálogo cambia entre cotización y factura, el total facturado difiere del aceptado sin aviso. S.
- **FAC-SAL-04** — eje 4/8 — **Baja** — cotizaciones usan permisos `invoices:*`; ruta de edición en el menú con `invoices:view`. S.
- **FAC-SAL-05** — eje 7 — **Media** — listado de cotizaciones sin paginación. S.

## 7. Camino mínimo a producción
1. Pedido de venta con entregas/facturación parcial (L, nuevo). 2. Conversión transaccional + traslado fiscal (S). 3. Paginación y permisos propios (S). Todos los países.

## 8. Camino a 100
Pedidos (+20, L) → aprobaciones por margen (+5, M) → firma/aceptación en portal (+5, M) → pruebas de integración (+5, S) → separar CRM (+3, M).

## 9. Competitividad
Odoo Sales (alta), NetSuite (media). Brecha básica: pedidos.

## 10. Fortalezas
Reclamo atómico contra doble facturación (probado 1/5), máquina de estados, mismo motor de cálculo que facturación, pedidos por correo con revisión humana.

## 11. No verificado
Member, UI, leads/oportunidades en profundidad (fuera del foco fiscal).
