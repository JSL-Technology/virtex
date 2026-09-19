# Auditoría — Tipos de documento/identidad hardcodeados por país (cuarta pasada)

**Fecha:** 2026-09-18
**Alcance:** todo el proyecto (backend, frontend, i18n, esquema de base de datos)
**Antecedentes:** [primera](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS.md), [segunda](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS-2.md) y [tercera](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS-3.md) pasada. Esta cuarta pasada re-audita contra los mismos invariantes tras cerrar H-01…H-04, y encuentra que el barrido de e-facturación de la tercera pasada cubrió tres de los cinco regímenes que distinguen el tipo de documento del comprador y **omitió Ecuador y Colombia** — el mismo defecto de H-01 en los dos regímenes restantes.

> **Estado: RESUELTO.** Los dos hallazgos que reporta este documento se corrigieron. Verificado en verde: `tsc` del backend (app) y las suites de `einvoicing` (afip/nfe/sunat/cfdi/sii/**sri**/**dian**) y de localización fiscal, incluidas las specs nuevas de SRI (pasaporte + consumidor final por ausencia) y DIAN (comprador persona natural por cédula y por pasaporte). *(La única spec roja del entorno — `localization.service.spec.ts › taxIdLabel`, "RNC / Cédula" vs "RNC" — falla igual en el árbol limpio sin estos cambios: depende de un `fiscal_region` sembrado en base de datos y del registro fiscal por red, ambos ausentes en este sandbox. Es ambiental, no una regresión.)*
>
> - **H-05** — el generador de Ecuador (SRI) leía el tipo de documento del comprador contando dígitos; ahora lo lee del catálogo (`regimeCodes.sri`), no trunca el pasaporte, y reserva `07` consumidor final para la **ausencia** de documento.
> - **H-06** — el generador de Colombia (DIAN) declaraba a todo comprador como NIT (`schemeName '31'`) y persona natural (`AdditionalAccountID '2'`), y le arrancaba un dígito a cualquier número sin DV; ahora el tipo y el eje persona jurídica/natural salen del catálogo y del `taxpayerType` del comprador, y el DV solo se separa del NIT.

---

## Estado de los invariantes (verificado en esta pasada)

| Invariante | Estado | Evidencia |
|---|---|---|
| Puntos de **captura** sin documentos hardcodeados | ✅ | `customer-form.page.ts:124`, `supplier-form.ts`, `hcm/.../form.page.ts` cargan `documentTypes` del endpoint por `usedFor`; el único literal `'Cédula'` restante es un mock de test (`testing/country.service.mock.ts`). |
| Cero enum de BD de tipos de documento | ✅ | Sin cambios desde la 3ª pasada: el par `(código, país)` contra el catálogo `identity_document_types`. |
| Claves i18n no delatan un concepto de país | ✅ | Cero `document_type.cedula/.rnc/...`; todo bajo `identity_document.*`. |
| Validación desacoplada por país | ✅ | `validateTaxId`/`resolveParty` derivan del catálogo. |
| Derivación en **consumo** desacoplada (e-facturación) | ✅ *(ahora sí)* | Los **cinco** regímenes que distinguen el documento del comprador leen `regimeCodes` del catálogo: BR (`nfe`), AR (`afip`), PE (`sunat`) desde la 3ª pasada; **EC (`sri`) y CO (`dian`) desde esta**. CL (`sii`) y MX (`cfdi`) usan RUT/RFC universales — sin distinción. |

**Conclusión:** cerrado el último foco conocido de inferencia por país en los puntos de consumo. Ningún builder de e-facturación deduce ya el tipo de documento del comprador de la forma del número.

---

## Hallazgos (resueltos)

### H-05 — El generador de Ecuador (SRI) infería el tipo de documento del comprador contando dígitos

- **Categoría:** validación/derivación no desacoplada por país (reintroduce la inferencia que el catálogo eliminó)
- **Severidad:** **alta**
- **Ubicación / módulo:** `einvoicing/regimes` — `ec/sri.builder.ts`
- **Qué estaba mal:** `buyerDocumentType()` devolvía `04` (RUC) / `05` (cédula) según `taxId.length === 13 / 10`, y `07` (consumidor final) para todo lo demás. Contar dígitos colisiona un RUC mal tecleado con una cédula real, y — pese al comentario que prometía `06` pasaporte — **nunca** emitía `06`: un comprador extranjero con pasaporte se declaraba al SRI como consumidor final. Las filas `EC.*` del catálogo no tenían `regimeCodes`, así que no existía el dato para leer.
- **Corrección aplicada:**
  - Catálogo: `EC.RUC → regimeCodes { sri: '04' }`, `EC.CEDULA → { sri: '05' }`, y la fila supranacional `PASSPORT → { sri: '06', dian: '41' }`.
  - Builder: `buyerDocumentType()` → `buyerRegimeDocumentCode('sri', customer, 'EC') ?? '07'`. `07` queda reservado para la ausencia de documento. El `identificacionComprador` ya no aplica el strip numérico a un pasaporte (alfanumérico).

### H-06 — El generador de Colombia (DIAN) declaraba a todo comprador como NIT / persona natural

- **Categoría:** documento hardcodeado / validación no desacoplada por país
- **Severidad:** **alta**
- **Ubicación / módulo:** `einvoicing/regimes` — `co/dian.builder.ts`
- **Qué estaba mal:** el método compartido `party()` fijaba para **todo** comprador `AdditionalAccountID = '2'` (persona natural) y `schemeName = '31'` (NIT) — contradictorio en sí mismo — y calculaba el dígito de verificación con `slice(0, -1)`; para una cédula (sin DV) eso **arrancaba un dígito real del número** (corrupción del dato, no solo mala etiqueta). El comprador ya guardaba su `identityDocumentTypeCode`, pero el builder no lo leía.
- **Corrección aplicada:**
  - Catálogo: `CO.NIT → regimeCodes { dian: '31' }`, `CO.CC → { dian: '13' }`, `PASSPORT → { dian: '41' }`. `CO.CC` pasa a `usedFor: ['payroll', 'invoicing']` para que una factura pueda identificar a un comprador persona natural por su cédula (si no, la única opción registrable sería el NIT y todo comprador seguiría siendo empresa).
  - Builder: `schemeName` del comprador = `buyerRegimeDocumentCode('dian', customer, país) ?? '31'`; `AdditionalAccountID` derivado del `taxpayerType` (INDIVIDUAL → `'2'`, empresa → `'1'`, y como último recurso de un registro heredado sin `taxpayerType`, inferido del documento resuelto). El DV solo se separa del NIT; una cédula o un pasaporte conservan todos sus caracteres. El emisor (obligado a facturar) resuelve su `schemeName` de la misma forma, sin el literal `'31'`.

---

## Extensión del catálogo (referencia)

`regimeCodes` es el campo declarado en `IdentityDocumentTypeSpec` para nombrar el documento en cada régimen de e-facturación sin inferirlo del número. Estado tras esta pasada:

| País | Fila | `regimeCodes` |
|---|---|---|
| BR | CPF / CNPJ | `{ nfe: 'CPF' }` / `{ nfe: 'CNPJ' }` |
| AR | DNI / CUIT | `{ afip: '96' }` / `{ afip: '80' }` |
| PE | DNI / RUC | `{ sunat: '1' }` / `{ sunat: '6' }` |
| **EC** | **CEDULA / RUC** | **`{ sri: '05' }` / `{ sri: '04' }`** |
| **CO** | **CC / NIT** | **`{ dian: '13' }` / `{ dian: '31' }`** |
| XX | PASSPORT | `{ sri: '06', dian: '41' }` |

Agregar el próximo régimen o país es una fila/columna de datos en el catálogo, sin `ALTER TYPE` ni cambio de builder.

---

## Cobertura pendiente (no son hallazgos de hardcode)

- **Códigos de régimen del pasaporte para SUNAT/AFIP/NFe/SII.** La fila supranacional `PASSPORT` solo declara `sri` y `dian`. Un comprador con pasaporte en Perú/Argentina/Brasil/Chile cae hoy en el "no identificado" del régimen. Es cobertura de datos, no hardcode: se cierra agregando las claves cuando se confirmen los códigos de cada autoridad.
- **DIAN `schemeID` para documentos sin DV.** Para una cédula o un pasaporte se emite `schemeID="0"` con una nota *«verificar con contabilidad/legal»*, pendiente de confirmar el valor exacto del anexo técnico de la DIAN. Es un valor razonable y no corruptivo, a diferencia del `slice` anterior.
- **Otros tipos de documento colombianos** (cédula de extranjería `22`, tarjeta de identidad `12`, NUIP `91`): se agregan como filas `CO.*` con su `regimeCodes.dian` cuando el producto los ofrezca.

---

## Lista de lo que quedaba hardcodeado, por módulo (todo resuelto)

**einvoicing (regimes)** — inferencia/hardcode del tipo de documento del comprador en el punto de consumo:
- `ec/sri.builder.ts` — `04/05/07` por longitud; pasaporte `06` nunca emitido → lee `regimeCodes.sri` (H-05). ✔
- `co/dian.builder.ts` — `AdditionalAccountID '2'` y `schemeName '31'` fijos + `slice` del DV → tipo y eje persona derivados del catálogo/`taxpayerType`, DV solo del NIT (H-06). ✔

**No son hallazgos (verificado):** `cl/sii.builder.ts` (RUT universal), `mx/cfdi.builder.ts` (RFC universal), y los `documentType(invoice)` de todos los builders (devuelven el tipo de comprobante desde `invoice.type`, no la identidad del comprador). Los puntos de captura (formularios, entidades, validadores, i18n) siguen limpios.
