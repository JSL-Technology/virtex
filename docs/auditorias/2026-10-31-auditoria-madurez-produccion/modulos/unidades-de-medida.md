# M20 — Unidades de medida (`units-of-measure`) · Familia F7

> Sin críticos de seguridad. La creación de unidades globales (compartidas por todos los tenants) exige un permiso de plataforma (`units-of-measure.controller.ts:38-41`, `@RequiresPlatformPermission(REFERENCE_DATA_MANAGE)`). Es correcto.

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/units-of-measure/`: 8 archivos, ~228 LOC, 1 spec.
  - Endpoints: `GET /units-of-measure`, `POST /company`, `DELETE /company/:id` y `POST /` (plataforma).
  - Tablas: `unit_of_measure` (global) y `tenant_units_of_measure`.
- **Frontend:** maestro enrutado (`inventario.manifest.ts:186`).
- **Uso:** `products.unit_of_measure` es un `varchar(16)` libre que guarda el símbolo, sin FK (`inventory/entities/product.entity.ts:159`). `bill_of_material_items.unitOfMeasureId` sí referencia la tabla.
- **Países:** las UdM fiscales (por ejemplo, la clave de unidad del SAT en MX o la UdM de la DGII) no están modeladas aquí. Verificar con facturación electrónica.

## 2. Estándar de referencia
- **Capacidades básicas:** catálogo de UdM por categoría; **conversiones** (caja = 12 unidades; kg ↔ g) con factor y redondeo; UdM de compra, de venta y de inventario por producto; precisión decimal por UdM.
- **Capacidades avanzadas:** conversiones por producto (una caja de A = 12, una de B = 24); mapeo a códigos fiscales (SAT `ClaveUnidad`, UN/ECE Rec 20).
- **Invariantes:** las existencias siempre en la UdM base; toda conversión es exacta y reversible dentro de la precisión.
- **Líderes** (confianza alta, documentación pública): Odoo (UoM categories con ratio y rounding, UdM de compra y venta), Dynamics BC (Item Units of Measure con *Qty. per Unit of Measure*), SAP B1 (UoM groups) y NetSuite (Units Types).

## 3. Resultado
**Madurez: 28** (22–35, confianza alta).
**Preparación: 30 → NO LISTO.**
- **Eje más débil:** 1. **Críticos:** 0. **Altos:** 2.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | **22** (15–30, alta) | Solo catálogo (símbolo, nombre, categoría). **No hay conversiones ni precisión**: la búsqueda de `factor\|convert\|precision\|decimal` en `units-of-measure/` = 0; las entidades solo tienen `symbol`, `name`, `category` y `nameKey`. El listado funciona (`GET` → 200 con unidades de plataforma UND, PAR, DOC…). | Factores, UdM de compra y venta, precisión. |
| 2 | Integridad | **45** (38–52, media) | El borrado de una unidad de empresa comprueba que no esté en uso (`units-of-measure.service.ts:72-81`). El producto guarda texto libre sin FK, así que puede llevar símbolos inexistentes. | FK o validación contra el catálogo. |
| 3 | Multi-país | **30** (baja) | Sin mapeo a códigos fiscales de unidad (por ejemplo, la `ClaveUnidad` del CFDI en MX); no revisé si facturación los resuelve aparte. | Mapeo por país (verificar con contador). |
| 4 | Arquitectura | **45** | El modelo global más extensión por tenant es razonable. | — |
| 5 | Higiene | **65** | Pequeño y aislado. | — |
| 6 | Calidad | **65** | — | — |
| 7 | Robustez | **60** | — | — |
| 8 | Seguridad | **70** (60–78, media) | Lo global requiere permiso de plataforma; lo del tenant se filtra por `organizationId`. IDOR no probado en `DELETE company/:id`, aunque filtra por organización (`:73`). | — |
| 9 | Pruebas | **40** | 1 spec. | — |
| 10 | Operabilidad | **40** | — | — |
| 11 | UX | **45** (baja) | No navegué la UI. | — |
| 12 | Competitividad | **15** | Odoo, BC y SAP B1 tienen conversiones; vender por caja y comprar por pallet no es posible. | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Capacidades básicas | **No cumple** | Sin conversiones. |
| 2 | Integridad | Parcial | El producto no tiene FK a la UdM. |
| 3 | Aislamiento | Cumple (parcial) | — |
| 4 | Validación | Cumple | — |
| 5 | E2E | Cumple (listado) | — |
| 6 | Cumplimiento por país | No cumple | Sin mapeo fiscal; verificar. |
| 7 | Pruebas en CI | Parcial | — |
| 8 | Auditoría | No cumple | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | N/A | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | No cumple | — |

## 6. Hallazgos
- **UOM-01 · Eje 1 · Capacidad básica faltante · ALTA** — No hay conversiones entre unidades ni UdM alternativas por producto. Las compras, las ventas y el kardex usan una sola UdM implícita, así que comprar por caja y vender por unidad obliga a duplicar productos. **Esfuerzo:** L (toca facturación, compras y POS).
- **UOM-02 · Eje 2 · Integridad · ALTA** — `products.unit_of_measure` es texto libre sin FK (`product.entity.ts:159`). La BOM usa `unitOfMeasureId` (UUID): son dos representaciones distintas del mismo concepto. **Esfuerzo:** M.
- **UOM-03 · Eje 3 · Media** — Falta el mapeo a códigos fiscales de unidad por país. Verificar con facturación electrónica y con un contador local.
- **UOM-04 · Eje 1 · Media** — Sin precisión ni redondeo por unidad. Las cantidades usan 6 decimales globales (`inventory/stock-ledger.service.ts:10-13`).

## 7. Camino mínimo a producción
1. FK o validación de la UdM del producto (M).
2. Conversiones con factor y UdM de compra y venta (L).
3. Mapeo fiscal (M).

## 8. Camino a 100
| Ítem | Puntos que sube | Esfuerzo |
|---|---|---|
| Conversiones y UdM alternativas | eje 1 +45, eje 12 +40 | L |
| FK única | eje 2 +25 | M |
| Mapeo fiscal | eje 3 +40 | M |
| Precisión por unidad | +10 | S |

## 9. Competitividad
Brecha básica frente a Odoo, BC y SAP B1. Bsale y Alegra manejan unidades simples (confianza media). **Nota: 15**.

## 10. Fortalezas a preservar
- Catálogo global con extensión por tenant.
- Protección contra el borrado de unidades en uso.
- Permiso de plataforma para lo global.

## 11. No verificado
- UI.
- IDOR del `DELETE`.
- Cómo resuelve facturación electrónica la unidad fiscal.

**Cobertura:** ~80 % del backend leído; 1 de 4 endpoints ejecutados.

<!-- RESUMEN: modulo=unidades-de-medida; madurez=28; prep=30; veredicto=No listo; eje_debil=1-Autenticidad; criticos=0; altos=2; camino_min=L -->
