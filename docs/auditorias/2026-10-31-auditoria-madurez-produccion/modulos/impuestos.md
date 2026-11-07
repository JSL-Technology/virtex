# Ficha T08: Impuestos (`taxes`, `localization/fiscal/tax-determination`, `invoices/sales-tax.engine.ts`, frontend `masters/taxes`)

Familia F3. Fecha: 2026-10-31.

> Sin hallazgos críticos de seguridad. IDOR verificado: con la sesión de qa-a, `GET`, `PATCH` y `DELETE /taxes/{id de qa-b}` devuelven 404, y el impuesto de qa-b sigue intacto.

## 1. Identificación

- **Backend:**
  - `taxes/` (6 archivos, 223 LOC, 1 spec): CRUD de `taxes`.
  - `localization/fiscal/tax-determination/` (3 archivos + spec, unas 340 LOC): puerto de determinación con un proveedor por defecto (`TenantJurisdictionProvider`) sobre `tax_jurisdictions`.
  - El cálculo real vive en `invoices/sales-tax.engine.ts` (357 LOC), con el redondeo en `common/money.ts`.
- **Endpoints:**
  - `GET/POST/PATCH/DELETE /taxes`.
  - CRUD `/localization/tax-jurisdictions`.
  - El cálculo se ejecuta dentro de `POST /invoices` y en las notas de crédito.
- **Tablas:**
  - `taxes`: `rate numeric(10,4)`, `type` enum Porcentaje/Fijo, `country_code`. **No tiene vigencia, cuenta contable, naturaleza (IVA/retención/selectivo) ni estado activo.**
  - `tax_jurisdictions`: con vigencia.
- **Frontend:** `features/masters/taxes` (lista y formulario; no recorrida en UI).
- **Países:** los 19. Son núcleo para vender.

## 2. Estándar de referencia

- **Básicas:**
  - Catálogo de impuestos por tenant con naturaleza, cuenta de débito y crédito fiscal, y vigencia.
  - Determinación por línea según producto, cliente (exento o régimen) y jurisdicción.
  - Impuestos compuestos (selectivo sobre la base de IVA, IEPS→IVA).
  - Retenciones por línea y concepto (bienes o servicios).
  - Redondeo según la regla de cada autoridad: por línea (CFDI, e-CF) o por documento (DTE de Chile, IVA = neto × 19 %).
  - Precios con impuesto incluido.
  - Inmutabilidad de lo emitido.
- **US:** tasa por estado/condado/ciudad/distrito, nexo, sourcing de origen o destino, taxability por código de producto, certificados de exención y declaraciones. Líderes: Avalara AvaTax, TaxJar y el motor automático de QuickBooks. Confianza alta en que esto es lo esperado.
- **Invariantes:**
  - El total transmitido es igual al contabilizado.
  - Una tasa nueva no altera lo emitido.
  - La tasa no se toma del cliente.
  - El empate se redondea alejándose de cero cuando la autoridad así lo indica.

## 3. Resultado

- **Madurez: 45** (38–52, confianza media).
- **Preparación: 42, No listo.**
- **Eje más débil:** 3 (multi-país).
- **Críticos:** 0. **Altos:** 4.

## 4. Doce ejes

| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 50 (42–58, media) | El motor es real: la tasa sale del catálogo, el cliente no puede imponerla, y el descuento de documento se prorratea por resto mayor (`sales-tax.engine.ts:225-260`). Pero solo admite **un impuesto por línea más selectivo** y retenciones a nivel de documento. No hay precio con impuesto incluido. | Impuestos múltiples por línea, retención por línea/concepto, precio con impuesto incluido |
| 2 | Corrección e integridad | 45 (38–55, alta en el hallazgo) | Redondeo con error de coma flotante (`IMP-01`, reproducido por API). IVA de Chile por línea (`IMP-02`). Las líneas guardan su tasa, así que el histórico es inmutable (correcto). | Aritmética decimal exacta; redondeo según la regla de cada autoridad |
| 3 | Multi-país | 35 (28–45, media) | Tasas generales correctas. Faltan IEPS, ICA/INC, percepciones y detracciones. En US: sin taxability ni exenciones. Ver la matriz de `localizacion-reglas-pais.md`. | Paquete fiscal por país |
| 4 | Arquitectura | 58 (50–65, media) | Motor puro y testeable, con un puerto de proveedores (`TAX_DETERMINATION_PROVIDERS`). Pero el catálogo `taxes` es una lista de números: el motor usa `taxes.rate` solo como "tasas permitidas" (`invoices.service.ts:586-596`), y el producto lleva su propio `taxRate`. | Modelo `tax_code` con naturaleza, cuentas, vigencia y reglas; producto y cliente referencian códigos, no números |
| 5 | Higiene | 55 (48–62, media) | El motor vive en `invoices/`, no en `taxes/`. `TaxGroup` es una entidad muerta. | Mover el motor a `taxes` y borrar lo muerto |
| 6 | Calidad del código | 68 (60–74, media) | Código limpio, funciones puras, errores localizados | Tipos `Money` en lugar de `number` |
| 7 | Robustez | 62 (55–70, baja) | Una sola consulta de jurisdicciones por documento | Caché de jurisdicciones |
| 8 | Seguridad | 78 (70–84, media) | Permisos `TAXES_*` y filtro por organización; IDOR → 404 (ejecutado) | Bitácora de cambios de tasa |
| 9 | Pruebas | 58 (50–65, media) | Hay specs del motor y de determinación, pero ninguna prueba cubre empates como 1,25 × 18 % ni el redondeo de Chile por documento | Pruebas de propiedad para empates y fixtures oficiales |
| 10 | Operabilidad | 55 (45–60, baja) | Avisos de `NO_NEXUS` y `NOT_DETERMINABLE` en el log; la determinación queda guardada en el documento (`taxDetermination`, verificado) | Métricas |
| 11 | UX | 50 (40–60, baja) | No recorrida | Verificación en la UI |
| 12 | Competitividad | 38 (30–45, media) | Por debajo de Avalara/QuickBooks en US y de Siigo/CONTPAQi en impuestos locales | Ver §9 |

## 5. Compuertas de producción

| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, con capacidades básicas | No cumple | Falta un impuesto múltiple por línea y retenciones por concepto |
| 2 | Integridad | Cumple | Instantánea de tasa e importe por línea; los totales son la suma de líneas ya redondeadas |
| 3 | Aislamiento | Cumple | IDOR → 404 |
| 4 | Validación en servidor | Cumple | Tasa ≤ 100 %; la tasa debe ser del país o del catálogo del tenant (respuesta 400 con 17 % en DO) |
| 5 | E2E sin errores 500 | Cumple | En lo probado no hubo ningún 500 |
| 6 | Cumplimiento por país | **No cumple** | `IMP-01`, `IMP-02`, faltan impuestos locales |
| 7 | CI | Parcial | Las pruebas unitarias corren; las de integración solo con BD |
| 8 | Auditoría de negocio | No verificado | No se comprobó la bitácora de cambios de tasa |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | Solo logs |
| 11 | UI y traducciones | No verificado | UI no recorrida |
| 12 | Documentación | No cumple | Falta documentación operativa |

## 6. Cálculos rehechos a mano (ejecutados)

Pruebas de humo:
- **API:** `POST /invoices` como qa-a (DO, DOP) con líneas QA-F3. Factura `cfdc2980-…`, que quedó emitida con NCF `B0200000001`; es un dato QA y está documentado.
- **Motor puro:** `computeDocument` ejecutado con ts-node, con el script en `scratchpad/f3/calc-entry.ts`.

| Caso | Esperado (a mano) | Obtenido | Resultado |
|---|---|---|---|
| DO, 1 × 1,25 al 18 % (API) | 0,225 → **0,23** (empate alejándose de cero, como afirma `money.ts:76`) | **0,22** | ❌ `IMP-01` |
| DO, 3 líneas de 0,25 al 18 % | Por línea: 0,05 × 3 = 0,15; por documento: 0,135 → 0,14 | 0,15 (por línea) | ✅ coherente con la regla elegida para DO |
| CO, 42,50 al 19 % | 8,075 → 8,08 | 8,07 | ❌ `IMP-01` |
| CL, 3 × 1 003 CLP al 19 % | Regla del SII: IVA = round(3 009 × 0,19) = round(571,71) = **572** | 573 (191 × 3) y el DTE escribe `IVA` = 573 (`cl/sii.builder.ts:120-125`) | ❌ `IMP-02` |
| DO, descuento de documento 10 %, retención ITBIS 30 %, ISR 10 % (servicio gravado 999,99 + servicio exento 500) | Base gravada 899,99, ITBIS 162,00, ITBIS retenido 48,60, ISR 10 % sobre 1 349,99 = 135,00 | Iguales | ✅ (verificar con un contador si el ISR alcanza líneas exentas o de bienes) |
| DO, tasa 17 % (API) | Rechazo | 400 `tax_rate_rate_not_valid_country`, permitidas "18 %, 16 %, 0 %, **7 %**" | 🟡 Otro auditor creó un 7 % en qa-a: cualquier tasa que el tenant cree pasa a ser "legal" (`IMP-05`) |
| US, cliente en Austin TX, 3 × 19,99, el cliente envía 40 % (API) | Jurisdicciones QA-F3: TX 6,25 % + ciudad 1 % + especial 1 % = 8,25 % → 59,97 × 0,0825 = 4,9475 → 4,95 | tax 4,95; `taxDetermination.components` registrado; el 40 % se ignoró | ✅ |
| US, sin jurisdicciones (API) | Sin nexo, impuesto 0, con motivo | `NO_NEXUS`, impuesto 0 | ✅ |
| País desconocido "XX", 33 % (motor puro) | Rechazo | Aceptado | 🟡 Mitigado por el alta |

**Búsqueda sistemática de empates** (`scratchpad/f3`): con bases en centavos, la función `toCents` falla en una fracción de los empates al 18 %, 19 %, 15 %, 21 % y 10,5 % (por ejemplo 1,25 al 18 %, 5,75 al 18 %, 42,5 al 19 %, 1,5 al 15 % y 21,5 al 21 %). Al 16 %, 13 % y 8 % no hubo fallos en el rango probado.

**¿Cambiar una tasa altera documentos históricos?** No: `invoice_line_items` guarda `taxRate`, `taxableBase` y `taxAmount`. Sin embargo, `taxes` no tiene vigencia, de modo que al editar el 18 % se pierde a qué tasa correspondía cada período. Además, `DELETE /taxes/:id` es un borrado físico (`taxes.service.ts:41`).

## 7. Hallazgos

**IMP-01 · El redondeo "alejándose de cero" falla en empates por coma flotante** · ejes 2 y 3 · bug · **Alta**
- **Ubicación:** `common/money.ts:77-84` (`toCents`: `Math.round(Math.abs(amount * factor))`), que usan todos los cálculos de impuestos, totales y e-CF.
- **Qué está mal:** `1.25 * 0.18 = 0.22499999999999998` en IEEE-754, así que el resultado es 0,22 cuando lo correcto es 0,23. Reproducido por API en qa-a (`taxAmount: 0.22`). Afecta a todos los países con tasas del 18 %, 19 %, 15 %, 21 % y 10,5 %. La desviación es de 1 centavo por línea, pero es sistemática. El e-CF y el XML de la autoridad no cuadrarán con el recálculo, y si el validador aplica tolerancia depende de cada autoridad (verificar).
- **Forma correcta:** aritmética decimal (enteros escalados a partir de la representación en cadena, o una librería decimal). Por ejemplo `Math.round(Number((amount*factor).toPrecision(15)))`, o calcular `base_minor * rate_bp` en enteros. Añadir una prueba de propiedad.
- **Impacto:** riesgo operativo y fiscal. **Esfuerzo:** S.

**IMP-02 · IVA de Chile calculado por línea, cuando el SII lo exige sobre el neto** · eje 3 · multi-país · **Alta** (CL)
- **Ubicación:** `sales-tax.engine.ts:240-262` y `einvoicing/regimes/cl/sii.builder.ts:120-125`.
- **Qué está mal:** con 3 líneas de 1 003 CLP, el sistema da IVA 573 cuando corresponden 572. Que el DTE calcula `IVA = MntNeto × TasaIVA` a nivel de documento lo afirmo con confianza media: verificar con un contador local y con el formato DTE del SII.
- **Forma correcta:** estrategia de redondeo por país (por línea o por documento) declarada en el pack del país.
- **Esfuerzo:** S–M.

**IMP-03 · No hay impuestos múltiples por línea ni retenciones por concepto** · eje 1 · funcionalidad · **Alta**
- **Qué está mal:** cada línea admite una sola tasa más selectivo, y las retenciones son un porcentaje del documento (`taxWithholdingRate`, `incomeTaxWithholdingRate`). En consecuencia no se puede modelar: IVA + IEPS por cuota, ni las retenciones de IVA 2/3 y de ISR 10 % por concepto en MX; IVA + INC, ReteFuente por concepto, ReteIVA y ReteICA en CO; ICMS + IPI + PIS/COFINS en BR; detracciones en PE.
- **Forma correcta:** líneas de impuesto (`invoice_line_taxes`) generadas por reglas.
- **Esfuerzo:** L.

**IMP-04 · El catálogo `taxes` carece de modelo fiscal** · eje 4 · arquitectura · **Alta**
- **Qué está mal:** no tiene naturaleza, cuentas contables, vigencia, estado activo ni código de la autoridad. El motor solo lo usa como lista de tasas admitidas, y el producto guarda un número (`taxRate`) en lugar de un código de impuesto.
- **Esfuerzo:** L (rehacer el modelo, conservando el motor).

**IMP-05 · El tenant puede volver "legal" cualquier tasa** · eje 3 · **Media**
- **Ubicación:** `allowedTaxFractions` (`sales-tax.engine.ts:156-175`) une las tasas del país con las del catálogo del tenant.
- **Qué está mal:** basta con crear un impuesto al 7 % en un tenant DO para que el 7 % se acepte en una factura con ITBIS. La flexibilidad tiene sentido (decretos entre releases), pero falta advertirlo y dejar rastro de auditoría.
- **Esfuerzo:** S.

**IMP-06 · US sin taxability ni certificados de exención, y sin declaración** · eje 3 · **Media** (para un piloto US)
- **Evidencia:** grep `exemptionCertificate|taxability|taxCode` sin resultados. Solo existe el tratamiento `EXEMPT` por producto.
- **Esfuerzo:** L, o integrar un proveedor mediante el puerto existente.

**IMP-07 · Borrado físico de impuestos y sin vigencia** · eje 2 · **Media**
- **Ubicación:** `taxes.service.ts:41`.
- **Forma correcta:** desactivación lógica y `valid_from/valid_to`.
- **Esfuerzo:** S.

## 8. Camino mínimo a producción

1. `IMP-01` (S).
2. `IMP-02` y una estrategia de redondeo por país (S–M).
3. Para DO: retención de ISR solo sobre servicios (verificar con un contador; S).
4. `IMP-07` (S).
5. Para vender en MX o CO: `IMP-03` y `IMP-04` (L).

## 9. Camino a 100

| Ítem | Puntos | Esfuerzo | Tipo |
|---|---|---|---|
| Modelo de código de impuesto con reglas y vigencia | +12 | L | Rehacer el modelo |
| Líneas de impuesto múltiples y retenciones por concepto | +12 | L | Ampliación |
| Redondeo decimal exacto y por país | +6 | S | Retocar |
| Proveedor US (Avalara/TaxJar) y exenciones | +6 | L | Ampliación |
| Precio con impuesto incluido | +3 | M | Ampliación |
| Fixtures oficiales | +4 | M | Nuevo |

## 10. Competitividad

- **Brechas básicas:** impuestos compuestos y retenciones por concepto, que traen todos los líderes locales.
- **Fortaleza diferencial:** el motor puro con prorrateo exacto del descuento y la determinación US con traza de componentes.
- **Nota:** 38 (30–45, media).

## 11. Fortalezas

- La tasa nunca viene del cliente.
- Los totales son la suma de partes ya redondeadas, y el descuento se asigna por resto mayor.
- El rechazo de tasas ajenas al país es localizado.
- Las líneas guardan una instantánea de la tasa.
- En US, nexo y sourcing funcionan (verificado).

## 12. No verificado

- La tolerancia de redondeo de cada autoridad.
- La UI `masters/taxes`.
- La bitácora de cambios de tasa.
- Las notas de crédito (recálculo proporcional; código leído en `invoices.service.ts:1215-1250`, no ejecutado).

**Cobertura:**
- Archivos: 100 % de `taxes`, 100 % de `tax-determination`, 100 % de `sales-tax.engine.ts` y aproximadamente un 25 % de `invoices.service.ts`.
- Endpoints: los 5 de `taxes` (IDOR) y `POST /invoices` ×4.

<!-- RESUMEN: modulo=impuestos; madurez=45; prep=42; veredicto=No listo; eje_debil=Multi-país y cumplimiento; criticos=1; altos=3; camino_min=M -->


## Ajuste de calibración del coordinador (Paso 9)

**IMP-01 se eleva de alta a crítica** (cálculo fiscal incorrecto en empates de redondeo; reproducido por el coordinador con el mismo algoritmo de `common/money.ts:77-84`). Las notas (45/42) respetan los topes; veredicto «No listo» sin cambios.
