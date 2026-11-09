# 13 · Evaluación multipaís: ¿el producto es nativo en cada mercado?

Fecha: 2026-11-09. Alcance: el código de la rama `ccr-f710ff5b-8ijix4` contra el criterio que fijó el
dueño del producto el 2026-11-09:

> El software se comercializa en toda Latinoamérica y Estados Unidos. No puede estar atado a un país
> específico. Según el país donde se registre el usuario, debe verse y comportarse como nativo de ese
> país, incluso en su idioma. Lo ya implementado no es referencia: si no cumple las mejores
> prácticas (robusto, escalable, seguro), se corrige.

Cada afirmación de este documento cita su evidencia (archivo:línea, consulta o conteo reproducible).
Lo regulatorio de cada país es un punto de partida a **verificar con contador o abogado local**.

## 1. Criterio aplicado

1. **Núcleo sin país.** Ningún módulo genérico decide por un país concreto: lo de un mercado vive en su
   adaptador de régimen o en datos (con vigencia y base legal cuando es regulatorio).
2. **Nativo en cada mercado.** Idioma; vocabulario fiscal y comercial; numeración; documentos;
   impuestos; identificaciones; flujos (notas, anulación); reportes.
3. **Honesto donde no llega.** Lo no implementado se declara en la cobertura y se rechaza con el
   mensaje de ese país, nunca con el de otro.
4. **Integridad en la base de datos** para las invariantes; catálogos regulatorios como datos.
5. **Verificable.** Una puerta de CI que impide que el acoplamiento por país crezca.

## 2. Lo que ya cumple

| Pieza | Evidencia |
|---|---|
| Paquete de país para los 19 mercados que se venden | `contracts/country-pack/country-pack.ts` (`COUNTRY_PACKS`: DO US MX CO BR CL PE AR EC UY PY BO VE PA CR GT SV HN NI) |
| Cobertura declarada por mercado y capacidad | `localization/fiscal/fiscal-coverage.ts`; pantalla Ajustes › Fiscal la recorre sin `if` por país |
| La pantalla de declaraciones y la cobertura dicen lo mismo | `localization/fiscal/fiscal-returns-coverage.spec.ts` (19 mercados) |
| Vocabulario del país = idioma del lector + país del inquilino; un parche solo rige en su país | `libs/shared/ui-i18n/src/lib/locale.store.ts` (`wordingLocale`) |
| Libros en el idioma del país; diarios y cuentas por clave, no por literal | `accounting/provisioning/tenant-bookkeeping.provisioner.ts` (`nameKey`, `booksLanguage`) |
| Plan de cuentas neutral + paquete del país; tasas legales con vigencia y base legal | SP-02, SP-03 (`statutory_tax_rates`) |
| Un adaptador fiscal por mercado detrás de una interfaz | `invoices/adapters/fiscal-adapter.factory.ts` (DGII, CFDI, DIAN, SUNAT, SRI, SII, NF-e, AFIP, genérico) |
| Formato regional por empresa y por persona | `LocaleStore.regionalFormat` |

## 3. Lo que no cumple

**MP-01** · eje 1/3 · Multi-país · **Alta** — Cobertura funcional desigual entre los 19 mercados.
- Evidencia: `coverageFor()` para cada mercado de `supportedCountryCodes()` (2026-11-09). Nómina
  implementada solo en DO; declaraciones periódicas solo en DO (y contabilidad electrónica en MX,
  «necesita configuración»); factura electrónica con credenciales en 8 mercados; **10 mercados (UY, PY,
  BO, VE, PA, CR, GT, SV, HN, NI) solo tienen contabilidad**: sin determinación de impuestos, sin
  factura electrónica, sin retenciones, sin nómina.
- Efecto: un cliente de esos 10 mercados no puede facturar ni pagar nómina conforme a su ley.
- Corrección: plan por mercado (impuestos → e-factura → retenciones → nómina → declaraciones),
  cada uno como adaptador de régimen con datos versionados. Hoja de ruta en §5.

**MP-02** · eje 1 · Multi-país / idioma · **Alta** — Vocabulario nativo incompleto.
- Evidencia: `libs/shared/locales/src/regional/`: parches para 8 de 19 mercados (en-US 1 clave, es-AR 5,
  es-CL 4, es-CO 5, es-DO 54, es-MX 9, es-PE 4, pt-BR 9). **Sin parche: EC, UY, PY, BO, VE, PA, CR, GT,
  SV, HN, NI.**
- Efecto: fuera de RD el usuario lee español neutro: correcto, pero no el término de su país
  (RFC, NIT, RUC, RUT, CUIT; IVA/IGV/ICMS; «boleta», «nota fiscal», «CFDI»).
- Corrección: un parche por mercado con su vocabulario fiscal y comercial, revisado por un hablante
  del país; prueba de completitud por mercado.

**MP-03** · eje 1 · Multi-país / idioma · **Media** — Claves genéricas con vocabulario dominicano.
- Evidencia: 22 claves sin segmento de país cuyo texto nombra términos dominicanos, entre ellas
  `settings.sequences.fiscal_note` («NCF»), `currencies.rates.source_placeholder` («BCRD, DGII»),
  `accounts_payable.capture.intro_attach` («DGII»), `invoices.new.fiscal_group_traditional` («NCF, serie
  B»), `validation.commercial_approval.issuer_rnc_not_valid_format` («RNC»). La puerta las cuenta como
  `wording` (DO 14, más BR 5, PE 2, CO 2, US 2, EC 2, MX 1).
- Corrección: texto neutral en la clave genérica y el término local en el parche del país, o la clave
  movida a un espacio del país (`*.do.*`) cuando solo se muestra allí.

**MP-04** · eje 3 · Multi-país / modelo de datos · **Alta** — Esquema genérico con columnas de la DGII.
- Evidencia: `accounts-payable/entities/vendor-bill.entity.ts`: `ncf`, `ncf_modified`, `ncf_key`,
  `purchase_category`, `isr_retention_type`, `payment_form` (los campos del formato 606 en la factura de
  proveedor de todos los países); `invoices/entities/invoice.entity.ts`: `modification_code` (el
  `CodigoModificacion` de la DGII) e `isElectronicFiscalDocument` (expresión regular del e-NCF dominicano
  en la entidad genérica).
- Efecto: México (DIOT), Perú (PLE), Argentina (Libro IVA Digital), Colombia… no tienen dónde guardar
  sus propias clasificaciones; los de RD se exigen o se muestran donde no aplican.
- Corrección: número del comprobante del proveedor y número modificado con nombres neutrales; las
  clasificaciones de cada régimen en atributos por país validados por su catálogo (el patrón
  `fiscalCodes` que ya usan las líneas de factura); motivos canónicos que cada régimen traduce.

**MP-05** · eje 3 · Multi-país / arquitectura · **Alta** — Lógica de un país en código genérico.
- Evidencia: `npm run verify:country-neutrality` contó **513** ocurrencias en HEAD (`tools/verify/
  country-neutrality.baseline.json`): 465 términos dominicanos en código genérico (las mayores:
  `api/accounts-payable` 115, `web/features/invoices` 62, `web/features/accounts-payable` 54, `web/core` 42,
  `api/compliance` 41, `api/einvoicing` 33) y 15 comparaciones `=== 'XX'`, p. ej.
  `accounts-payable.service.ts:467` y `pos.service.ts:404` (`!== 'DO'`), `einvoicing/services/
  fiscal-range.service.ts:243` (`!== 'PE'`), `einvoicing/services/transmission-config.service.ts:154`
  (`=== 'MX'`), `settings/fiscal/fiscal.page.ts:206`, `settings/finance/einvoicing-regime/
  einvoicing-regime.page.html:3`, `accounting/fiscal-returns/fiscal-returns.page.html:40` (`=== 'DO'`).
  También el cliente enviaba los códigos de la DGII (`modificationCode: '1' | '3'`) desde la pantalla
  genérica de factura.
- Corrección: comportamiento por capacidad del paquete de país o del adaptador; nunca por código de
  país en un módulo genérico. La puerta impide que la cifra suba.

**MP-06** · eje 3 · Multi-país · **Media** — Valores por defecto de un país aplicados en silencio.
- Evidencia: `default: 'DOP'` en `payroll/entities/payroll-run.entity.ts:132`, `payslip.entity.ts:131`,
  `statutory-reference.entity.ts:60`, `hcm/entities/employee-compensation.entity.ts:56`, y
  `payroll-parameters-admin.service.ts:121` (`?? 'DOP'`); 27 `?? 'USD'` cuando falta la moneda base.
- Corrección: la moneda sale del país del inquilino al aprovisionarlo; si falta, error explícito.

**MP-07** · eje 1 · Multi-país · **Media** — Numeración interna no nativa.
- Evidencia: el aprovisionamiento daba `FAC-`, `NC-`, `COT-`, `FP-`, `AS-` a toda empresa (una de Texas
  numeraba «FAC-000001»); los documentos numerados en código mezclan inglés y español (`PO`, `REQ`, `GR`,
  `PAY`, `RFQ` / `AJ`, `TR`, `ND`, `AF`, `DEV`, `CTR`).
- Corrección: prefijos por el idioma de los libros al aprovisionar (hecho para las series de
  `document_sequences`); los demás documentos, por la misma regla, editables por empresa.

**MP-08** · eje 1 · Multi-país / idioma · **Baja** — Texto en español escrito en datos de negocio.
- Evidencia: `procurement/goods-receipts.service.ts:379` («Devolución … de la recepción …»), nota por
  defecto de la nota de crédito («Nota de crédito de la factura …») en `invoices.service.ts`.
- Corrección: por la narrativa de los libros (`LedgerNarrativeService`, idioma de los libros).

**MP-09** · eje 2 · Multi-país / fiscal DO · **Alta** — El 607 restaba dos veces una venta reversada por
nota de crédito total.
- Evidencia: la nota de crédito total deja la factura en `Void`; el 607 excluía todo `Void` y el 608
  declaraba como anulado todo `Void` con NCF, mientras la nota seguía en el 607 restando la venta.
- Corrección (hecha): `invoices.cancellation_mode` distingue anulación comercial, anulación declarada
  y reversión por nota de crédito; el 607 conserva la factura reversada junto a su nota y el 608 solo
  declara anulaciones. A confirmar con contador local.

**MP-10** · eje 1/3 · Multi-país · **Alta** — Notas de débito y anulación sin modelo por país.
- Evidencia: no había nota de débito de venta (FAC-INV-05); «Anular» emitía una nota de crédito total
  en todos los mercados; los constructores de régimen escriben `documentType` de factura para todo lo
  que no es nota de crédito (`einvoicing/regimes/co/dian.builder.ts:71`, `pe/sunat.builder.ts`,
  `cl/sii.builder.ts:163`, `ec/sri.builder.ts:174`…), así que una nota de débito habría salido como
  factura; ningún régimen implementa el evento de anulación ante la autoridad (MX, BR, PE, EC).
  Mi primer diseño de FAC-INV-05 repetía el problema (códigos 01–10 del 608 en un CHECK de la tabla
  genérica, mensaje «formato 608» para todos); se rehízo antes de integrarse.
- Corrección (hecha en parte): motivos canónicos de nota de débito que cada régimen traduce; política
  de anulación por país (`localization/fiscal/document-cancellation.ts`: anulación comercial, anulación
  declarada, solo nota de crédito, evento de la autoridad); catálogos de motivos como datos
  (`fiscal_reason_codes`, con base legal y vigencia; validados por la base de datos para el país del
  inquilino); capacidad declarada en la cobertura y coherente con los adaptadores por prueba.
  Pendiente: notas de débito en los 7 constructores de régimen y el evento de anulación en MX, BR, PE, EC.

**MP-11** · eje 9 · Calidad · **Media** — No había forma de impedir que el acoplamiento por país creciera.
- Corrección (hecha): `npm run verify:country-neutrality` en CI, con línea base que solo baja
  (`tools/verify/country-neutrality.config.mjs`).

## 4. Estándar que se aplica desde ahora a cada corrección

1. Núcleo neutral + adaptador por régimen: el núcleo habla conceptos canónicos (nota de débito,
   motivo de ajuste, anulación, categoría de compra…) y cada régimen los traduce a sus códigos.
2. Comportamiento por capacidad declarada (paquete de país, cobertura, adaptador), no por `country === 'XX'`.
3. Catálogos regulatorios como datos con vigencia y base legal (tasas: hecho; motivos de anulación: hecho;
   categorías y formas de pago de compras: siguiente).
4. Claves de texto neutrales; el término local en el parche del país; un parche por mercado.
5. `verify:country-neutrality` no puede subir; cada bloque que toque un módulo baja su cifra.
6. Una prueba por mercado (tabla de los 19), nunca un ejemplo dominicano como prueba de lo genérico.

## 5. Hoja de ruta multipaís

| Orden | Trabajo | Hallazgos |
|---|---|---|
| 1 | Notas de débito en los constructores DIAN, SUNAT, SII, SRI, AFIP, CFDI (relación 02), NF-e (complementar) | MP-10, FAC-INV-05 |
| 2 | Evento de anulación ante SAT (motivos 01–04), SEFAZ (110111), SUNAT (baja), SRI | MP-10 |
| 3 | Factura de proveedor y nota de crédito con atributos fiscales por país | MP-04 |
| 4 | Retirar las ramas `=== 'XX'` de módulos genéricos (cliente y servidor) | MP-05 |
| 5 | Parches de vocabulario para los 11 mercados sin parche y completar los 7 existentes | MP-02, MP-03 |
| 6 | Valores por defecto y prefijos por país/idioma en todos los documentos | MP-06, MP-07, MP-08 |
| 7 | Determinación de impuestos, e-factura, retenciones y nómina para UY, PY, BO, VE, PA, CR, GT, SV, HN, NI | MP-01 |
