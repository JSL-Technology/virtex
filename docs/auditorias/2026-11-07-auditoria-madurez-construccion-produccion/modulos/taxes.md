# Ficha: `taxes` (catálogo de impuestos del tenant) — familia FAC

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/taxes/` (7 archivos, 243 líneas): `taxes.controller.ts` (CRUD `POST/GET/GET :id/PATCH :id/DELETE :id /taxes`, permisos `taxes:*`), `taxes.service.ts` (46), entidad `taxes` (`rate decimal(10,4)`, `type enum('Porcentaje','Fijo')`, `countryCode`, `tax_group_id`). Pruebas: 1 spec de DTO (`create-tax.dto.spec.ts`, 20 líneas).
- **Fuente de tasas:** `localization/fiscal/country-tax-schemes.ts` (153 líneas, tasas fijas en código, sembradas al alta) + catálogo editable del tenant leído por `invoices.service.ts:603 tenantTaxRates` y `inventory/contracts/sellable-product.contract.ts:50 standardSalesTaxRate`.
- **Frontend:** `features/masters/taxes/` (listado 208 + formulario 119).
- **Países:** los 19 (DO, MX, CO, CL, PE, AR, EC, UY, PY, BO, VE, PA, CR, GT, SV, HN, NI con tasas; US y BR "configuración requerida", sin tasas).
- **¿Núcleo?** Sí: toda factura depende de él.

## 2. Estándar de referencia
- (a) Básicas: catálogo de impuestos por país con tasas oficiales, tipos (IVA, selectivo, retenciones), **vigencia (desde/hasta)**, cuentas contables por impuesto, códigos oficiales para documento electrónico (p.ej. código DGII ITBIS1/ITBIS2, SAT 002, DIAN 01), impuesto incluido/excluido, bloqueo de borrado si está en uso. Avanzadas: impuestos compuestos/en cascada, motores por jurisdicción (US), versión de tasas por fecha de documento.
- (b) Invariantes: la tasa aplicada a un documento es la vigente en su fecha; cambiar o borrar un impuesto no altera documentos emitidos; un impuesto de monto fijo nunca se interpreta como porcentaje.
- (c) Odoo `account.tax` (tipos porcentaje/fijo/división, grupos, impuestos incluidos, cuentas de reparto) — alta (conocimiento público); SAP/NetSuite "tax codes" con fechas de vigencia — media; Avalara/QuickBooks para US — media.
- Tasas generales comparadas con fuentes públicas (búsqueda web 2026-11-07, Kintsugi/Biz Latin Hub/Primicias; **confianza media, verificar con contador local**):

| País | Código | Fuente pública | Coincide | Observación |
|---|---|---|---|---|
| DO | 18 / 16 / 0 | Ley 253-12 art. 23 (reducida 16 %) | Sí | — |
| MX | 16 / 8 frontera / 0 | LIVA + decreto estímulo frontera | Sí | 8 % es estímulo con requisitos, no tasa libre |
| CO | 19 / 5 / 0 | Estatuto Tributario | Sí | excluido ≠ exento no distinguido |
| CL | 19 | SII | Sí | — |
| PE | 18 (IGV+IPM) | SUNAT | Parcial | **falta tasa reducida restaurantes/hoteles MYPE (10 % + IPM = 10,5 %) desde 2024–2026** (fuente Kintsugi/ProActivo, media) |
| AR | 21 / 10,5 / 27 | AFIP | Sí | — |
| EC | 15 / 0 | SRI (15 % desde abril 2024) | Parcial | **faltan 5 % (materiales de construcción) y otras reducidas** (Kintsugi, media) |
| UY | 22 / 10 | DGI | Sí | — |
| PY | 10 / 5 | SET | Sí | — |
| BO | 13 | SIN | Sí | IVA boliviano es "por dentro" (tasa efectiva 14,94 %); el código lo trata como tasa sobre base — **verificar con contador local** |
| VE | 16 | SENIAT | Parcial | faltan 8 % reducida y adicional lujo |
| PA | 7 | DGI | Parcial | faltan 10 % / 15 % (bebidas alcohólicas, tabaco) |
| CR | 13 | Hacienda, Ley 9635 | Parcial | **faltan reducidas 1 %, 2 %, 4 %** |
| GT 12, SV 13, HN 15, NI 15 | — | — | Sí | HN 18 % (bebidas/tabaco) ausente |

## 3. Resultado
- **Madurez: 35 (28–42, confianza media). Preparación comercial: 30. Veredicto: No listo.**
- Eje más débil: 2 (corrección) / 3 (multi-país: tasas sin vigencia).
- Críticos abiertos: ninguno propio; FAC-TX-01 es alta y contamina facturación.

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 50 (40–58, media) | CRUD real y persistido; la factura sí lee el catálogo (`invoices.service.ts:603`). No existen cuentas contables por impuesto, códigos oficiales por impuesto, ni impuestos compuestos. | Cuenta contable, código oficial (e-CF/CFDI/DIAN) y tipo (IVA/selectivo/retención) por impuesto. |
| 2 Corrección | 25 (18–35, alta) | **Probado:** `POST /taxes {"name":"QA-FAC Fijo 50","rate":50,"type":"Fijo"}` → 201; luego `POST /invoices/preview` con `taxRate:0.5` → **200, ITBIS 50 sobre base 100** y `GET /invoices/context` → `taxRates:[0.5,0.18,0.16,0]`. `tenantTaxRates` divide todo `rate/100` sin mirar `type`. `standardSalesTaxRate` = `MAX(rate)` de los porcentajes del tenant (`sellable-product.contract.ts:55`): añadir un selectivo de 28 % hace que todo producto gravado sin tasa propia pase a 28 %. `DELETE /taxes/<ITBIS 18 %>` → **200** (borrado físico, `taxes.service.ts:42`) sin comprobar uso. | Filtrar por `type`, marcar "estándar" explícito, borrado lógico con bloqueo si está en uso. |
| 3 Multi-país | 30 (22–40, media) | Tasas fijas en código, **sin vigencia** (`country-tax-schemes.ts` no tiene `validFrom/validTo`; `grep -n "effective\|validFrom\|since"` → nada). El catálogo del tenant tampoco tiene vigencia. Reducidas ausentes en PE, EC, CR, PA, VE, HN (tabla §2). US/BR sin tasas (declarado "configuración requerida", correcto). | Tabla `tax_rates(country, code, rate, valid_from, valid_to, source)` y resolución por fecha del documento. |
| 4 Arquitectura | 40 (32–48, media) | Servicio anémico; validación de tope 100 % solo para porcentaje (`create-tax.dto.ts`). Dos fuentes de verdad (esquema en código + catálogo editable) unidas en el validador de factura. `findAll` sin paginación (aceptable por tamaño). | Una sola fuente versionada. |
| 5 Higiene | 55 (45–65, media) | `localization/fiscal/country-tax-schemes.ts` importa `TaxType` de `taxes/entities` (acoplamiento inverso). 1 violación de frontera. | — |
| 6 Calidad | 55 (45–65, media) | Código pequeño, 1 aviso de lint; indentación irregular en `create()`. | — |
| 7 Robustez | 55 (45–65, baja) | Sin operaciones pesadas. | — |
| 8 Seguridad | 65 (55–72, media) | Permisos por operación; `findOne` por `organizationId`; asignación masiva rechazada: `PATCH /taxes/:id {"organizationId":"<otro>"}` → **400 whitelist_validation** (probado). Prueba B→A no ejecutada (throttle). | Prueba de aislamiento automatizada. |
| 9 Pruebas | 15 (8–22, alta) | Solo spec del DTO. | Integración: tipo Fijo, borrado en uso, vigencia. |
| 10 Operabilidad | 25 (15–35, baja) | Sin auditoría de cambio de tasa (quién cambió ITBIS y cuándo). | Auditoría antes/después. |
| 11 UX | 45 (35–55, baja) | Formulario con tope 100 % para porcentaje (`tax-form.page.ts:54`). No verificado en navegador. | — |
| 12 Competitividad | 25 (18–35, media) | Muy por debajo de Odoo/NetSuite (sin cuentas, sin grupos operativos, sin vigencia). | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Parcial | CRUD real, faltan básicas (cuentas, códigos, vigencia). |
| 2 | **No cumple** | Fijo→porcentaje, borrado del estándar. |
| 3 | Parcial | AuthZ declarada; aislamiento B→A no probado. |
| 4 | Parcial | Tope 100 %; no valida tipo vs uso. |
| 5 | No verificado UI | API sin 500. |
| 6 | **No cumple** | Tasas sin vigencia; reducidas ausentes en ≥6 países. |
| 7 | No cumple | 1 spec trivial. |
| 8 | No cumple | Sin auditoría. |
| 9–12 | Global / N/A | — |

## 6. Hallazgos
- **FAC-TX-01** — taxes+invoices / eje 2 — bug fiscal — **alta** — `invoices/invoices.service.ts:603-614` — Un impuesto `type:"Fijo"` (monto) entra como tasa porcentual en la lista de tasas permitidas; probado: ITBIS 50 % aceptado en una factura DO. Forma correcta: filtrar `type='Porcentaje'` y, para fijos, aplicarlos como monto. Riesgo operativo/fiscal. S.
- **FAC-TX-02** — eje 2 — integridad — **alta** — `inventory/contracts/sellable-product.contract.ts:50-56` — la tasa estándar es `MAX(rate)` del catálogo: cualquier tasa mayor registrada (selectivo, lujo) se convierte en tasa por defecto de productos gravados. Forma correcta: bandera `isStandard` o tomarla del esquema del país. S.
- **FAC-TX-03** — eje 3 — multi-país — **alta** — `localization/fiscal/country-tax-schemes.ts` — tasas fijas en código sin vigencia; un cambio legal (EC subió 12→15 % en 2024) exige release y no permite emitir/recalcular documentos de fechas anteriores. Forma correcta: tasas como datos versionados por vigencia. M.
- **FAC-TX-04** — eje 3 — multi-país — **media** — mismo archivo — reducidas ausentes (PE 10 % restaurantes, EC 5 %, CR 1/2/4 %, PA 10/15 %, VE 8 %, HN 18 %); el validador de factura rechaza esas tasas salvo que el tenant las cree a mano (y entonces cualquier tasa vale). Verificar con contador local. M.
- **FAC-TX-05** — eje 2/10 — integridad — **media** — `taxes.service.ts:40-43` — borrado físico sin control de uso ni auditoría; probado borrar "ITBIS 18 %" → 200 (restaurado después por API). S.

## 7. Camino mínimo a producción
1. FAC-TX-01/02 (S). 2. Borrado lógico + bloqueo en uso + auditoría (S). 3. Tasas versionadas por vigencia y resolución por fecha (M, rehacer `country-tax-schemes`). 4. Completar reducidas por país con validación de contador (M). Aplica a los 17 países con IVA nacional.

## 8. Camino a 100
Vigencia (+15, M) → cuentas y códigos oficiales por impuesto (+15, M) → grupos/compuestos e incluido-en-precio (+10, M) → pruebas de integración (+8, S) → auditoría (+5, S).

## 9. Competitividad
Básicas faltantes: vigencia, cuenta contable, código oficial. Fuentes: Odoo docs (alta), Kintsugi/Biz Latin Hub para tasas (media).
Fuentes web consultadas: [Kintsugi LatAm](https://trykintsugi.com/sales-tax-guides/latam), [Kintsugi Perú](https://trykintsugi.com/es-419/sales-tax-guides/latam/peru), [Kintsugi Ecuador](https://trykintsugi.com/es-419/sales-tax-guides/latam/ecuador), [Biz Latin Hub](https://www.bizlatinhub.com/es/insights/panorama-del-impuesto-sobre-el-valor-anadido-en-america-latina/), [Primicias EC](https://primicias.ec/noticias/economia/iva-ecuador-america-latina-impuestos).

## 10. Fortalezas
Tope de 100 % en porcentaje; siembra por país al alta; el catálogo del tenant sí participa en la validación de la factura; US/BR declarados como "configuración requerida" en vez de inventar una tasa.

## 11. No verificado
Aislamiento B→A, UI; cifras de reducidas con una sola búsqueda (confianza media).
