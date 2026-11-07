# M13 — Cobranza y CxC (`customers/customer-payments*`, `collections`) — Familia F5

> **CRÍTICO ABIERTO — COB-01**: los recibos concurrentes sobre una misma factura se aplican todos. Probado: 4 cobros de 118,00 sobre una factura de 118,00. Resultado: el mayor de CxC queda en −354,00 y la suma de saldos de facturas en 0,00; es decir, cobro duplicado y CxC descuadrada.

## 1. Identificación
- No existe un módulo `customer-receipts` en el backend (búsqueda en `apps/backend/api/src/app`: solo aparece en el catálogo de eventos). Los recibos viven en:
  - `customers/customer-payments.service.ts` (936 LOC) y su controlador.
  - Endpoints: crear, listar, antigüedad, anticipos, ver, anular.
  - `customers/customer-statement.controller.ts`: estado de cuenta.
- `collections/`: 11 archivos, 1.191 LOC. Lista de trabajo de cobranza con IA, actividades y recordatorios por correo, detrás del feature `ai_collections`.
- Reporte duplicado de antigüedad en `reports/reports.controller.ts:33` (`GET /reports/aging`). No existe `reports/aging/receivables` (404).
- **Frontend**: `features/customer-receipts` (lista y formulario de 446 LOC), `features/sales/collections`, `features/contacts/data/aging.service.ts`.
- **Países**: todos (moneda, retenciones).

## 2. Estándar de referencia
- **Básico**: recibo aplicado a una o varias facturas; parciales; anticipos y sobrepagos; retenciones sufridas; diferencia de cambio; anulación con reversión; antigüedad que cuadra con el mayor; estado de cuenta.
- **Avanzado**: conciliación bancaria automática, dunning, portal y pago en línea.
- **Invariante**: suma de saldos abiertos = saldo de la cuenta de control CxC; nunca se aplica más que el saldo de la factura.
- **Líderes**: QuickBooks y Xero bloquean la sobreaplicación y concilian de forma automática (confianza media).

## 3. Resultado
- **Madurez: 25** (20–35, alta) · **Preparación: 30 → NO LISTO**.
- Eje más débil: **2 Corrección (25)**.
- **1 crítico**, 2 altos.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | 62 (55–70, media) | Recibo parcial con sobrepago probado: 700 recibidos, 500 aplicados → Débito Caja 700, Crédito CxC 500, Crédito Anticipos (2170) 200. Saldo de la factura 680. `GET /customer-payments/advances` devuelve 200 de anticipo. Retenciones, descuento y diferencia de cambio en el código | Conciliación, pago en línea |
| 2 | Corrección | 25 (20–32, alta) | COB-01, COB-02 | Bloqueo de facturas |
| 3 | Multi-país | 50 (40–60, baja) | Multimoneda con tasa del recibo y de la factura, retenciones. No verificado | Probar FX |
| 4 | Arquitectura | 58 (50–65, media) | Servicio único de 936 LOC; transacción única | Separar aplicación y posting |
| 5 | Higiene | 55 | Los recibos viven dentro de `customers` | Módulo propio de CxC |
| 6 | Calidad | 60 | — | — |
| 7 | Robustez | 35 (28–45, alta) | Condición de carrera (COB-01) | FOR UPDATE |
| 8 | Seguridad | 65 (55–75, baja) | Facturas filtradas por org y cliente (`:237-245`), alcance por sucursal. IDOR no probado en recibos | Probar |
| 9 | Pruebas | 40 | 2 specs en collections; no hay pruebas de concurrencia de cobros | — |
| 10 | Operabilidad | 62 | **La antigüedad muestra `controlAccountDifference`** (detectó el descuadre: 354) | Alerta automática |
| 11 | UX | 55 (no verificado) | — | — |
| 12 | Competitividad | 50 | — | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple (parcial) | Recibos reales; collections con IA tras feature (403 `saas.feature_disabled` en qa-b) |
| 2 | Integridad | **No cumple** | COB-01 |
| 3 | Aislamiento | No verificado | IDOR en recibos no probado; consultas sí filtran por `organizationId` |
| 4 | Validación en servidor | Cumple | — |
| 5 | E2E sin 500 | Cumple (en las pruebas hechas) | — |
| 6 | Cumplimiento por país | Parcial | — |
| 7 | Pruebas en CI | No cumple | — |
| 8 | Auditoría | Parcial | Anulación con motivo |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Cumple | Diferencia de control visible |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos

**COB-01** · Ejes 2, 7 · Integridad de datos · **CRÍTICA**
- **Ubicación**: `customers/customer-payments.service.ts:237-245`. Carga las facturas con `manager.find` sin `FOR UPDATE`; compara `relieved <= invoice.balance` (`:300-306`) y guarda (`:333`). Es una actualización perdida (lost update).
- **Prueba** (qa-b, factura 5c45fa46 B0100000007, saldo 118,00):
  1. 4 × `POST /customer-payments` en paralelo (claves distintas, ref QA-F5-PAY-CONC) → 4 × 201.
  2. Recibos REC-2026-000001..04 POSTED; cada uno aplica 118,00 con su asiento.
  3. Factura: saldo 0, Paid.
  4. Mayor CxC = −354,00. `GET /customer-payments/aging` → `controlAccountDifference: 354`.
- **Forma correcta**: `setLock('pessimistic_write')` sobre las facturas en orden de id; o `UPDATE … SET balance = balance - $x WHERE balance >= $x`.
- **Impacto**: bloquea la venta (cobros duplicados, CxC falsa). **Esfuerzo**: S.

**COB-02** · Eje 2 · Integridad · **ALTA**
- **Qué está mal**: la anulación de un recibo restaura el saldo de la factura sin tener en cuenta otros recibos.
- **Prueba**: al anular REC-2026-000004 (`POST /customer-payments/:id/void`) la factura volvió a saldo 118,00/Pending, aunque REC-01..03 siguen aplicados por 354. La diferencia de control sigue en 354.
- Es consecuencia de COB-01, pero muestra que el saldo se guarda desnormalizado y no se recalcula desde las aplicaciones.
- **Esfuerzo**: M (saldo derivado o comprobación de invariante).

**COB-03** · Eje 2 · **ALTA** (verificar)
- **Ubicación**: `:300-306`.
- **Qué está mal**: compara `line.amount` (moneda del recibo) contra `invoice.balance` (moneda de la factura) sin convertir. Con recibo en USD y factura en DOP, el tope de sobreaplicación se aplica en unidades mezcladas. No lo probé.
- **Esfuerzo**: S.

**COB-04** · Eje 5 · Arquitectura · **MEDIA**
- Hay dos reportes de antigüedad:
  - `GET /customer-payments/aging` (bueno, con cuenta de control).
  - `GET /reports/aging` → `{"message":"No hay facturas pendientes de pago para generar el reporte."}`: texto fijo en español, sin i18n y sin cuadre con el mayor.
- **Esfuerzo**: S.

**COB-05** · Eje 1 · **MEDIA**
- La cobranza (`collections`) depende del feature de IA `ai_collections`. Sin plan de IA no hay lista de trabajo de cobranza ni recordatorios (403 en qa-b). En el estándar, el dunning básico no requiere IA.

## 7. Camino mínimo a producción
1. COB-01 (S).
2. Comprobación de invariante saldo = suma de aplicaciones en la anulación (M).
3. COB-03 (S).
4. Prueba de concurrencia con BD real en CI (M).

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo |
|---|---|---|
| COB-01/02/03 | +20 | S–M |
| Conciliación bancaria con aplicación automática | +8 | L |
| Dunning sin IA | +5 | M |
| Pago en línea y portal | +6 | L |
| Unificar antigüedad | +3 | S |

## 9. Competitividad
- Tiene anticipos, retenciones, diferencia de cambio y control de cuadre visible: por encima de Alegra en diseño.
- Faltan conciliación y cobro en línea (Xero, QuickBooks).
- **Nota: 50.**

## 10. Fortalezas a preservar
- Asiento del cobro correcto (caja / CxC / anticipos).
- `controlAccountDifference` en la antigüedad.
- Recibo idempotente por clave (`@Idempotent`).
- Anulación con motivo.

## 11. No verificado
- Multimoneda.
- Retenciones.
- IDOR en recibos.
- Estado de cuenta.
- UI.
- Envío de recordatorios (efecto externo).

**Cobertura**: ~45 % del servicio leído; 5 endpoints ejecutados.

<!-- RESUMEN: modulo=cobranza-cxc; madurez=25; prep=30; veredicto=No listo; eje_debil=correccion; criticos=1; altos=2; camino_min=M -->
