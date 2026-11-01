# M14 — Punto de venta (`pos` + `apps/pos`) — Familia F5

> **CRÍTICO ABIERTO — POS-01**: una venta de POS no genera comprobante fiscal (ni NCF/e-CF B02/E32, ni ninguno de otro país) ni asiento contable. Las ventas, el ITBIS/IVA cobrado y las diferencias de arqueo no llegan a la contabilidad.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/pos/` — 12 archivos (2 specs), 1.181 LOC; `pos.service.ts` tiene 584 LOC.
- **Endpoints**: catálogo, contexto, turno activo, abrir turno, cerrar turno, reporte X/Z, venta (`@Idempotent`), listar ventas, ver venta, anular venta (`pos:manage_shifts`).
- **Tablas**: `pos_shifts`, `pos_sales` (la columna `invoiceId` existe, pero nunca se llena).
- **App**: `apps/pos` (~5.569 LOC, 8 specs), estado en `state/till.store.ts` con `localStorage` para tickets en espera. Se lanza desde `features/sales/pos-launcher`.
- **Documentación de producto**: `docs/pos.md`.

## 2. Estándar de referencia
- **Básico**: turnos con apertura y cierre; X y Z; arqueo por medio de pago; venta atómica e idempotente; **comprobante fiscal por venta** (DO: B02/E32 consumo; MX: CFDI global o por venta; CO: POS electrónico o factura); impresión; anulación por supervisor con NC; contabilización de ventas, impuestos y diferencias de caja; modo offline con cola y sincronización.
- **Líderes**: Odoo POS (offline, contabiliza la sesión al cierre) y Bsale (boleta electrónica en el POS) (confianza alta).

## 3. Resultado
- **Madurez: 30** (25–38, media-alta) · **Preparación: 25 → NO LISTO**.
- Eje más débil: **3 Multi-país/cumplimiento (15)**.
- **1 crítico**, 2 altos.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | 30 (25–38, alta) | Turnos, X/Z y arqueo reales: abrí un turno con 1.000, cerré contando 990 → esperado 1.000, variación −10, CLOSED. La venta es real, pero sin factura ni asiento | Comprobante y asiento |
| 2 | Corrección | 30 | Venta atómica: bloqueo del turno, stock y totales en una transacción (`pos.service.ts:203-310`); el precio y el total se validan contra el servidor. Pero los ingresos no se contabilizan | Posting |
| 3 | Cumplimiento | 15 (10–20, alta) | Ningún comprobante fiscal (POS-01) | NCF/e-CF y CFDI |
| 4 | Arquitectura | 55 | Servicio cohesionado; no reutiliza `InvoicesService` | Venta POS → documento de facturación |
| 5 | Higiene | 55 | — | — |
| 6 | Calidad | 62 | Tolerancias explícitas; medios de pago mixtos | — |
| 7 | Robustez | 55 | Venta idempotente; sin modo offline real (POS-03) | — |
| 8 | Seguridad | 65 (no verificado IDOR) | Anulación solo con `pos:manage_shifts`; `assertMayActOnShift` | — |
| 9 | Pruebas | 45 | 2 specs en backend, 8 en la app | — |
| 10 | Operabilidad | 50 | Log por venta | — |
| 11 | UX | 55 (no ejecutado) | Impresión térmica de 80 mm documentada | — |
| 12 | Competitividad | 30 | — | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, capacidades básicas | **No cumple** | Sin comprobante ni contabilidad |
| 2 | Integridad | No cumple | Ventas fuera del mayor |
| 3 | Aislamiento | No verificado | — |
| 4 | Validación en servidor | Cumple | — |
| 5 | E2E sin 500 | Cumple (en lo probado) | — |
| 6 | Cumplimiento por país | **No cumple** | — |
| 7 | Pruebas en CI | Parcial | — |
| 8 | Auditoría | Parcial | Anulación con motivo y supervisor |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | Cumple (parcial) | `docs/pos.md`, aunque omite la falta de fiscalidad |

## 6. Hallazgos

**POS-01** · Ejes 1, 2, 3 · Funcionalidad incompleta presentada como completa · **CRÍTICA**
- **Búsqueda**: `grep -in "journal|posting|ncf|fiscalNumber|invoice" pos/pos.service.ts` → ninguna coincidencia de posting, NCF ni creación de factura.
- `pos_sales.invoiceId` (`entities/pos-sale.entity.ts:117`) nunca se asigna.
- **Prueba** (qa-a): turno dd07c38c abierto y cerrado → `journal_entries` del tenant 10 → 10. Ni la apertura, ni el cierre, ni la variación de −10 generan asiento. No pude completar una venta por falta de stock (`inventory.not_enough_stock_in_warehouse`), así que la ausencia de asiento en la venta se verificó de forma estática.
- **Impacto**: en DO cada venta al consumidor requiere un NCF (verificar con contador). Ventas e impuestos quedan fuera de los libros y del 607.
- **Esfuerzo**: L.

**POS-02** · Eje 2 · **ALTA**
- **Ubicación**: `pos.service.ts:229`. El impuesto se calcula como `subtotal × product.taxRate` por línea, sin el motor de impuestos de facturación (ni exentos, ni tasas por jurisdicción en US, ni descuentos). Usa una segunda implementación de la aritmética.
- Además hereda el redondeo transversal de `common/money.ts:77-84`.
- **Esfuerzo**: M.

**POS-03** · Eje 7 · **ALTA**
- No hay modo offline: `localStorage` solo guarda tickets en espera (`till.store.ts:514-528`); no existe una cola de ventas para sincronizar.
- El estándar del mercado (Odoo) vende sin conexión.
- **Esfuerzo**: L.

**POS-04** · Eje 1 · **MEDIA**
- La anulación solo se permite en turno abierto. Una devolución sobre un turno cerrado "es una devolución" según el código (`:408`), pero no hay endpoint de devolución ni de NC en el POS.

## 7. Camino mínimo a producción
1. Generar un documento de facturación por venta, o una factura global al cierre del turno con NCF de consumo, reutilizando `InvoicesService` (L).
2. Asiento de cierre con caja, ventas, impuestos y diferencia de arqueo (M).
3. Devoluciones (M).

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Fiscal + contable | +30 | L |
| Offline con cola | +10 | L |
| Motor de impuestos común | +5 | M |
| Devoluciones y NC | +5 | M |
| Integración de hardware (gaveta, impresora fiscal donde aplique) | +5 | M |

## 9. Competitividad
- Por debajo de Odoo POS y Bsale. Hoy es una caja registradora sin fiscalidad.
- **Nota: 30.**

## 10. Fortalezas a preservar
- Venta atómica con el turno bloqueado.
- Idempotencia.
- Totales verificados por el servidor.
- Arqueo con efectivo neto de cambio.
- Separación cajero/supervisor.

## 11. No verificado
- Una venta completa (sin stock en qa-a).
- IDOR.
- UI e impresión.
- Contraste completo con `docs/pos.md`: la promesa de X/Z y anulación sí se cumple; el documento no promete fiscalidad, pero tampoco la descarta.

**Cobertura**: ~60 % del backend leído; 6 endpoints ejecutados; app ~5 %.

<!-- RESUMEN: modulo=punto-de-venta; madurez=30; prep=25; veredicto=No listo; eje_debil=cumplimiento; criticos=1; altos=2; camino_min=L -->
