# M10 — Ventas y cotizaciones (`sales`) — Familia F5

> Sin críticos propios. Al convertir una cotización a factura emitida se heredan M08 INV-01 e INV-02.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/sales/` — 20 archivos (3 specs), 1.672 LOC.
- **Controladores**:
  - `quotes.controller.ts`: crear, previsualizar, listar, ver, editar, enviar, aceptar, rechazar, cancelar, duplicar, convertir a factura.
  - `leads.controller.ts`: crear, listar, convertir.
  - `opportunities.controller.ts`: listar.
- Bandeja de pedidos por correo con IA (`sales/inbox`).
- **Entidades**: quote, quote_line, lead, opportunity, activity.
- **No existen pedidos de venta ni reservas de stock**: `grep -rni "reserv|SalesOrder|sales_order"` en `sales/` e `inventory/` sin resultados.
- **Frontend**: `features/sales` (cotizaciones con formulario de 492 LOC, historial POS, cobranza, lanzador del POS).

## 2. Estándar de referencia
- Ciclo cotización → pedido → (reserva y despacho) → factura, con facturación parcial; vigencia; versiones; aprobación por descuento; reserva de stock al confirmar el pedido; backorders.
- **Líderes**: Odoo Sales y NetSuite Sales Orders (confianza alta).
- **Invariante**: una cotización o pedido se factura una sola vez (o en parciales controlados).

## 3. Resultado
- **Madurez: 40** (35–48, media) · **Preparación: 38 → NO LISTO** (falta el pedido de venta, capacidad básica).
- Eje más débil: **1 Autenticidad (40)**.
- 0 críticos, 1 alto.

## 4. Doce ejes
| # | Eje | Nota | Evidencia |
|---|---|---|---|
| 1 | Autenticidad | 40 (35–48, media) | Cotizaciones reales. Sin pedidos, reservas ni facturación parcial (VEN-01) |
| 2 | Corrección | 65 (58–72, media) | Impuesto de la cotización correcto (1.800 × 18 % = 324). Una cotización vencida no se puede aceptar (409 `quote_expired_cannot_accept`). 3 conversiones concurrentes → 1 × 201 y 2 × 409, por el UPDATE condicional (`quotes.service.ts:272-278`) |
| 3 | Multi-país | 50 (hereda el motor de facturación) | — |
| 4 | Arquitectura | 58 | Conversión con reclamación + compensación, no en una sola transacción (VEN-03) |
| 5 | Higiene | 55 | Reutiliza `InvoicesService` |
| 6 | Calidad | 60 | — |
| 7 | Robustez | 58 | — |
| 8 | Seguridad | 65 (no verificado IDOR) | Usa los permisos `invoices:*` en lugar de permisos propios de ventas (VEN-04) |
| 9 | Pruebas | 35 | 3 specs (todos de inbox) |
| 10 | Operabilidad | 50 | — |
| 11 | UX | 55 (no verificado) | — |
| 12 | Competitividad | 35 | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Capacidades básicas | **No cumple** | Sin pedidos |
| 2 | Integridad | Cumple | Conversión única probada |
| 3 | Aislamiento | No verificado | — |
| 4 | Validación en servidor | Cumple | — |
| 5 | E2E sin 500 | Cumple | — |
| 6 | Cumplimiento por país | Hereda M08 | — |
| 7 | Pruebas en CI | No cumple | — |
| 8 | Auditoría | Parcial | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos

**VEN-01** · Eje 1 · Falta capacidad básica · **ALTA**
- No hay pedido de venta, reserva de stock, despacho previo a la factura ni facturación parcial. Una distribuidora no puede operar el ciclo comercial.
- **Esfuerzo**: L.

**VEN-02** · Eje 2 · **MEDIA**
- **Ubicación**: `quotes.service.ts:260-320`.
- La conversión no traslada `taxRate`/`taxTreatment` de la cotización; se recalculan desde el catálogo al facturar. Si el catálogo o la tasa cambian entre la cotización y la factura, el cliente recibe un importe distinto del cotizado.
- El vencimiento de la factura se calcula con `today()` y días de 86.400.000 ms (UTC).

**VEN-03** · Eje 4 · **MEDIA**
- **Ubicación**: `:272-316`.
- Marca INVOICED, crea la factura en otra transacción y compensa con un UPDATE si falla. Si el proceso cae entre ambos pasos, la cotización queda INVOICED sin factura.
- **Forma correcta**: una sola transacción, o `invoiceId` como fuente de verdad.

**VEN-04** · Eje 8 · **MEDIA**
- Todas las rutas de cotización usan `INVOICES_CREATE`/`INVOICES_VIEW` (`quotes.controller.ts:31-111`). No se puede dar a un vendedor permiso de cotizar sin darle permiso de facturar.

## 7. Camino mínimo a producción
1. Pedido de venta con reserva de stock y facturación parcial (L).
2. VEN-03 (S).
3. Permisos propios (S).
4. Congelar la tasa cotizada (S).

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Pedidos y reservas | +25 | L |
| Aprobación por descuento | +5 | M |
| Versiones de cotización | +4 | M |
| Pruebas | +8 | M |
| CRM (oportunidades editables: hoy solo se listan) | +5 | M |

## 9. Competitividad
- Por detrás de Odoo, Alegra (que tiene remisiones/pedidos) y Siigo.
- Diferenciador: lectura de pedidos por correo con IA (no probada).
- **Nota: 35.**

## 10. Fortalezas a preservar
- Conversión protegida contra duplicados.
- Validación de vencimiento.
- Preview con el mismo motor que la factura.

## 11. No verificado
- Leads y oportunidades.
- Bandeja de pedidos por correo.
- IDOR.
- UI.

**Cobertura**: ~40 % del backend leído; 6 endpoints ejecutados.

<!-- RESUMEN: modulo=ventas-cotizaciones; madurez=40; prep=38; veredicto=No listo; eje_debil=autenticidad; criticos=0; altos=1; camino_min=L -->
