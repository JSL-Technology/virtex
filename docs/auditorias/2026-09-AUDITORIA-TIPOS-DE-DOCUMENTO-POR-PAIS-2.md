# Auditoría — Tipos de documento e identificadores hardcodeados por país (segunda pasada)

> **Método.** Lectura estática de todo el monorepo (`apps/backend/api`, `apps/core/client-web`,
> `apps/pos`, `apps/desktop`, `libs/shared`, `tools/`, migraciones y catálogos i18n). Cada hallazgo
> cita archivo, línea y el literal exacto encontrado. No se ejecutó la aplicación: las afirmaciones
> sobre comportamiento se derivan del código citado.
>
> **Fecha:** 2026-09-17 · **Rama:** `claude/audit-hardcoded-document-types-vv2vf1`
> **Estado del árbol auditado:** posterior a la corrección de la primera pasada
> (`29df499`, PR #77), que ya está en esta rama.
> **Alcance:** todo el proyecto, no un módulo.

> **Relación con la auditoría anterior.** `2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS.md`
> encontró 19 hallazgos y los corrigió. **Esta segunda pasada confirma esa corrección y no la
> revierte**: el catálogo `identity_document_types` existe, tiene la forma correcta, es la fuente
> única para RR.HH., Ventas y Compras, y los tres enums de PostgreSQL que bloqueaban el alta de
> países están retirados. Lo que sigue es lo que **no** quedó cubierto, más lo que la corrección
> dejó parcialmente hecho. El defecto ya no es «no hay catálogo». Es que hay **cuatro conceptos
> vecinos** —la identidad fiscal del propio tenant, el tipo de comprobante fiscal, el identificador
> de seguridad social y el tipo de documento de la contraparte en el XML fiscal— que **siguen cada
> uno con su propia implementación hardcodeada**, y que el catálogo bueno, poblado con los datos de
> diez de diecinueve mercados, todavía no puede sostener un alta real en esos diez.

---

## 0. El estándar, antes de juzgar el código

Un modelo de datos correcto para «tipo de documento / identificador» tiene esta forma. Se fija
antes de mirar el código para que el juicio no se acomode a lo que ya existe.

1. **Es un catálogo, no un enum.** Una tabla, o una configuración versionada que se carga como
   datos. Nunca un `ENUM` de PostgreSQL ni un *union type* fijo en TypeScript. El criterio
   operativo: **dar de alta un país es insertar filas, no correr una migración ni desplegar
   código.**
2. **Cada entrada pertenece a una jurisdicción.** La clave natural es `(país, código)`. No existe
   «el tipo de documento» en abstracto: existe la cédula de ciudadanía colombiana, que no es la
   cédula dominicana ni la cédula jurídica costarricense.
3. **La regla de validación viaja con la entrada.** Formato, longitud y —cuando lo hay— el
   algoritmo de dígito verificador se resuelven *desde la fila*, no desde un `switch (país)`
   disperso. Un algoritmo no cabe en una columna, pero sí cabe su **nombre**: la fila declara
   `checksum: 'cl_rut_mod11'` y un registro de funciones lo resuelve. Un país que reusa un
   algoritmo existente cuesta una fila y cero código.
4. **La opcionalidad es un dato, no un supuesto.** El catálogo distingue *obligatorio*, *opcional*
   e *inexistente* por país y por contexto de uso, y **alguien lo hace cumplir**. Un `requirement`
   almacenado que nadie lee no modela la opcionalidad: la documenta.
5. **Aplica a persona física, jurídica o ambas.** Un RNC no identifica a un empleado; un CPF no
   identifica a una empresa. El formulario filtra por esto.
6. **La etiqueta es una clave i18n, no una palabra** —salvo la terminología que la autoridad
   imprime, que debe sobrevivir intacta a la traducción porque el usuario la está copiando de un
   papel.
7. **El formulario y el validador consultan el mismo catálogo, filtrado por el país de la cuenta.**
   Ni el componente ni el DTO conocen ningún nombre de documento. Esa identidad de fuente es lo que
   impide que deriven.
8. **La etiqueta sigue a la jurisdicción, no al idioma del lector.** Un controlador anglófono en
   una empresa dominicana rellena un **RNC**. Leer la interfaz en inglés no muda la empresa a
   Delaware. Un catálogo de traducción *no puede* expresar esto, porque su clave es el locale.

Todo lo que sigue se mide contra esto.

---

## 1. Resumen ejecutivo

**Lo que está bien, y conviene no tocar.** `identity_document_types` es un catálogo correcto:
clave natural `(country_code, code)`, etiqueta como clave i18n con excepción explícita para la
terminología de la autoridad, patrón, **nombre** del algoritmo de dígito verificador resuelto por
`CHECKSUM_ALGORITHMS`, `applies_to` ternario, ventana de validez, contexto de uso, y los
vocabularios cerrados como `CHECK` en vez de enums de PostgreSQL —de modo que se pueden reescribir
dentro de una transacción. `IdentityDocumentService.resolveParty()` es una sola rutina que usan
RR.HH., Ventas y Compras. Eso es exactamente la forma del §0.

**Lo que falta.** Cinco cosas, en orden de gravedad:

1. **El identificador fiscal del propio tenant no pasa por ese catálogo.** Vive en
   `COUNTRY_FISCAL_PROFILES`, una constante de TypeScript con `label: 'RNC / Cédula'` escrito a
   mano, y se valida con `TAX_ID_RULES`, un `Record<país, …>` también en código. Añadir un país
   sigue costando un despliegue **para la identidad de la empresa**, aunque ya no para la de un
   empleado. Y la pantalla que guarda ese identificador —Ajustes → Perfil de empresa— **no lo
   valida en absoluto**.
2. **El tipo de comprobante fiscal repite el defecto entero, un año después.** El enum de
   PostgreSQL se retiró, pero `enum NcfType` sigue en TypeScript, sigue tipando la columna, y sigue
   custodiando el borde HTTP con `@IsEnum(NcfType)` + `@Matches(/^[BE]\d{2}$/)`. La tabla catálogo
   `fiscal_document_type_definitions` existe y **solo tiene República Dominicana**. La única
   pantalla para registrar rangos autorizados es dominicana, con diez códigos DGII escritos en el
   componente, y a los otros dieciocho mercados les muestra un aviso de que la página no les aplica.
3. **El identificador de seguridad social es el mismo defecto en otro eje.** El catálogo de reglas
   (`statutoryIdentifiers`) vive en código, **existe para un solo país**, ningún controlador lo
   expone y ningún formulario lo lee. El cliente pinta tres campos fijos con tres claves i18n fijas
   y los renombra por locale — que es, literalmente, `document_type.cedula` otra vez. Peor:
   `regional.json:61` presenta la regla dominicana de 7–11 dígitos como si fuera la del IMSS
   mexicano, en un mercado donde ningún código la comprueba.
4. **El catálogo bueno está poblado a medias.** Diez de diecinueve mercados llevan **una sola
   fila**: su identificador fiscal, marcado `appliesTo: 'both'`, `requirement: 'required'` y
   `usedFor: ['payroll', …]`. En Ecuador eso significa pedirle un RUC de 13 dígitos a cada
   trabajador. La auditoría anterior aparcó esto de forma explícita y razonada; el encargo de ésta
   dice que el sistema debe funcionar para cualquier usuario de cualquier país soportado **desde el
   día 0** y que eso no se pospone. Se reporta, por tanto, como hallazgo abierto.
5. **Nada impide la regresión.** No hay ningún verificador en `tools/` que prohíba un literal de
   documento fuera del catálogo, ni que exija que cada país soportado tenga al menos una entrada
   para persona física y una para jurídica, ni que un `@IsEnum` sobre un código fiscal esté acotado
   por país. Los diecinueve hallazgos de la primera pasada se corrigieron a mano y se pueden
   deshacer a mano.

**Evidencia de que sigue faltando una fuente de verdad única.** El mismo repositorio contiene, hoy,
estas cuatro respuestas a «¿qué documento identifica a esta parte?»:

| Quién pregunta | Dónde lo resuelve | Es datos |
|---|---|---|
| RR.HH., Ventas, Compras | `identity_document_types` vía `IdentityDocumentService` | **Sí** |
| Registro, subsidiarias, perfil de empresa | `COUNTRY_FISCAL_PROFILES` + `TAX_ID_RULES` (código) | No |
| Nómina (seguridad social) | `statutoryIdentifiers` en una estrategia de un país (código) | No |
| Facturación electrónica (documento del comprador) | **longitud del número** en cada builder | No |

Y dos respuestas contradictorias en dos archivos vecinos sobre si `NcfType` puede custodiar un
borde HTTP: `issue-invoice.dto.ts:11-16` explica por qué **no** debe, y
`provision-ncf-sequence.dto.ts:9` lo hace.

---

## 2. Hallazgos críticos

### C-01 · Falta de catálogo único · La identidad fiscal del tenant vive en una constante de TypeScript, paralela al catálogo

- **Categoría:** falta de catálogo único / documento hardcodeado
- **Severidad:** **crítica**
- **Ubicación:** `apps/backend/api/src/app/localization/fiscal/country-profiles.ts:715-716`,
  `:751`, `:768`, `:785`, `:805`, `:821`, `:842`, `:867`, `:887`, `:896`, `:905`, `:923`, `:932`,
  `:941`, `:950`, `:968` · módulo Localización, consumido por Registro, Organizaciones y Facturación

**Qué está mal.** Diecinueve perfiles de país declaran su identificador fiscal como literales en
código:

```ts
// country-profiles.ts:715-716 — República Dominicana
taxId: { label: 'RNC / Cédula', example: '131-12345-7', pattern: '^\\d{3}-?\\d{5}-?\\d$|^\\d{11}$', hasCheckDigit: true },
individualDocument: { code: 'CEDULA', label: 'Cédula', pattern: '^\\d{11}$' },

// country-profiles.ts:932 — Costa Rica
taxId: { label: 'Cédula jurídica', example: '3101123456', pattern: '^\\d{9,12}$', hasCheckDigit: false },
```

`'RNC / Cédula'`, `'Cédula jurídica'`, `'CUIT'`, `'CNPJ'`, `'RUC'`, `'NIT'`, `'RFC'`, `'RUT'` son
nombres de documentos específicos de un país escritos directamente en el código, en un archivo que
hay que editar y desplegar para dar de alta un mercado. Es el mismo hallazgo que la primera pasada
resolvió para el empleado, **en el objeto que identifica a la empresa que paga la suscripción**.

El agravante es que la corrección anterior ya creó el catálogo correcto y lo dejó *derivando de*
esta constante: `identity-document-catalogue.ts:63` importa `COUNTRY_FISCAL_PROFILES`. De modo que
el catálogo bueno tiene, como antecedente, el catálogo malo.

`individualDocument` está marcado `@deprecated` en `public-country-config.ts:53-58` y **ya** se
deriva del catálogo en `localization.service.ts:307`. Pero `taxIdLabel`, `taxIdExample`,
`taxIdPattern` y `taxIdHasCheckDigit` (`localization.service.ts:296-299`) siguen leyéndose del
perfil. La migración se hizo a medias: el documento de la persona física viene del catálogo, el de
la empresa no.

**Cómo se ve la forma correcta.** `COUNTRY_FISCAL_PROFILES` deja de declarar `taxId`. El
identificador fiscal de la empresa es una fila más de `identity_document_types` con
`appliesTo: 'company'` y `usedFor` incluyendo `'registration'` — que es lo que ya es, duplicada.
`PublicCountryConfig.taxIdLabel` y sus tres compañeras desaparecen: el formulario de registro lee
`identityDocumentTypes` filtrado por `usedFor: 'registration'`, igual que el formulario de cliente
lee el suyo. Queda un solo sitio donde consta que un RNC dominicano son nueve dígitos.

---

### C-02 · Validación no desacoplada por país · La identidad fiscal del tenant se valida con un `Record<país, …>` en código, no con el catálogo

- **Categoría:** validación no desacoplada por país
- **Severidad:** **crítica**
- **Ubicación:** `apps/backend/api/src/app/localization/fiscal/tax-id-validators.ts:684-769`
  (`TAX_ID_RULES`), `:793` (`validateTaxId`), `:806` (`canonicalizeTaxId`) · módulo Localización

**Qué está mal.** `TAX_ID_RULES` es un mapa cerrado de diecinueve claves de país, cada una apuntando
a una función de validación distinta:

```ts
export const TAX_ID_RULES: Readonly<Record<string, TaxIdRules>> = {
  DO: { validate: byLength(isValidDominicanTaxId, …, 9, 11), canonicalize: canonicalDigits, kindAffectsValidation: true },
  US: { … },
  MX: { … },
  CO: { validate: isValidColombianNit, … },
  …
};
```

Añadir el país número veinte es editar este archivo y desplegar. Es exactamente el criterio
operativo del §0 punto 1, incumplido.

Lo notable es que **el propio repositorio ya demostró que esto es evitable**.
`document-checksums.ts:78-110` toma las mismas veintiuna funciones de este archivo y las hace
direccionables por nombre, de modo que la fila del catálogo declara `checksum: 'co_nit_mod11'` y un
país nuevo que reuse un algoritmo existente cuesta cero código. La solución está escrita, probada
(`identity-document-catalogue.spec.ts` verifica que todo nombre citado resuelva) y **el camino del
tenant no la usa**.

Segundo problema, dentro del mismo: la elección de algoritmo por `TaxpayerKind` está resuelta con
`byLength()` y `byPrefix()` (`:647`, `:660`), helpers que deciden **por la longitud o el prefijo
del valor tecleado** cuál de los dos documentos del país es. El catálogo ya sabe cuál es cuál:
`DO.RNC` y `DO.CEDULA` son dos filas con dos patrones y dos checksums. Inferirlo del valor es
adivinar lo que el modelo de datos ya afirma.

**Cómo se ve la forma correcta.** `validateTaxId(country, value, kind)` desaparece como función
autónoma. El registro llama a `IdentityDocumentService.resolveParty({ appliesTo: kind, usedFor:
'registration', fallbackCountry: country })`, que es la rutina que ya usan los otros tres módulos.
`tax-id-validators.ts` se queda con lo único que es genuinamente código —las veintiuna funciones
aritméticas— y pierde el mapa de países, que pasa a ser filas.

---

### C-03 · Enum rígido · El tipo de comprobante fiscal salió del esquema pero sigue custodiando el borde HTTP

- **Categoría:** enum rígido / validación no desacoplada por país
- **Severidad:** **crítica**
- **Ubicación:**
  `apps/backend/api/src/app/compliance/entities/ncf-sequence.entity.ts:4-23` (`enum NcfType`),
  `:98` (`type: NcfType`),
  `apps/backend/api/src/app/compliance/dto/provision-ncf-sequence.dto.ts:9-13`,
  `apps/backend/api/src/app/einvoicing/dto/void-sequence-range.dto.ts:7`
  · módulos Cumplimiento y Facturación electrónica

**Qué está mal.** La primera pasada retiró el `ENUM` de PostgreSQL y la columna es hoy un
`varchar(8)`. El comentario que lo documenta (`ncf-sequence.entity.ts:84-96`) es correcto en lo que
afirma. Pero lo que no dice es que el enum **sigue existiendo en TypeScript** con los dieciséis
códigos de la DGII:

```ts
export enum NcfType {
  B01 = 'B01', B02 = 'B02', B03 = 'B03', B04 = 'B04', B11 = 'B11', B15 = 'B15',
  E31 = 'E31', E32 = 'E32', E33 = 'E33', E34 = 'E34',
  E41 = 'E41', E43 = 'E43', E44 = 'E44', E45 = 'E45', E46 = 'E46', E47 = 'E47',
}
```

…que sigue tipando la columna (`type: NcfType`, línea 98), y —esto es lo que convierte una molestia
en un bloqueo— **sigue custodiando el endpoint que da de alta un rango autorizado**:

```ts
// provision-ncf-sequence.dto.ts:9-13
@IsEnum(NcfType)
type: NcfType;

@IsString()
@Matches(/^[BE]\d{2}$/, { message: 'validation.provision_ncf_sequence.prefix_must_follow_dgii_series_format' })
```

Un tenant peruano no puede registrar una serie `01`. Uno chileno no puede registrar un DTE `33`.
Uno mexicano no puede registrar nada, porque `I` y `E` no casan con `/^[BE]\d{2}$/`. El esquema
admite el valor y el DTO lo rechaza antes de llegar: se movió el enum una capa hacia arriba, no se
retiró. Lo mismo en `void-sequence-range.dto.ts:7`.

**El repositorio ya sabe que esto está mal, por escrito, en el archivo de al lado:**

```ts
// issue-invoice.dto.ts:11-16
 * Validated as a code rather than against `NcfType`: the enum is the DGII's, and a Chilean `33`,
 * a Mexican `I` or a Brazilian `55` are all legitimate values in their own market that an
 * `@IsEnum(NcfType)` would refuse with a message about Dominican comprobantes.
```

Dos DTOs del mismo dominio, dos criterios opuestos. Eso es la falta de fuente de verdad única
manifestándose como contradicción interna.

**Cómo se ve la forma correcta.** `@IsEnum(NcfType)` pasa a `@IsString() @Length(1, 8)`, y
`ComplianceService` comprueba el código contra `fiscal_document_type_definitions` para la región del
tenant —que es lo que el comentario de la entidad ya promete que hace—. `@Matches(/^[BE]\d{2}$/)`
pasa a `sequence_format` / un patrón en la fila del catálogo, porque la forma de una serie es una
propiedad de la autoridad que la publica. `NcfType` sobrevive solo dentro del adaptador dominicano,
que sí razona legítimamente sobre estos dieciséis códigos, y sale de la entidad compartida, de los
dos DTOs y del cliente.

---

### C-04 · Falta de catálogo único · `fiscal_document_type_definitions` existe, se siembra, y solo tiene un país

- **Categoría:** falta de catálogo único
- **Severidad:** **crítica**
- **Ubicación:** `apps/backend/api/src/app/localization/fiscal/fiscal-document-type-catalogue.ts`
  (16 filas, **todas** `countryCode: 'DO'`), sembrado en
  `apps/backend/api/src/app/localization/services/localization.service.ts:86-121` · módulo
  Localización

**Qué está mal.** La primera pasada creó el catálogo y lo sembró con el juego dominicano, con esta
justificación explícita (`fiscal-document-type-catalogue.ts:23-30`): *«Nothing else is invented
here. The other markets' document types are known to their regime adapters and belong beside
them.»*

El razonamiento es correcto sobre no inventar datos. El resultado, sin embargo, es que **dieciocho
de diecinueve mercados tienen cero filas** en la tabla que decide qué comprobantes puede emitir un
tenant. Y los tipos que esos mercados sí necesitan **no están «beside the adapters» como datos**:
están hardcodeados dentro de ellos (ver A-04). De modo que el catálogo no es la fuente de verdad de
nadie excepto la República Dominicana, y para los demás es una tabla vacía junto a un `switch`.

Cuantificado: `grep -c "countryCode: 'DO'"` sobre ese archivo da 16; cualquier otro código de país
da 0. `COUNTRY_FISCAL_PROFILES` declara 19 mercados.

**Cómo se ve la forma correcta.** Los códigos que los adaptadores **ya emiten hoy** —el `55`
brasileño, `01`/`03`/`07` peruanos, `I`/`E` mexicanos, `01`/`91` colombianos, `33`/`34`/`61`
chilenos, `04`/`05` ecuatorianos, `1`/`3`/`6`/`8`/`11`/`13` argentinos— no son datos inventados:
están escritos en este repositorio y cubiertos por los tests de conformidad de cada régimen. Migran
de las funciones `documentType()` a filas de `FISCAL_DOCUMENT_TYPES`, y el adaptador pasa a
*consultarlas*. Lo que sí queda por confirmar con cada autoridad, y **no debe inventarse**, es el
`sequence_format` y el `expiration_required` de cada uno; esas dos columnas admiten `null` y
`false` mientras no se confirmen.

---

### C-05 · Documento hardcodeado · La única pantalla que registra rangos fiscales es dominicana, con los códigos escritos en el componente

- **Categoría:** documento hardcodeado
- **Severidad:** **crítica**
- **Ubicación:** `apps/core/client-web/src/app/features/settings/fiscal/fiscal.page.ts:51-62`,
  `:99-100`, `:118`; `fiscal.page.html:17-21`, `:106` · módulo Ajustes → Fiscal

**Qué está mal.** Diez códigos de la DGII, escritos como literales en un componente Angular:

```ts
// fiscal.page.ts:51-62
readonly ncfTypes: { value: NcfType; labelKey: string }[] = [
  'E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47',
].map((value) => ({ value: value as NcfType, labelKey: `fiscal.do.${value}` }));
```

```ts
// fiscal.page.ts:99-100
type: ['E31' as NcfType, Validators.required],
prefix: ['E31', [Validators.required, Validators.pattern(/^[BE]\d{2}$/)]],
```

Es el mismo patrón que A-02 de la primera pasada —«el `<select>` tiene tres `<option>` fijos en la
plantilla»— movido del array al componente y no corregido. El `<select>` de la línea 106 del
template se llena de este array, no de un endpoint.

Y la página lo admite: `:118` calcula `isDominican.set(market.countryCode === 'DO')` y el template
(`:17-21`) le muestra a los otros dieciocho mercados un aviso de que *«esta pantalla configura el
régimen dominicano»*. **No existe otra pantalla.** Un tenant chileno, peruano o mexicano no tiene
por dónde registrar un rango autorizado en el producto.

**Cómo se ve la forma correcta.** La página lee
`GET /localization/fiscal-document-types` —filtrado por la región del tenant, resuelta en el
servidor— exactamente como `IdentityDocumentsService` ya hace para los documentos de identidad.
El `<select>` se llena de esa respuesta, la etiqueta sale de `labelKey`/`name`, el patrón del
prefijo sale de `sequence_format`, y el valor por defecto sale de la fila, no de `'E31'`. La página
deja de ser «la dominicana» y pasa a ser la de cualquier régimen que tenga filas.

---

### C-06 · Validación no desacoplada · El endpoint que guarda la identidad fiscal del tenant no valida nada

- **Categoría:** validación no desacoplada por país
- **Severidad:** **crítica**
- **Ubicación:** `apps/backend/api/src/app/organizations/dto/update-organization.dto.ts:8-10`,
  `apps/backend/api/src/app/organizations/organizations.service.ts:43-47` · módulo Organizaciones

**Qué está mal.**

```ts
// update-organization.dto.ts:8-10
@IsOptional()
@IsString()
taxId?: string;
```

```ts
// organizations.service.ts:43-47
async update(id: string, updateOrganizationDto: UpdateOrganizationDto): Promise<Organization> {
  const organization = await this.findOne(id);
  Object.assign(organization, updateOrganizationDto);
  return this.organizationRepository.save(organization);
}
```

El mismo campo, en el mismo producto, tiene tres tratamientos:

| Camino | Valida | Dónde |
|---|---|---|
| Registro | **Sí**, aritméticamente, con `TaxpayerKind` | `profile-registration.strategy.ts:47` |
| Alta de subsidiaria | **Sí**, aritméticamente | `organizations.service.ts:82` |
| Ajustes → Perfil de empresa | **No** | `organizations.service.ts:45` |

El RNC/RFC/CNPJ de la organización es el emisor de cada comprobante electrónico que el producto
firma. `ecf-validator.service.ts` y los seis builders de régimen lo leen de esta columna. Un
`Object.assign` sin comprobación permite sustituirlo por cualquier cadena después del registro, y el
descubrimiento ocurre cuando la autoridad rechaza el envío. Es literalmente el hallazgo A-04 de la
primera pasada —«Ventas y Compras no validan su `taxId` en absoluto»— sobreviviendo en el tenant.

`@IsString()` tampoco es neutral aquí: es la misma anotación que la primera pasada retiró de
`CreateCustomerDto` y `CreateSupplierDto` por ser insuficiente en un producto cuyo propósito es el
cumplimiento fiscal.

**Cómo se ve la forma correcta.** `update()` resuelve el país del tenant con
`TenantCountryResolver` —que ya existe y ya se usa en RR.HH.— y pasa el valor por
`IdentityDocumentService.resolveParty({ appliesTo: 'company', usedFor: 'registration' })`, la misma
rutina que las otras tres altas. Rechaza lo que no valida y almacena la forma canónica. Cambiar el
país de la organización revalida el identificador contra el catálogo del país nuevo, porque un RNC
no es un RUT.

---

## 3. Hallazgos altos

### A-01 · Clave de traducción que expone un concepto de país específico · `settings.company_profile.tax_id` se renombra por locale a EIN / CUIT / RUT / NIT / RNC / RFC / RUC / CNPJ

- **Categoría:** clave de traducción que expone un concepto de país específico
- **Severidad:** **alta**
- **Ubicación:** `apps/core/client-web/src/assets/i18n/regional.json:4`, `:12`, `:19`, `:27`,
  `:47`, `:59`, `:67`, `:77` (y las ocho `settings.subsidiaries.tax_id` contiguas);
  clave base en `libs/shared/locales/src/base/settings.json:460-464` · módulos Ajustes y
  Organizaciones

**Qué está mal.** Este es el mismo mecanismo que la primera pasada condenó en A-01 —usar el
catálogo de traducción como tabla de alias por país— **vivo, en el mismo archivo, para el
identificador de la empresa**:

```json
"en-US": { "settings.company_profile.tax_id": "EIN" },
"es-AR": { "settings.company_profile.tax_id": "CUIT" },
"es-CL": { "settings.company_profile.tax_id": "RUT" },
"es-CO": { "settings.company_profile.tax_id": "NIT" },
"es-DO": { "settings.company_profile.tax_id": "RNC" },
"es-MX": { "settings.company_profile.tax_id": "RFC" },
"es-PE": { "settings.company_profile.tax_id": "RUC" },
"pt-BR": { "settings.company_profile.tax_id": "CNPJ" }
```

Tres cosas mal, en orden:

1. **La clave presupone que «tax_id» es un concepto universal** con un nombre por idioma. Su valor
   base es `"Tax ID" / "Identificación fiscal" / "Identificação fiscal"`
   (`settings.json:460-464`). Es la misma evidencia que `document_type.cedula`: el sistema conoce
   el identificador fiscal como concepto del catálogo i18n, no como dato del catálogo de un país.
2. **La cobertura es de ocho locales para diecinueve mercados.** Uruguay, Paraguay, Bolivia,
   Venezuela, Guatemala, Panamá, Costa Rica, El Salvador, Honduras, Nicaragua y Ecuador no tienen
   parche: sus usuarios leen «Identificación fiscal» donde el servidor ya sabe decir «RUT», «RUC»,
   «NIT», «RIF», «Cédula jurídica» o «RTN» —porque `PublicCountryConfig.taxIdLabel` lo publica
   (`localization.service.ts:296`).
3. **El parche se aplica por `language-country`, no por país.** `locale.store.ts:90-94` calcula
   `wordingLocale` como `${language}-${country}` y solo aplica el parche si ese tag existe. La
   lógica es la correcta —y su comentario (`:72-87`) documenta bien el fallo que evita, que un
   lector en inglés en una empresa dominicana viera «EIN»—. Pero la consecuencia es que **el mismo
   tenant dominicano lee «RNC» en español y «Tax ID» en inglés**. La etiqueta sigue al idioma
   porque vive en un catálogo cuya clave es el idioma. El §0 punto 8 dice que debe seguir a la
   jurisdicción.

**Agravante — dos fuentes para un solo campo.** En la misma pantalla:

```html
<!-- company-profile.page.html:52 -->
{{ 'settings.company_profile.tax_id' | translate }}   <!-- etiqueta: del parche de locale -->
<!-- company-profile.page.html:62 -->
[placeholder]="taxIdExample()"                        <!-- ejemplo: del perfil de país -->
```

…donde `taxIdExample()` (`company-profile.page.ts:32-37`) sí consulta
`countryService.currentCountry()?.taxIdExample`. Un campo, dos orígenes, dos criterios de país.
Idéntico en `subsidiaries.page.html:76`/`:79` y `subsidiaries.page.ts:43-48`.

**Cómo se ve la forma correcta.** La clave `settings.company_profile.tax_id` desaparece y la
etiqueta sale del catálogo, como en el formulario de cliente:
`identityDocuments.label(type, translate)` con la fila que el país del tenant declara para
`appliesTo: 'company'`. Las dieciséis entradas de `regional.json` se borran. Los once mercados sin
parche dejan de estar peor servidos que los ocho con parche, porque deja de haber parche.

---

### A-02 · Falta de catálogo único · El tipo de documento de la contraparte se infiere de la longitud del número, no del catálogo

- **Categoría:** falta de catálogo único / validación no desacoplada por país
- **Severidad:** **alta**
- **Ubicación:**
  `apps/backend/api/src/app/einvoicing/regimes/br/nfe.builder.ts:163-164`, `:172`;
  `apps/backend/api/src/app/einvoicing/regimes/ar/afip.builder.ts:195-201`, `:186`;
  `apps/backend/api/src/app/einvoicing/regimes/cl/sii.builder.ts:74`, `:114`
  · módulo Facturación electrónica

**Qué está mal.** La primera pasada añadió `identityDocumentTypeCode` e
`identityDocumentCountry` a clientes y proveedores, y los validó contra el catálogo. **Ningún
builder de régimen los lee.** Todos siguen adivinando el tipo contando dígitos:

```ts
// nfe.builder.ts:163-164 — Brasil
const buyerDocument = (customer.taxId ?? '').replace(/\D/g, '');
dest.ele(buyerDocument.length === 14 ? 'CNPJ' : 'CPF', {}, buyerDocument);
```

```ts
// nfe.builder.ts:172 — y la condición de contribuyente de ICMS, derivada de lo mismo
dest.ele('indIEDest', {}, buyerDocument.length === 14 ? '1' : '9');
```

```ts
// afip.builder.ts:195-201 — Argentina
/** `80` CUIT, `96` DNI, `99` consumidor final sin identificar. */
private buyerDocumentType(customer: Customer): number {
  const digits = (customer.taxId ?? '').replace(/\D/g, '');
  if (digits.length === 11) return 80;
  if (digits.length >= 7 && digits.length <= 8) return 96;
  return 99;
}
```

Consecuencias concretas: un comprador brasileño registrado correctamente con `CPF` de once dígitos
va a la etiqueta `CPF` por casualidad —porque un CPF tiene once—, pero **cualquier documento
extranjero de catorce dígitos se declara CNPJ a la SEFAZ**, y `indIEDest` lo declara contribuyente
de ICMS. En Argentina, un comprador cuyo `taxId` sea un CUIT sin guiones de once dígitos se declara
`80`; uno con un DNI de siete u ocho, `96`; **un cliente extranjero con un identificador de nueve o
diez dígitos cae en `99`, «consumidor final sin identificar»**, aunque el registro lleve su
documento y su tipo.

Chile ni siquiera adivina: `sii.builder.ts:74` y `:114` escriben `customer.taxId` en `RR` y
`RUTRecep` sin preguntar de qué documento se trata.

Lo que hace esto un hallazgo de arquitectura y no un bug: **el dato correcto está en la fila del
cliente y el builder prefiere inferirlo**. La corrección anterior compró exactamente esa
información y ningún consumidor la gastó.

**Cómo se ve la forma correcta.** El builder lee `customer.identityDocumentTypeCode` y
`customer.identityDocumentCountry`, resuelve la fila del catálogo, y traduce a la etiqueta del
régimen mediante **una columna nueva del catálogo** (ver B-04): `regime_codes`, un mapa
`{ 'AR_AFIP_DOC_TIPO': '80', 'BR_NFE_TAG': 'CNPJ' }` o una tabla puente
`identity_document_regime_codes(country_code, code, regime, regime_code)`. Un comprador sin tipo
registrado —los anteriores al catálogo— es un caso explícito que el builder rechaza o marca, no una
rama de `length ===`.

---

### A-03 · Falta de catálogo único · El catálogo de identificadores de seguridad social vive en código y existe para un solo país

- **Categoría:** falta de catálogo único / validación no desacoplada por país
- **Severidad:** **alta**
- **Ubicación:** `apps/backend/api/src/app/payroll/jurisdictions/` (contiene **un** archivo de
  estrategia: `dominican-republic.strategy.ts`), `jurisdiction-registry.ts:18-20`,
  `dominican-republic.strategy.ts:45-70` (`statutoryIdentifiers`),
  `apps/backend/api/src/app/hcm/hcm.service.ts:210` · módulos Nómina y RR.HH.

**Qué está mal.** La primera pasada corrigió M-01 bien: las columnas `tss_nss` / `afp_code` /
`sfs_code` pasaron a `social_security_number` / `pension_fund_code` / `health_fund_code`, el
`@Matches(/^\d{7,11}$/)` salió del DTO compartido, y la regla se movió a
`statutoryIdentifiers` en la estrategia del país. La forma es correcta. El contenido es de un país:

```ts
// jurisdiction-registry.ts:18-20
constructor() {
  this.register(new DominicanRepublicStrategy());
}
```

```ts
// hcm.service.ts:210
if (!country || !this.jurisdictions.supports(country)) return;
```

**Dieciocho de diecinueve mercados no validan ningún identificador de seguridad social.** El
comentario (`hcm.service.ts:201-204`) argumenta —correctamente— que no imponer nada es mejor que
imponer la regla de otro país. Lo es. Pero el encargo dice que el sistema debe funcionar para
cualquier país soportado desde el día 0, y «no comprueba nada» no es funcionar: es que el
identificador que la nómina mexicana necesita para el IMSS entra sin forma, y el error aparece
cuando se presenta la declaración.

El segundo problema es que `statutoryIdentifiers` **es un catálogo en código, no en datos**: añadir
México es escribir una clase nueva y desplegar. Es el criterio del §0 punto 1, incumplido en el
mismo repositorio que lo cumplió para los documentos de identidad tres archivos más allá.

**Cómo se ve la forma correcta.** Los identificadores estatutarios son filas de un catálogo con la
misma forma que `identity_document_types` —`(país, campo)`, `label_key`, `pattern`, `checksum`,
`required`— y la estrategia de jurisdicción se queda con lo que sí es código: el cálculo de las
cotizaciones. Un mercado nuevo cuesta filas para el formulario y una clase solo cuando haya que
calcular una nómina.

---

### A-04 · Documento hardcodeado · El formulario de empleado pinta tres campos estatutarios fijos y nunca pregunta cuáles tiene el país

- **Categoría:** documento hardcodeado / clave de traducción que expone un concepto de país
- **Severidad:** **alta**
- **Ubicación:**
  `apps/core/client-web/src/app/features/hcm/employees/form/form.page.html:83`, `:87`, `:91`;
  `form.page.ts:119`;
  `apps/backend/api/src/app/payroll/jurisdictions/jurisdiction-strategy.interface.ts:141`
  (`labelKey`, expuesto por **ningún** controlador) · módulo RR.HH.

**Qué está mal.** El servidor modela `StatutoryIdentifierSpec.labelKey` precisamente *«so the form
can name it in the country's terms»* (`jurisdiction-strategy.interface.ts:140`). Ningún endpoint lo
publica —`grep "statutoryIdentifiers" **/*.controller.ts` no devuelve nada— y ningún componente lo
consume. El formulario tiene tres campos fijos con tres claves fijas:

```html
<span>{{ 'hcm.employees.form.social_security_number' | translate }}</span>
<span>{{ 'hcm.employees.form.pension_fund_code'      | translate }}</span>
<span>{{ 'hcm.employees.form.health_fund_code'       | translate }}</span>
```

…y se renombran por locale en `regional.json`:

```json
"en-US": { "hcm.employees.form.social_security_number": "Social Security Number" },
"es-DO": { "hcm.employees.form.social_security_number": "NSS (TSS)" },
"es-MX": { "hcm.employees.form.social_security_number": "NSS (IMSS)" },
"pt-BR": { "hcm.employees.form.social_security_number": "NIT / PIS" }
```

Es **exactamente** el mecanismo de `document_type.cedula`: una clave genérica que finge ser
universal, renombrada por locale, con una sola implementación detrás. El campo se pide en los
diecinueve mercados lo declare el país o no, con la misma etiqueta genérica en once de ellos, y con
cero validación en dieciocho.

**Cómo se ve la forma correcta.** `GET /hcm/statutory-identifiers` devuelve las especificaciones
del país del tenant —campo, `labelKey`, patrón, obligatoriedad—, el formulario itera sobre ellas
como ya itera sobre `documentTypes()` para el documento de identidad, y las dieciséis entradas
correspondientes de `regional.json` se borran. Un país que no declara identificadores estatutarios
no pinta la sección; hoy pinta tres campos vacíos.

---

### A-05 · Clave de traducción que expone un concepto de país · Una regla dominicana presentada como mexicana, en un mercado donde nada la comprueba

- **Categoría:** clave de traducción que expone un concepto de país específico
- **Severidad:** **alta**
- **Ubicación:** `apps/core/client-web/src/assets/i18n/regional.json:49` y `:61`;
  regla real en `apps/backend/api/src/app/payroll/jurisdictions/dominican-republic.strategy.ts:46-51`
  · módulos RR.HH. e i18n

**Qué está mal.**

```json
"es-DO": { "validation.create_employee.social_security_number_format": "El NSS de la TSS debe tener entre 7 y 11 dígitos." },
"es-MX": { "validation.create_employee.social_security_number_format": "El NSS del IMSS debe tener entre 7 y 11 dígitos." }
```

La regla de 7–11 dígitos es la dominicana: está declarada una sola vez, en
`dominican-republic.strategy.ts:49`, como `pattern: '^\\d{7,11}$'`. México **no tiene estrategia de
jurisdicción** (A-03), de modo que:

- ese mensaje no puede dispararse nunca en México, porque `hcm.service.ts:210` retorna antes; y
- su texto afirma, al lector, una regla del IMSS que este repositorio no comprueba en ningún sitio
  y que nadie verificó. El NSS del IMSS tiene once dígitos; el rango 7–11 es la aritmética de la
  TSS con una etiqueta mexicana encima.

Es el defecto de la primera pasada en su forma más pura: **la misma regla renombrada por locale,
presentada como si fuera del país del lector**. La corrección anterior lo eliminó para
`document_type.cedula` y lo dejó intacto aquí.

**Cómo se ve la forma correcta.** El mensaje lo compone el servidor desde la fila del catálogo que
impuso la regla, con `documentLabel` como parámetro —que es lo que `resolveParty()` ya hace
(`identity-document.service.ts:254`)—. Ningún locale renombra ninguna regla. Un país sin regla no
tiene mensaje porque no tiene rechazo.

---

### A-06 · Opcionalidad no real · `requirement` se almacena, se publica al cliente y no se hace cumplir en ningún sitio

- **Categoría:** falta de catálogo único / opcionalidad no real
- **Severidad:** **alta**
- **Ubicación:**
  `apps/backend/api/src/app/localization/entities/identity-document-type.entity.ts:89-90`,
  `apps/backend/api/src/app/localization/services/identity-document.service.ts:228-232`,
  `apps/backend/api/src/app/localization/fiscal/public-country-config.ts:28`,
  `apps/core/client-web/src/app/core/api/identity-documents.service.ts:28` · módulo Localización

**Qué está mal.** `requirement` recorre el sistema entero —columna, `CHECK`, DTO público, interfaz
del cliente— y **nadie lo lee**. `grep -rn "requirement"` sobre `apps/` fuera de las definiciones
de tipo no devuelve un solo uso. En el servidor:

```ts
// identity-document.service.ts:228-232
const raw = input.value?.trim() ?? '';
if (!raw) {
  return { ok: true, value: null, typeCode: null, countryCode: null };
}
```

Un valor vacío es `ok: true` **cualquiera que sea el `requirement` de la fila**. En el cliente,
ningún formulario consulta el campo para añadir `Validators.required`.

El §0 punto 4 pide que la opcionalidad sea un dato y no un supuesto. La ausencia de fila ya expresa
bien «este país no lo emite» —la entidad lo documenta en `:91`— pero el otro extremo, «este país lo
exige», está modelado y no aplicado. Hoy un empleado dominicano se guarda sin cédula, un cliente
brasileño sin CPF y un tenant sin identificador fiscal a través de `update()` (C-06), y los tres
casos son indistinguibles de «este país no lo pide».

**Cómo se ve la forma correcta.** `resolveParty()` recibe la fila antes de decidir sobre el vacío:
si el país declara un documento `required` para ese `usedFor` y no hay valor, devuelve
`{ ok: false, reason: 'value_required' }`. El cliente añade `Validators.required` desde la misma
bandera que ya recibe. `requirement` se convierte en lo que dice ser.

---

### A-07 · Falta de catálogo único · Diez de diecinueve mercados tienen una sola entrada en el catálogo, marcada obligatoria para nómina

- **Categoría:** falta de catálogo único / opcionalidad no real
- **Severidad:** **alta**
- **Ubicación:** `apps/backend/api/src/app/localization/fiscal/identity-document-catalogue.ts:283`
  (EC), `:292` (UY), `:301` (PY), `:310` (BO), `:320` (VE), `:329` (PA), `:354` (GT), `:363` (SV),
  `:372` (HN), `:381` (NI) · módulo Localización

**Qué está mal.** Diez mercados llevan una única fila, que es su identificador fiscal de empresa,
marcada así:

```ts
countryCode: 'EC', code: 'RUC', labelKey: 'identity_document.ec.ruc', labelVerbatim: 'RUC',
canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
```

`appliesTo: 'both'` + `usedFor: ['payroll', …]` significa que **el formulario de empleado en
Ecuador ofrece un RUC de trece dígitos y un pasaporte, y nada más**. Un trabajador ecuatoriano
corriente no tiene RUC —lo tiene quien ejerce actividad económica—; tiene una cédula de diez
dígitos. Lo mismo, con el documento que corresponda, en Uruguay, Paraguay, Bolivia, Venezuela,
Panamá, Guatemala, El Salvador, Honduras y Nicaragua.

El resultado práctico es que en esos diez mercados el registro de empleados solo se completa con un
pasaporte, que es el documento del contratado extranjero, no el del nacional.

**Sobre el aparcamiento explícito.** La auditoría anterior dejó esto fuera a propósito, con un
argumento correcto (`§9 · Lo que queda fuera, 3`): no se inventaron formatos que el repositorio no
afirmaba, y el coste de añadirlos pasó de una migración a un `INSERT`. Ese cambio de coste es real y
es la parte importante. Pero el encargo de esta pasada es explícito en que el sistema debe funcionar
para cualquier usuario de cualquier país soportado **desde el día 0** y que eso no se pospone. Bajo
ese criterio, «poco poblado como dato» y «no funciona en diez mercados» describen el mismo estado.

**Qué hay que verificar, y no inventar.** Para cada uno de los diez mercados hace falta confirmar
con la autoridad emisora, antes de sembrar la fila: el nombre oficial del documento de persona
física, su longitud y formato exactos, y si publica un dígito verificador con algoritmo conocido.
Conozco los nombres en circulación —cédula de identidad ecuatoriana, cédula uruguaya, cédula
paraguaya, carné de identidad boliviano, cédula de identidad venezolana, cédula panameña, DPI
guatemalteco, DUI salvadoreño, tarjeta de identidad hondureña, cédula nicaragüense— pero **no tengo
sus formatos publicados verificados y no deben escribirse desde la memoria**. Es una tarea de
confirmación documental, no de código. Mientras no se confirme el dígito verificador, la fila entra
con `checksum: null` y valida por patrón, que es más débil que lo correcto e infinitamente más
fuerte que ofrecer solo un RUC.

**Corrección inmediata, independiente de esa verificación.** Las diez filas existentes no deberían
llevar `usedFor: ['payroll']` mientras sean el único documento del país: pedirle un identificador de
empresa a un empleado es afirmar algo falso sobre él. Quitar `'payroll'` de esas diez filas es un
cambio de datos que no requiere confirmar nada.

---

### A-08 · Documento hardcodeado · El país por defecto es `'DO'` en siete puntos que deciden qué catálogo aplica

- **Categoría:** documento hardcodeado / validación no desacoplada por país
- **Severidad:** **alta**
- **Ubicación:**
  `apps/backend/api/src/app/invoices/services/invoice-renderer.service.ts:119`,
  `apps/backend/api/src/app/payroll/payroll.controller.ts:209`, `:215`, `:221`, `:227`,
  `apps/backend/api/src/app/payroll/entities/payroll-run.entity.ts:66`,
  `apps/backend/api/src/app/i18n/request-locale.ts:83`,
  `apps/core/client-web/src/app/features/payroll/data/payroll.service.ts:274`, `:280`, `:286`,
  `apps/core/client-web/src/app/features/masters/payment-methods/payment-methods.page.ts:37`
  · transversal

**Qué está mal.** La primera pasada creó `TenantCountryResolver` *«el país del tenant, resuelto en
un sitio y sin valor por defecto»* y eliminó dos `?? 'DO'`. Quedan estos:

```ts
// invoice-renderer.service.ts:119
const issuerCountry = (organization.country ?? 'DO').toUpperCase();
```

```ts
// payroll.controller.ts:209,215,221,227 — cuatro endpoints
resolvedParameters(@Query('country') country = 'DO', @Query('on') on?: string) { … }
listContributions(@Query('country') country = 'DO') { … }
listReferences(@Query('country') country = 'DO') { … }
listBrackets(@Query('country') country = 'DO') { … }
```

```ts
// payroll-run.entity.ts:66
@Column({ name: 'country_code', length: 2, default: 'DO' })
```

Esto pertenece a esta auditoría porque **el país es lo que selecciona el catálogo**. Un país por
defecto equivocado no da un error: da el catálogo de otro país, silenciosamente. Los cuatro
endpoints de nómina devuelven las tasas de la TSS a quien no pase `?country`, y el cliente
(`payroll.service.ts:274-286`) no lo pasa. `invoice-renderer.service.ts:119` rotula el comprobante
de una organización sin país con etiquetas dominicanas.

Los cuatro parámetros de nómina son además el mismo fallo de tenencia: el país debe venir del tenant
autenticado, nunca de un `@Query` que el cliente puede fijar.

**Cómo se ve la forma correcta.** Ningún `?? 'DO'`. El país sale de `TenantCountryResolver`, y un
tenant sin país es un error explícito —no hay un país razonable por defecto en un producto de
diecinueve mercados—. `payroll_runs.country_code` pierde el `DEFAULT` y se exige en el `INSERT`.

---

## 4. Hallazgos medios

### M-01 · Documento hardcodeado · Cada adaptador de régimen codifica su propio tipo de comprobante, junto a una tabla catálogo vacía

- **Categoría:** documento hardcodeado / falta de catálogo único
- **Severidad:** media
- **Ubicación:** `einvoicing/regimes/br/nfe.builder.ts:73-75`, `pe/sunat.builder.ts:183-186`,
  `mx/cfdi.builder.ts:226-228`, `co/dian.builder.ts:66-68`, `cl/sii.builder.ts:68`,
  `ec/sri.builder.ts:107` · módulo Facturación electrónica

**Qué está mal.**

```ts
// nfe.builder.ts:73-75          // sunat.builder.ts:183-186
documentType(): string {         documentType(input): string {
  return '55';                     if (input.invoice.type === InvoiceType.CREDIT_NOTE) return '07';
}                                  return input.series.toUpperCase().startsWith('B') ? '03' : '01';
                                 }
// cfdi.builder.ts:226-228       // dian.builder.ts:66-68
documentType(invoice): 'I'|'E' { documentType(invoice): string {
  return invoice.type === …        return invoice.type === InvoiceType.CREDIT_NOTE ? '91' : '01';
    ? 'E' : 'I';                 }
}
```

Seis funciones, seis países, seis juegos de códigos en código, mientras
`fiscal_document_type_definitions` —creada por la primera pasada exactamente para esto— tiene
dieciséis filas dominicanas y nada más (C-04). Es severidad media y no alta porque el adaptador de
un régimen es un sitio legítimo para conocer los códigos de ese régimen; lo que lo convierte en
hallazgo es que el producto **construyó el catálogo y dieciocho mercados lo rodean**.

**Cómo se ve la forma correcta.** Los códigos son filas; `documentType()` las consulta. La lógica
que sigue siendo del adaptador —«una nota de crédito peruana es `07`», «una serie que empieza por
`B` es boleta»— queda como reglas sobre el catálogo, no como el catálogo mismo.

---

### M-02 · Clave de traducción que expone un concepto de país · Claves i18n dominicanas sin calificar, renombradas por locale

- **Categoría:** clave de traducción que expone un concepto de país específico
- **Severidad:** media
- **Ubicación:**
  `libs/shared/locales/src/base/accounts_payable.json:315` (`accounts_payable.form.ncf`),
  `libs/shared/locales/src/base/invoices.json:175` (`invoices.detail.ncf`),
  `libs/shared/locales/src/base/compliance.json:7`, `:42`, `:47`, `:52`, `:57`, `:62`
  (`compliance.ncf_sequence_*`, `compliance.authorisation_ncf_sequence_type_type_expired`,
  `compliance.no_active_ncf_sequence_type_type`),
  `libs/shared/locales/src/base/compliance.json:72`
  (`compliance.organization_has_no_rfc_file_sat`),
  `libs/shared/locales/src/base/errors.json:290` (`errors.resend_ecf`),
  `apps/pos/src/assets/i18n/{es,en,pt}.json:183`
  (`validation.commercial_approval.issuer_rnc_not_valid_format`),
  `apps/core/client-web/src/assets/i18n/{es,en,pt}.core.json:486`
  (`validation.commercial_approval.ncf_must_followed_12_digits_example`),
  y los parches en `apps/core/client-web/src/assets/i18n/regional.json:31`, `:36`, `:52`, `:55`,
  `:73` · módulos Compras, Facturación, Cumplimiento, POS

**Qué está mal.** Dos cosas distintas, en el mismo sitio.

**(a) Claves genéricas con un término dominicano en el nombre.** `accounts_payable.form.ncf` e
`invoices.detail.ncf` nombran un campo que en diecinueve mercados es «el número del comprobante
fiscal». Sus valores base ya son neutros —`"Fiscal document no."` / `"N.º de comprobante fiscal"`—
lo cual demuestra que el concepto es genérico y solo la **clave** quedó dominicana. Igual
`compliance.ncf_sequence_*` y `errors.resend_ecf`.

**(b) Renombrado por locale, el patrón condenado.** En `regional.json`:

```json
"es-DO": { "accounts_payable.form.ncf": "NCF",          "invoices.detail.ncf": "e-NCF:" },
"es-MX": { "accounts_payable.form.ncf": "Folio fiscal", "invoices.detail.ncf": "Folio fiscal (UUID):" },
"pt-BR": {                                              "invoices.detail.ncf": "Chave de acesso (NF-e):" }
```

Un NCF dominicano, un folio fiscal mexicano y una chave de acesso brasileña **no son el mismo
objeto con tres nombres**: son tres identificadores con tres formatos y tres reglas. Renombrarlos
sobre una clave común es la misma afirmación falsa que hacía `document_type.cedula` —«es un
concepto universal cuyo nombre depende del idioma»— y con el mismo riesgo de que la aritmética de
debajo sea de un solo país.

Contraste que confirma que el repositorio ya sabe cuál es la forma correcta:
`einvoicing.do.*`, `einvoicing.mx.*`, `einvoicing.br.*`, `settings.fiscal.do.*` **sí** están
calificadas por país, y `identity_document.do.cedula` / `identity_document.co.cc` es exactamente el
modelo bueno que la primera pasada introdujo.

**Cómo se ve la forma correcta.** La etiqueta del número de comprobante sale del catálogo de tipos
de comprobante fiscal del país —que es donde vive el nombre que la autoridad imprime— igual que la
etiqueta de un documento de identidad sale del suyo. Las claves que deban seguir siendo claves se
califican por país (`compliance.do.ncf_sequence_not_found`). Las cinco entradas de `regional.json`
desaparecen.

---

### M-03 · Documento hardcodeado · `ncf` como cabecera de columna en el contrato público de exportación, dos veces

- **Categoría:** documento hardcodeado
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/datasheets/services/datasheet-import.service.ts:86`,
  `:133` · módulo Datasheets

**Qué está mal.** El mismo archivo explica por qué esto está mal, en el dataset de al lado:

```ts
// datasheet-import.service.ts:109-112
// The keys are the column headers of the sheet a tenant uploads and downloads, so they
// are a PUBLIC CONTRACT. `rnc` named the Dominican identifier on a column that holds a
// Chilean RUT and a Brazilian CNPJ just as readily, and the cost of that name grows with
// every month of templates saved against it.
columns: { nombre: 'companyName', tax_id: 'taxId', … },
```

…y deja `ncf` en pie en los otros dos:

```ts
// :86  — facturas
columns: { ncf: 'fiscalNumber', … },
// :133 — compras
columns: { ncf: 'ncf', … },
```

`:86` es especialmente claro: la columna de la entidad ya se llama `fiscalNumber` —neutra— y la
cabecera pública que la expone se llama `ncf`. La corrección de M-03 de la primera pasada se aplicó
a un dataset de tres.

**Cómo se ve la forma correcta.** `fiscal_document_number`, en los dos. Y, dado que son un contrato
público, con la compatibilidad hacia atrás que la primera pasada haya definido para `rnc` → `tax_id`.

*Nota adyacente, fuera del alcance de tipos de documento:* las cabeceras de los cuatro datasets son
literales en español (`nombre`, `correo`, `telefono`, `direccion`, `fecha`, `vencimiento`, `moneda`,
`saldo`, `estado`) en un contrato que consumen tenants anglófonos y lusófonos. Es material para la
auditoría de i18n, no para ésta.

---

### M-04 · Documento hardcodeado · Tres implementaciones residuales de validación fiscal por país, una de ellas aceptando cualquier cosa

- **Categoría:** falta de catálogo único / validación no desacoplada por país
- **Severidad:** media
- **Ubicación:**
  `apps/backend/api/src/app/localization/drivers/dominican-republic/dominican-republic.strategy.ts:18-53`,
  `:83` (`taxIdLabel: 'RNC'`), `:86` (`taxIdRegex`);
  `apps/backend/api/src/app/localization/drivers/usa/usa.strategy.ts:9-14`, `:29`
  (`taxIdLabel: 'EIN/SSN'`);
  `apps/backend/api/src/app/localization/drivers/generic-fiscal.strategy.ts:8-10`, `:20`;
  registradas en `apps/backend/api/src/app/localization/services/localization.service.ts:65-67`
  · módulo Localización

**Qué está mal.** La primera pasada retiró `getStrategy()` y `loadStrategies()`, y documentó bien
por qué (`localization.service.ts:134-159`): la estrategia genérica respondía `return true` a todo.
Pero **las tres clases siguen existiendo, siguen inyectadas y siguen registradas**:

```ts
// generic-fiscal.strategy.ts:8-10
async validateTaxId(taxId: string): Promise<boolean> {
  return true; // Generic always accepts
}
// :20  getConfig(): { taxIdLabel: 'Tax ID', taxIdRegex: '.*', … }
```

```ts
// usa.strategy.ts:13-14
const clean = taxId.replace(/[^\d]/g, '');
return clean.length === 9;
// :29  taxIdLabel: 'EIN/SSN'
```

```ts
// dominican-republic.strategy.ts:21-53 — mod-11 y Luhn reimplementados a mano
// :83  taxIdLabel: 'RNC'   :86  taxIdRegex: '^[\\d\\-]+$'
```

Es el hallazgo A-03 de la primera pasada —«el mismo concepto implementado de cuatro formas
distintas»— reducido de cuatro a dos usos reales y **cero a tres implementaciones muertas**. Tres
`taxIdLabel` hardcodeados (`'RNC'`, `'EIN/SSN'`, `'Tax ID'`), tres regex, un `getConfig(): any` sin
tipar, y una función que acepta cualquier identificador fiscal como válido. Todo ello a un
`@Inject` de distancia de volver a estar en el camino crítico.

La razón declarada de que sobrevivan (`:157-159`) es *«reaching a country's registry in
lookupTaxId»*. Eso solo justifica `getTaxIdDetails()`. `validateTaxId()`, `getConfig()`,
`taxIdLabel`, `taxIdRegex` y `taxIdMask` no tienen justificación y `GENERIC` no es un código de país.

**Cómo se ve la forma correcta.** La interfaz se reduce a lo que queda vivo:
`TaxIdRegistryLookup { getTaxIdDetails(taxId): Promise<TaxIdLookupResult | null> }`. Se borran
`validateTaxId`, `getConfig` y `GenericFiscalStrategy` entera. Lo que no se puede invocar tampoco se
puede recablear por error.

---

### M-05 · Documento hardcodeado · Columnas dominicanas en la tabla de nóminas, que sí se renombraron en la de empleados

- **Categoría:** documento hardcodeado
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/payroll/entities/payslip.entity.ts:49`
  (`employee_tss_nss`), `:69` (`tss_base`) · módulo Nómina

**Qué está mal.** La primera pasada renombró `employees.tss_nss` → `social_security_number`, con
este razonamiento (`employee.entity.ts:182-189`): *«tres instituciones dominicanas nombradas en el
esquema de una tabla compartida por diecinueve mercados»*. La tabla de nóminas, que es el snapshot
inmutable de esos mismos datos, conservó los nombres:

```ts
@Column({ name: 'employee_tss_nss', type: 'varchar', nullable: true })
employeeTssNss: string | null;

@Column({ name: 'tss_base', type: 'numeric', … })
tssBase: number;
```

Una nómina mexicana guarda la base del IMSS en una columna llamada `tss_base`. El argumento que
justificó el renombrado en `employees` aplica idéntico aquí.

**Cómo se ve la forma correcta.** `employee_social_security_number` y
`social_security_base`, con la migración de renombrado correspondiente. Los conceptos generalizan:
todo sistema tiene un número de afiliación y una base de cotización.

---

### M-06 · Enum rígido · Vocabularios cerrados dominicanos en el manifiesto de verificación de i18n

- **Categoría:** enum rígido / clave de traducción que expone un concepto de país específico
- **Severidad:** media
- **Ubicación:** `libs/shared/locales/src/composed-keys.json`, familias `fiscal.do`,
  `payroll.parameters.regime_label`, `identity_document` · módulo i18n / tooling

**Qué está mal.** Tres observaciones sobre el mismo archivo:

```jsonc
"fiscal.do": ["B01","B02","B03","B04","B11","B15","E31","E32","E33","E34","E41","E43","E44","E45","E46","E47"],
"fiscal.ar": [], "fiscal.br": [], "fiscal.cl": [], "fiscal.co": [], "fiscal.ec": [], "fiscal.mx": [], "fiscal.pe": [],
"payroll.parameters.regime_label": ["AFP","SFS","SRL","INFOTEP"],
"identity_document": []
```

1. `fiscal.do` enumera los dieciséis códigos de la DGII como vocabulario cerrado en la herramienta
   de i18n. Es el hallazgo M-05 de la primera pasada —«el enum dominicano está fijado también en la
   herramienta de i18n»— en su segunda encarnación: el enum salió del esquema y sigue aquí. Los
   siete países restantes con adaptador de régimen tienen `[]`, que según la nota del propio archivo
   significa «dominio abierto, la completitud **no se puede comprobar**».
2. `payroll.parameters.regime_label` fija cuatro instituciones dominicanas —AFP, SFS, SRL,
   INFOTEP— como el conjunto cerrado de regímenes de cotización del producto. Renombradas por
   locale solo para `es-DO` (`regional.json:41-44`).
3. `identity_document: []` significa que **la completitud del catálogo de documentos de identidad en
   los tres idiomas no se verifica**. Sembrar la fila de la cédula ecuatoriana (A-07) sin añadir su
   clave a `identity_document.json` no rompe ningún check; el usuario vería la clave cruda.

**Cómo se ve la forma correcta.** Las familias se derivan del catálogo en tiempo de build, no se
copian a mano: `fiscal.<país>` de `FISCAL_DOCUMENT_TYPES`, `identity_document` de
`IDENTITY_DOCUMENT_TYPES`, `payroll.parameters.regime_label` de los regímenes declarados por cada
estrategia. Entonces añadir una fila y olvidar su traducción sí es un fallo de build.

---

### M-07 · Documento hardcodeado · La etiqueta del documento del cliente en el PDF sale del perfil del emisor, no del registro del cliente

- **Categoría:** documento hardcodeado / falta de catálogo único
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/invoices/services/invoice-renderer.service.ts:149-150`,
  y `:119` (`?? 'DO'`, ver A-08) · módulo Facturación

**Qué está mal.**

```ts
const profile = findCountryProfile(issuerCountry);   // :121 — el país del EMISOR
…
taxIdLabel:         profile?.taxId.label ?? 'ID',                                  // :149
customerTaxIdLabel: profile?.individualDocument?.label ?? profile?.taxId.label ?? 'ID',  // :150
```

Tres problemas en dos líneas:

1. **La etiqueta del documento del cliente se toma del perfil del emisor.** Un tenant dominicano que
   factura a un cliente colombiano rotula el NIT de ese cliente como «Cédula».
2. **Lee `individualDocument`**, el campo marcado `@deprecated` (`public-country-config.ts:53-58`),
   en vez del `identityDocumentTypeCode` que el registro del cliente ya lleva desde la primera
   pasada. El dato correcto está a un `find()` de distancia y no se usa (mismo patrón que A-02).
3. `'ID'` es un literal inglés hardcodeado como último recurso, en el documento fiscal.

**Cómo se ve la forma correcta.** `taxIdLabel` sale de la fila del catálogo del documento **del
emisor**; `customerTaxIdLabel`, de la fila del documento **del cliente**, resuelta por
`(customer.identityDocumentCountry, customer.identityDocumentTypeCode)`. Un cliente sin tipo
registrado cae en la etiqueta neutra traducida del catálogo i18n, no en `'ID'`.

---

### M-08 · Documento hardcodeado · Una etiqueta de país sin traducir, interpolada en un mensaje de error localizado

- **Categoría:** documento hardcodeado / clave de traducción
- **Severidad:** media
- **Ubicación:** `apps/backend/api/src/app/organizations/organizations.service.ts:83` · módulo
  Organizaciones

**Qué está mal.**

```ts
throw new BadRequestError('organizations.label_not_valid_name', {
  label: profile.taxId.label,     // 'RNC / Cédula', 'Cédula jurídica', 'CUIT'…
  name: profile.name,             // 'República Dominicana' — literal español, siempre
});
```

La frase que envuelve al parámetro sí viaja como clave y se traduce; el parámetro es el literal
español de `COUNTRY_FISCAL_PROFILES` (C-01). Para Costa Rica, un lector anglófono recibe una frase
en inglés con «Cédula jurídica» dentro —lo cual es correcto, es terminología de la autoridad— y
«República Dominicana» o «Costa Rica» como nombre de país en español, que no lo es.

El repositorio ya distingue las dos categorías con cuidado en `fiscal-label-keys.ts:14-29`: el
vocabulario genérico se traduce, la terminología de la autoridad no. Este sitio no aplica esa
distinción al nombre del país.

**Cómo se ve la forma correcta.** El `label` sale de la fila del catálogo
(`labelVerbatim ?? translate(labelKey)`), que es la regla que
`IdentityDocumentsService.label()` ya implementa. El nombre del país sale del catálogo de países
traducido, no del literal del perfil.

---

## 5. Hallazgos bajos

### B-01 · Falta de catálogo único · `pattern` viaja al cliente y ningún formulario lo usa

- **Categoría:** falta de catálogo único
- **Severidad:** baja
- **Ubicación:** `apps/core/client-web/src/app/core/api/identity-documents.service.ts:11-13`,
  `:26` · módulos Ventas, Compras, RR.HH.

**Qué está mal.** El servicio documenta el propósito del campo con precisión —*«`pattern` travels
for immediate feedback; the check-digit algorithm does not»*— y ningún formulario lo consume:
`grep "Validators.pattern"` sobre `customer-form.page.ts`, `supplier-form.ts` y
`hcm/employees/form/form.page.ts` no devuelve nada. La retroalimentación inmediata que justifica
publicar el patrón no existe; el usuario descubre el formato al enviar.

No es un defecto de corrección —el veredicto del servidor es el que manda, y ése sí se aplica— sino
una promesa del diseño sin cumplir, y un campo público sin consumidor.

**Cómo se ve la forma correcta.** Al cambiar el tipo de documento seleccionado, el formulario
aplica `Validators.pattern(new RegExp(type.pattern))` y, si A-06 se corrige, también
`Validators.required` según `requirement`. Es la misma mecánica que
`register.page.ts:426-431` (`syncTaxIdValidator`) ya hace en el registro.

---

### B-02 · Clave de traducción · La etiqueta de una fila nueva del catálogo exige un despliegue

- **Categoría:** falta de catálogo único
- **Severidad:** baja
- **Ubicación:** `libs/shared/locales/src/base/identity_document.json`,
  `apps/core/client-web/src/assets/i18n/{es,en,pt}.json` · módulo i18n

**Qué está mal.** El catálogo promete —y cumple— que dar de alta un documento es un `INSERT`. Pero
`label_key` se resuelve contra un JSON que se compila al bundle del cliente. Insertar la fila de la
cédula ecuatoriana y no añadir `identity_document.ec.cedula` a ese archivo produce un `<option>` que
muestra la clave cruda. El `INSERT` es suficiente para la **validación**; no lo es para la
**presentación**.

Hay una válvula de escape y está bien diseñada: `label_verbatim` gana sobre `label_key`, y la
terminología de la autoridad —que es la mayoría de los casos— debe ir ahí de todos modos. De ahí la
severidad baja. Pero la promesa, tal y como está escrita, es más amplia que lo que el mecanismo
sostiene, y `composed-keys.json` no comprueba la familia (M-06).

**Cómo se ve la forma correcta.** Se documenta el límite real: una fila nueva sin `label_verbatim`
necesita su clave en el catálogo i18n. O, más ambicioso, `label_key` cae a una tabla
`identity_document_type_labels(country_code, code, language, text)`, y entonces sí es un `INSERT`
completo.

---

### B-03 · Falta de catálogo único · No existe ningún verificador que impida la regresión

- **Categoría:** falta de catálogo único
- **Severidad:** baja *(por impacto inmediato; alta por probabilidad a medio plazo)*
- **Ubicación:** `tools/verify/` (18 verificadores), `tools/i18n/` (5 escáneres) — ninguno cubre
  esto · transversal

**Qué está mal.** El repositorio tiene una cultura de verificación notable: `tenant-scope-guard`,
`verify:markets`, `verify:fiscal-identity`, `verify:rls`, `scan-hardcoded-strings`,
`verify-localized-names`, `form-a11y`, `required-markers`. **Ninguno cubre los tipos de documento.**
Los diecinueve hallazgos de la primera pasada se corrigieron a mano y nada impide reintroducirlos; de
hecho, esta segunda pasada encuentra nueve casos del mismo patrón que sobrevivieron precisamente
porque no había nada que los señalara.

**Cómo se ve la forma correcta.** Tres verificadores nuevos, baratos:

1. **`verify:document-types`** — falla si un literal de nombre de documento (`RNC`, `Cédula`,
   `CUIT`, `CNPJ`, `RUC`, `NIT`, `RFC`, `RUT`, `DNI`, `CURP`, `NCF`, `CPF`…) aparece fuera de una
   lista blanca de archivos de catálogo, con la mecánica de baseline que
   `scan-typescript-prose.mjs` ya usa.
2. **`verify:catalogue-coverage`** — falla si un país de `COUNTRY_FISCAL_PROFILES` no tiene, en
   `IDENTITY_DOCUMENT_TYPES`, al menos una entrada `individual`-o-`both` con `usedFor: 'payroll'` y
   una `company`-o-`both` con `usedFor: 'invoicing'`. Este verificador falla hoy para diez mercados,
   que es el punto (A-07).
3. **`verify:fiscal-enums`** — falla si un `@IsEnum` sobre un enum de códigos de un país custodia un
   DTO de un módulo no acotado a ese país. Falla hoy en dos sitios (C-03).

---

## 6. El catálogo propuesto

La forma correcta, que es en buena parte la que ya existe. Se marca **NUEVO** lo que hoy falta.

### 6.1 `identity_document_types` — quién es una persona o una empresa

| Columna | Tipo | Por qué |
|---|---|---|
| `country_code` | `char(2)` | ISO 3166-1 alpha-2 de la jurisdicción emisora, o `XX` para el pasaporte. Parte de la clave natural. |
| `code` | `varchar(32)` | El código de la autoridad, **declarado**, nunca derivado de la etiqueta. Parte de la clave natural. |
| `label_key` | `varchar(128)` | Clave i18n. Nunca una palabra. |
| `label_verbatim` | `varchar(64)` null | Terminología que la autoridad imprime y que no debe traducirse. Gana sobre `label_key`. |
| `example` | `varchar(64)` null | Placeholder con la forma de un valor real, nunca un identificador emitido. |
| `pattern` | `varchar(256)` | Anclado por ambos extremos. Solo forma. |
| `checksum` | `varchar(48)` null | **Nombre** del algoritmo, resuelto por `CHECKSUM_ALGORITHMS`. `null` = el patrón es toda la comprobación. |
| `canonical_form` | `varchar(32)` | `digits` \| `alphanumeric` \| `segmented`. |
| `applies_to` | `varchar(16)` | `individual` \| `company` \| `both`. Ternario: un RUT chileno identifica a los dos. |
| `requirement` | `varchar(16)` | `required` \| `optional`. **Y alguien lo hace cumplir** (A-06). «No se emite aquí» es la ausencia de fila, nunca un tercer valor. |
| `used_for` | `text[]` | `payroll` \| `invoicing` \| `registration`. México pide CURP para nómina y RFC para facturar. |
| `is_default` | `boolean` | Preseleccionado. Sustituye al `DEFAULT 'CEDULA'` del enum retirado. |
| `issuing_authority` | `varchar(64)` null | |
| `valid_from` / `valid_until` | `date` null | Un documento superado se desactiva, nunca se borra: la fila de 2019 tiene que seguir resolviendo. |
| `sort_order` | `smallint` | |
| **`regime_codes`** | **`jsonb`** **NUEVO** | **El código de este documento en cada régimen de facturación electrónica: `{"AR_AFIP_DocTipo":"80","BR_NFE_tag":"CNPJ","PE_SUNAT_tipoDoc":"6"}`. Es lo que hoy falta para que A-02 y M-01 dejen de inferir por longitud.** |
| **`kind_hint`** | **`varchar(16)` null** | **NUEVO. El `TaxpayerKind` que este documento implica, para retirar `byLength()`/`byPrefix()` de `tax-id-validators.ts` (C-02).** |

Clave natural: `UNIQUE (country_code, code)`, y es la clave que referencian las tablas de negocio.
Vocabularios cerrados como `CHECK`, nunca como `ENUM` de PostgreSQL —un `CHECK` se reescribe en una
transacción, un enum no pierde nunca un valor.

**Lo que hay que añadir como datos, tras verificación documental y sin inventarlo (A-07):** el
documento de persona física de Ecuador, Uruguay, Paraguay, Bolivia, Venezuela, Panamá, Guatemala,
El Salvador, Honduras y Nicaragua; y el identificador fiscal de empresa de los diecinueve mercados,
migrado desde `COUNTRY_FISCAL_PROFILES.taxId` (C-01).

### 6.2 `fiscal_document_type_definitions` — qué comprobante se emite

Ya existe y ya tiene la forma correcta (`code`, `label_key`, `name`, `sequence_format`,
`expiration_required`, `is_electronic`, `side`, `is_credit_note`, `requires_buyer_tax_id`,
`sort_order`, ligada a `fiscal_regions`). Lo que falta son **las filas de dieciocho mercados**
(C-04), migradas desde las funciones `documentType()` de los adaptadores (M-01), y que el DTO de
alta de rangos deje de custodiarse con `@IsEnum(NcfType)` (C-03).

### 6.3 `statutory_identifier_types` — **NUEVO**, quién es alguien ante la seguridad social

Misma forma, otro eje. Hoy vive en código, para un país (A-03).

| Columna | Por qué |
|---|---|
| `country_code` | Clave natural, con `field`. |
| `field` | `social_security_number` \| `pension_fund_code` \| `health_fund_code` \| una clave dentro de `employees.statutory_enrolment` —que es la válvula de escape que evita una migración por cada cuarto identificador. |
| `label_key` | Clave i18n, servida al formulario (A-04). |
| `pattern` / `checksum` | Mismo criterio que arriba. `null` = el país no impone forma que este producto pueda afirmar. |
| `requirement` | Y se hace cumplir. |
| `sort_order` | |

### 6.4 La regla transversal

Un solo servicio responde «¿qué identifica a esta parte y es válido este valor?»
—`IdentityDocumentService.resolveParty()`, que ya existe y ya lo hace para tres módulos—. Los
caminos que hoy no pasan por él (registro, subsidiarias, perfil de empresa, los seis builders de
régimen, el formulario de empleado en su sección estatutaria) pasan a hacerlo. El país siempre se
resuelve en el servidor desde el tenant, nunca se acepta del cliente ni se supone `'DO'`.

---

## 7. Inventario completo, por módulo

Todo sitio donde hoy hay un documento de un país concreto hardcodeado, o donde el catálogo existe y
no se consulta.

### Localización (donde vive la fuente de verdad, y la fuente paralela)

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `fiscal/country-profiles.ts:715` | `taxId: { label: 'RNC / Cédula', … }` | C-01 |
| `fiscal/country-profiles.ts:716` | `individualDocument: { code: 'CEDULA', label: 'Cédula', … }` | C-01 |
| `fiscal/country-profiles.ts:742` | `individualDocument: { code: 'SSN', label: 'SSN / ITIN', … }` | C-01 |
| `fiscal/country-profiles.ts:751,768,785,805,821,842,867,887,896,905,923,932,941,950,968` | `label: 'RFC' \| 'NIT' \| 'RUT' \| 'RUC' \| 'CUIT' \| 'CNPJ' \| 'Cédula jurídica'` | C-01 |
| `fiscal/tax-id-validators.ts:684-769` | `TAX_ID_RULES` — `Record` de 19 países en código | C-02 |
| `fiscal/tax-id-validators.ts:647,660` | `byLength()` / `byPrefix()` — el tipo se infiere del valor | C-02 |
| `fiscal/fiscal-document-type-catalogue.ts` | 16 filas, todas `countryCode: 'DO'` | C-04 |
| `fiscal/identity-document-catalogue.ts:283,292,301,310,320,329,354,363,372,381` | 10 países con una sola fila, `required` para nómina | A-07 |
| `fiscal/fiscal-label-keys.ts:40-90` | Mapa de traducción **keyed por el literal español** del perfil | C-01 (consecuencia) |
| `drivers/dominican-republic/dominican-republic.strategy.ts:21-53,83,86` | mod-11 y Luhn reimplementados; `taxIdLabel: 'RNC'` | M-04 |
| `drivers/usa/usa.strategy.ts:13-14,29` | `clean.length === 9`; `taxIdLabel: 'EIN/SSN'` | M-04 |
| `drivers/generic-fiscal.strategy.ts:8-10,20` | `validateTaxId → return true`; `taxIdLabel: 'Tax ID'` | M-04 |
| `services/localization.service.ts:65-67` | Las tres estrategias siguen registradas | M-04 |
| `services/localization.service.ts:296-299` | `taxIdLabel/Example/Pattern` desde el perfil, no del catálogo | C-01 |
| `services/identity-document.service.ts:228-232` | Valor vacío = `ok: true`, ignorando `requirement` | A-06 |
| `entities/identity-document-type.entity.ts:89` | `requirement`, almacenado y nunca leído | A-06 |

### Organizaciones / Ajustes (la identidad fiscal del propio tenant)

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `organizations/dto/update-organization.dto.ts:8-10` | `@IsOptional() @IsString() taxId` | C-06 |
| `organizations/organizations.service.ts:43-47` | `Object.assign` sin validación fiscal | C-06 |
| `organizations/organizations.service.ts:83` | `label: profile.taxId.label` interpolado sin traducir | M-08 |
| `client-web/.../settings/company-profile/company-profile.page.html:52` | Etiqueta desde clave i18n parcheada por locale | A-01 |
| `client-web/.../settings/company-profile/company-profile.page.ts:64` | `taxId: ['', Validators.required]` — sin patrón | C-06 |
| `client-web/.../settings/organization/subsidiaries/subsidiaries.page.html:76` | Ídem | A-01 |
| `client-web/.../settings/organization/subsidiaries/subsidiaries.page.ts:71` | Ídem | C-06 |

### Cumplimiento / Facturación electrónica (el tipo de comprobante)

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `compliance/entities/ncf-sequence.entity.ts:4-23` | `enum NcfType` — 16 códigos DGII en TypeScript | C-03 |
| `compliance/entities/ncf-sequence.entity.ts:98` | `type: NcfType` tipa la columna compartida | C-03 |
| `compliance/dto/provision-ncf-sequence.dto.ts:9` | `@IsEnum(NcfType)` en el borde HTTP | C-03 |
| `compliance/dto/provision-ncf-sequence.dto.ts:13` | `@Matches(/^[BE]\d{2}$/)` | C-03 |
| `einvoicing/dto/void-sequence-range.dto.ts:7` | `@IsEnum(NcfType)` | C-03 |
| `einvoicing/regimes/br/nfe.builder.ts:73-75` | `return '55'` | M-01 |
| `einvoicing/regimes/br/nfe.builder.ts:163-164` | `length === 14 ? 'CNPJ' : 'CPF'` | A-02 |
| `einvoicing/regimes/br/nfe.builder.ts:172` | `indIEDest` derivado de la longitud | A-02 |
| `einvoicing/regimes/ar/afip.builder.ts:195-201` | `buyerDocumentType()` → `80`/`96`/`99` por longitud | A-02 |
| `einvoicing/regimes/ar/afip.builder.ts:186` | `length === 11` como prueba de responsable inscripto | A-02 |
| `einvoicing/regimes/cl/sii.builder.ts:74,114` | `customer.taxId` sin tipo de documento | A-02 |
| `einvoicing/regimes/pe/sunat.builder.ts:183-186` | `'07'` / `'03'` / `'01'` | M-01 |
| `einvoicing/regimes/mx/cfdi.builder.ts:226-228` | `'I'` / `'E'` | M-01 |
| `einvoicing/regimes/co/dian.builder.ts:66-68` | `'91'` / `'01'` | M-01 |
| `client-web/.../settings/fiscal/fiscal.page.ts:51-62` | 10 códigos DGII en el componente | C-05 |
| `client-web/.../settings/fiscal/fiscal.page.ts:99-100` | Default `'E31'`, `Validators.pattern(/^[BE]\d{2}$/)` | C-05 |
| `client-web/.../settings/fiscal/fiscal.page.html:17-21` | Aviso de que la página no aplica a 18 mercados | C-05 |

### RR.HH. / Nómina (el identificador de seguridad social)

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `payroll/jurisdictions/` | Una sola estrategia: `dominican-republic.strategy.ts` | A-03 |
| `payroll/jurisdictions/jurisdiction-registry.ts:18-20` | Un solo `register()` | A-03 |
| `hcm/hcm.service.ts:210` | `if (!supports(country)) return` — 18 mercados sin validar | A-03 |
| `payroll/jurisdictions/jurisdiction-strategy.interface.ts:141` | `labelKey` expuesto por ningún controlador | A-04 |
| `client-web/.../hcm/employees/form/form.page.html:83,87,91` | Tres claves i18n fijas, tres campos siempre | A-04 |
| `payroll/entities/payslip.entity.ts:49` | Columna `employee_tss_nss` | M-05 |
| `payroll/entities/payslip.entity.ts:69` | Columna `tss_base` | M-05 |
| `payroll/payroll.controller.ts:209,215,221,227` | `@Query('country') country = 'DO'` ×4 | A-08 |
| `payroll/entities/payroll-run.entity.ts:66` | `default: 'DO'` | A-08 |
| `client-web/.../payroll/data/payroll.service.ts:274,280,286` | `country = 'DO'` ×3 | A-08 |

### Ventas / Compras / Facturación (consumidores del catálogo)

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `invoices/services/invoice-renderer.service.ts:150` | Etiqueta del cliente desde el perfil del emisor | M-07 |
| `invoices/services/invoice-renderer.service.ts:149,150` | `?? 'ID'` — literal inglés en el PDF fiscal | M-07 |
| `invoices/services/invoice-renderer.service.ts:119` | `organization.country ?? 'DO'` | A-08 |
| `datasheets/services/datasheet-import.service.ts:86` | Cabecera pública `ncf:` → `fiscalNumber` | M-03 |
| `datasheets/services/datasheet-import.service.ts:133` | Cabecera pública `ncf:` → `ncf` | M-03 |
| `client-web/.../contacts/customer-form/customer-form.page.ts` | Sin `Validators.pattern` sobre el `pattern` recibido | B-01 |
| `client-web/.../contacts/supplier-form/supplier-form.ts` | Ídem | B-01 |
| `client-web/.../hcm/employees/form/form.page.ts` | Ídem | B-01 |

### i18n (catálogos y tooling)

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `client-web/src/assets/i18n/regional.json:4,12,19,27,47,59,67,77` | `settings.company_profile.tax_id` → EIN/CUIT/RUT/NIT/RNC/RFC/RUC/CNPJ | A-01 |
| `client-web/src/assets/i18n/regional.json:5,13,20,28,48,60,68,78` | `settings.subsidiaries.tax_id`, ídem | A-01 |
| `client-web/src/assets/i18n/regional.json:3,35,54,72` | `hcm.employees.form.social_security_number` renombrado por locale | A-04 |
| `client-web/src/assets/i18n/regional.json:49,61` | Regla dominicana 7–11 presentada como del IMSS | A-05 |
| `client-web/src/assets/i18n/regional.json:31,52` | `accounts_payable.form.ncf` → «NCF» / «Folio fiscal» | M-02 |
| `client-web/src/assets/i18n/regional.json:36,55,73` | `invoices.detail.ncf` → «e-NCF:» / «Folio fiscal (UUID):» / «Chave de acesso (NF-e):» | M-02 |
| `client-web/src/assets/i18n/regional.json:41-44` | `payroll.parameters.regime_label.{afp,sfs,srl,infotep}` | M-06 |
| `libs/shared/locales/src/base/accounts_payable.json:315` | Clave `…form.ncf` sin calificar por país | M-02 |
| `libs/shared/locales/src/base/invoices.json:175` | Clave `invoices.detail.ncf` sin calificar | M-02 |
| `libs/shared/locales/src/base/compliance.json:7,42,47,52,57,62` | `compliance.ncf_sequence_*` sin calificar | M-02 |
| `libs/shared/locales/src/base/compliance.json:72` | `compliance.organization_has_no_rfc_file_sat` sin calificar | M-02 |
| `libs/shared/locales/src/base/errors.json:290` | `errors.resend_ecf` sin calificar | M-02 |
| `apps/pos/src/assets/i18n/{es,en,pt}.json:183` | `validation.commercial_approval.issuer_rnc_not_valid_format` | M-02 |
| `client-web/src/assets/i18n/{es,en,pt}.core.json:486` | `validation.commercial_approval.ncf_must_followed_12_digits_example` | M-02 |
| `libs/shared/locales/src/composed-keys.json` | `fiscal.do` cerrado con 16 códigos; los 7 restantes `[]` | M-06 |
| `libs/shared/locales/src/composed-keys.json` | `payroll.parameters.regime_label: ['AFP','SFS','SRL','INFOTEP']` | M-06 |
| `libs/shared/locales/src/composed-keys.json` | `identity_document: []` — completitud no verificada | M-06 |

### Transversal

| Archivo:línea | Literal / defecto | Hallazgo |
|---|---|---|
| `i18n/request-locale.ts:83` | `(tenant?.countryCode ?? '') \|\| 'DO'` | A-08 |
| `client-web/.../masters/payment-methods/payment-methods.page.ts:37` | `?? 'DO'` | A-08 |
| `tools/verify/`, `tools/i18n/` | Ningún verificador cubre tipos de documento | B-03 |

**Comprobado y limpio.** Estos sitios se auditaron y **no** tienen el defecto, la mayoría por
corrección de la primera pasada: el formulario de empleado en su sección de documento de identidad
(`form.page.ts:111-115`, sin default), el formulario de cliente y el de proveedor
(`customer-form.page.ts:63`, `supplier-form.ts:36`, ambos vía `IdentityDocumentsService`), el
buscador global (`global-search.page.ts:39`, etiqueta resuelta del catálogo),
`search.service.ts:40-49` (envía `documentTypeCode`, no un literal), los DTOs de cliente y proveedor
(`identityDocumentTypeCode` + `identityDocumentCountry` validados en servicio),
`employee.entity.ts:193-211` (columnas neutras + `statutory_enrolment` como válvula de escape),
`encrypted-column.transformer.ts` (solo comentarios), `apps/desktop` (sin ocurrencias), y
`apps/pos` (solo la clave i18n de M-02).

---

## 8. Orden de corrección sugerido

Se ordena por dependencia, no por severidad: cada paso hace el siguiente más barato.

1. **C-06** — validar el `taxId` en `OrganizationsService.update()`. Diez líneas, cierra el agujero
   por el que hoy se puede corromper el emisor de todo comprobante firmado. No depende de nada.
2. **A-07, corrección de datos** — quitar `'payroll'` de `used_for` en las diez filas que son
   identificadores de empresa. Cambio de datos, cero riesgo, y deja de pedirle un RUC a un
   trabajador.
3. **A-06** — hacer cumplir `requirement` en `resolveParty()` y en los formularios. Convierte en
   real la opcionalidad que ya está modelada, y es requisito para que el paso 4 signifique algo.
4. **A-07, verificación documental** — confirmar con cada autoridad el formato del documento de
   persona física de los diez mercados y sembrar las filas. Es trabajo de confirmación, no de
   código, y se puede paralelizar. **No se escribe ningún formato desde la memoria.**
5. **C-01 + C-02** — migrar el identificador fiscal de empresa de `COUNTRY_FISCAL_PROFILES` al
   catálogo y retirar `TAX_ID_RULES`. Es el cambio grande. Habilita A-01, M-07 y M-08, que pasan a
   ser consecuencias de una sola línea.
6. **A-01, M-07, M-08** — caen solas tras el paso 5. Se borran 16 entradas de `regional.json`.
7. **C-03 + C-04 + M-01** — retirar `@IsEnum(NcfType)` de los dos DTOs, sembrar los tipos de
   comprobante de los adaptadores en el catálogo, y hacer que los adaptadores los consulten.
8. **C-05** — reescribir Ajustes → Fiscal sobre el catálogo del paso 7. Es lo que desbloquea el
   registro de rangos fiscales en dieciocho mercados.
9. **A-02** — añadir `regime_codes` al catálogo y hacer que los seis builders lean el tipo de
   documento del comprador en vez de contar dígitos.
10. **A-03 + A-04 + A-05** — extraer `statutory_identifier_types` a datos, exponerlo, consumirlo en
    el formulario, borrar las entradas de `regional.json`.
11. **A-08, M-02, M-03, M-05, M-06, M-04, B-01, B-02** — limpieza. Independientes entre sí.
12. **B-03** — los tres verificadores. **Último en el orden y primero en importancia a medio
    plazo**: es lo único que impide que esta auditoría tenga una tercera pasada.

---

## 9. Lo que esta auditoría no afirma

- **No se ejecutó la aplicación.** Todo lo anterior se deriva del código citado. Consta además, en
  §9 de la auditoría anterior, que `verify:boot` falla en la línea base por una cadena de cableado
  de módulos ajena a los tipos de documento, de modo que seis verificadores dependientes del
  arranque no pudieron correrse entonces y tampoco ahora.
- **No se inventó el formato de ningún documento.** Donde hace falta un dato que este repositorio no
  afirma —el formato publicado del documento de persona física de diez mercados (A-07), el
  `sequence_format` de los tipos de comprobante de dieciocho (C-04), el código de cada documento en
  cada régimen para `regime_codes` (A-02)— se dice que hay que verificarlo con la autoridad, y no se
  escribe un valor. Un patrón inventado es peor que una entrada `checksum: null`, porque parece
  validación.
- **No se asume que República Dominicana sea representativa.** Al contrario: el argumento central de
  este informe es que diez de los diecinueve mercados no tienen un documento de persona física en el
  catálogo (A-07), once no tienen etiqueta propia para su identificador fiscal (A-01), y dieciocho no
  tienen ni tipos de comprobante sembrados (C-04) ni validación de seguridad social (A-03) — y que
  eso, desde dentro, es indistinguible de que el problema esté resuelto.
