# Auditoría — Tipos de documento e identificadores hardcodeados por país

> **Método.** Lectura estática de todo el monorepo (`apps/backend`, `apps/core/client-web`,
> `apps/pos`, `libs/shared`, migraciones y catálogos i18n). Cada hallazgo cita archivo, línea y el
> literal exacto encontrado. No se ejecutó la aplicación: las afirmaciones sobre comportamiento se
> derivan del código citado, no de observación en runtime.
>
> **Fecha:** 2026-09-17 · **Rama:** `claude/audit-hardcoded-document-types-dacm0z`
> **Alcance:** todo el proyecto, no un módulo. Detonante: `document_type.cedula` /
> `document_type.rnc` en el catálogo i18n de RR.HH.

---

## 0. El estándar, antes de juzgar el código

Un modelo de datos correcto para «tipo de documento / identificador» tiene esta forma, y conviene
fijarla antes de mirar nada, para que el juicio no se acomode a lo que ya existe:

1. **Es un catálogo, no un enum.** Una tabla (o una configuración versionada y cargada como datos),
   nunca un `ENUM` de PostgreSQL ni un *union type* fijo en TypeScript. El criterio operativo es
   este: **dar de alta un país debe ser insertar filas, no correr una migración ni desplegar
   código.** Si añadir Colombia obliga a un `ALTER TYPE … ADD VALUE`, el modelo está mal.
2. **Cada entrada pertenece a una jurisdicción.** La clave natural es `(país, código)`. No existe
   «el tipo de documento» en abstracto; existe «la cédula de ciudadanía colombiana», que no es la
   cédula dominicana ni la cédula costarricense.
3. **La regla de validación viaja con la entrada.** Formato, longitud, y —cuando lo hay— el
   algoritmo de dígito verificador se resuelven *desde la entrada del catálogo*, no desde un
   `switch (tipo)` disperso por el código. Un algoritmo no cabe en una fila, pero sí cabe su
   **nombre**: la fila declara `checksum: 'luhn_mod10'` y un registro de funciones, indexado por
   ese nombre, lo resuelve. Añadir un país que reusa un algoritmo ya implementado sigue siendo
   solo datos; solo un algoritmo genuinamente nuevo toca código, y toca **un** archivo.
4. **La opcionalidad es un dato, no un supuesto.** El catálogo distingue *obligatorio*, *opcional*
   e *inexistente* por país. Chile no tiene «pasaporte o cédula» como disyuntiva equivalente a la
   dominicana; México pide CURP para nómina y RFC para facturar, y son dos campos, no uno.
5. **Aplica a persona física, jurídica o ambas.** Un RNC no identifica a un empleado; un CPF no
   identifica a una empresa. El formulario debe poder filtrar por esto.
6. **La etiqueta es una clave i18n, no una palabra.** La fila guarda `hcm.document_type.co.cc`, no
   `"Cédula de ciudadanía"`. Lo contrario convierte el catálogo en un archivo de traducción con
   esquema de base de datos.
7. **El formulario consulta el catálogo filtrado por el país de la cuenta.** Ni el componente ni el
   DTO conocen ningún nombre de documento. El `<select>` se llena desde un endpoint; el validador
   del servidor lee la misma fila. Esa identidad de fuente es lo que impide que deriven.

Todo lo que sigue se mide contra esto.

---

## 1. Resumen ejecutivo

El proyecto **ya resolvió bien este problema dos veces** y **no lo aplicó donde más duele**.

- El **registro de tenants** es ejemplar: `TAX_ID_RULES` indexa 19 países, valida
  aritméticamente, distingue `TaxpayerKind` (física/jurídica), canonicaliza por país y **rechaza**
  el país que no tiene algoritmo en vez de aceptar cualquier cosa
  (`localization/fiscal/tax-id-validators.ts`).
- La **facturación** ya extirpó el enum dominicano de su interfaz genérica: el tipo de documento
  fiscal es un `string` que pertenece al adaptador del país
  (`invoices/interfaces/fiscal-adapter.interface.ts:17-23`, en cuyo comentario consta la corrección).
- **RR.HH. no recibió ninguna de las dos lecciones.** El tipo de documento de un empleado es un
  `ENUM` de PostgreSQL con tres valores dominicanos, validado con los algoritmos de la DGII/JCE
  **sin ningún parámetro de país**, y presentado con tres `<option>` fijos en la plantilla.
- **Ventas y Compras no tienen el concepto en absoluto**: `taxId` es texto libre sin tipo y sin
  ninguna validación.

Y hay un agravante que convierte esto de deuda técnica en **defecto funcional**: el catálogo i18n
*enmascara* el enum dominicano traduciendo `document_type.cedula` a «SSN» en `en-US`, «RUN» en
`es-CL`, «DNI» en `es-PE`, «CPF» en `pt-BR`… mientras el backend sigue validando con el algoritmo de
la cédula dominicana. La interfaz pide un SSN y el servidor lo rechaza por no ser una cédula de 11
dígitos con verificador Luhn mod-10.

Además, **el catálogo correcto ya existe en la base de datos y nadie lo lee**:
`fiscal_regions.identityDocumentConfig` (JSONB, con `code`/`label`/`regex`/`isCompany`) se siembra en
cada arranque y no tiene un solo consumidor fuera de un *driver* de fallback. Y la tabla
`fiscal_document_type_definitions` existe desde el esquema base y **no se escribe ni se lee jamás**.

| Severidad | Nº |
|---|---|
| Crítica | 3 |
| Alta | 6 |
| Media | 7 |
| Baja | 3 |

**Veredicto.** No es «falta hacer el catálogo». Es que hay cuatro implementaciones distintas del
mismo concepto en el mismo repositorio, dos correctas, una rota y una ausente, y dos tablas de
catálogo vacías esperando a que alguien las use. La fuente de verdad única no falta por olvido:
falta porque nunca se decidió cuál de las cuatro lo era.

---

## 2. Hallazgos críticos

### C-01 · Enum rígido en base de datos · El tipo de documento del empleado es un `ENUM` de PostgreSQL con tres valores dominicanos

**Categoría:** enum rígido en base de datos
**Severidad:** **crítica**
**Módulo:** RR.HH. / Empleados

**Ubicación:**
- `apps/backend/api/src/app/hcm/entities/employee.entity.ts:22-28`
- `apps/backend/api/src/app/hcm/entities/employee.entity.ts:103-109`
- `apps/backend/api/src/app/database/migrations/1789003000000-PayrollModule.ts:41`
- `apps/backend/api/src/app/database/migrations/1789003000000-PayrollModule.ts:72`

```ts
// employee.entity.ts:22
export enum IdentityDocumentType {
  /** Dominican national id. */
  CEDULA = 'CEDULA',
  PASSPORT = 'PASSPORT',
  /** Tax id for a natural person acting as such. */
  RNC = 'RNC',
}
```

```ts
// 1789003000000-PayrollModule.ts:41
['employees_identity_document_type_enum', ['CEDULA', 'PASSPORT', 'RNC']],
// :72
ADD COLUMN IF NOT EXISTS "identity_document_type"
  "public"."employees_identity_document_type_enum" NOT NULL DEFAULT 'CEDULA',
```

**Qué está mal y por qué.** `CEDULA` y `RNC` son documentos de la República Dominicana escritos en
el esquema físico de una tabla que no es dominicana. El proyecto declara 19 mercados en
`COUNTRY_FISCAL_PROFILES`; dieciocho de ellos **no** emiten ninguno de los dos. Registrar el
primer empleado colombiano con cédula de extranjería, o el primer brasileño con RG, exige
`ALTER TYPE "employees_identity_document_type_enum" ADD VALUE …` — es decir, **una migración de
esquema y un despliegue por cada país**, que es exactamente el criterio que define este hallazgo
como crítico. Peor: en PostgreSQL, `ADD VALUE` no puede ejecutarse dentro de la misma transacción
que lo usa, y **no existe `DROP VALUE`**, de modo que el enum solo crece y nunca se puede corregir.

El `DEFAULT 'CEDULA'` sobre `NOT NULL` agrava el problema: todo empleado de cualquier país nace
marcado con un documento dominicano, y ese valor queda escrito en la fila aunque el documento esté
vacío. No hay forma de distinguir «no se ha declarado el tipo» de «es una cédula dominicana».

**Cómo se ve la forma correcta.** La columna pasa a ser una referencia al catálogo:
`identity_document_type_code varchar(32)` + `identity_document_country char(2)`, con clave foránea
compuesta a `identity_document_types(country_code, code)`. Sin `DEFAULT`, nullable mientras no se
haya capturado documento. El enum de PostgreSQL se elimina. Migración de datos: las filas
existentes son dominicanas por construcción, así que `('DO','CEDULA')`, `('DO','RNC')`,
`('DO','PASSPORT')` — salvo que `PASSPORT` merece revisión, porque un pasaporte no es de la
jurisdicción del empleador sino del país emisor del pasaporte (ver O-01).

---

### C-02 · Validación no desacoplada por país · El documento de todo empleado se valida con los algoritmos dominicanos, sin saber de qué país es

**Categoría:** validación no desacoplada por país
**Severidad:** **crítica**
**Módulo:** RR.HH. / Empleados (backend)

**Ubicación:** `apps/backend/api/src/app/hcm/validators/identity-document.validator.ts:17-72`

```ts
// :17  Dominican cédula check — 11 digits, JCE mod-10 (Luhn)
export function isValidCedula(raw: string): boolean {
  const cedula = digitsOnly(raw);
  if (cedula.length !== 11) return false;
  …
}
// :33  Dominican RNC check — 9 digits, DGII weighted mod-11
export function isValidRnc(raw: string): boolean {
  const rnc = digitsOnly(raw);
  if (rnc.length !== 9) return false;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  …
}
// :57
switch (type) {
  case IdentityDocumentType.CEDULA:   return isValidCedula(value);
  case IdentityDocumentType.RNC:      return isValidRnc(value);
  case IdentityDocumentType.PASSPORT: return isValidPassport(value);
  default:                            return false;
}
```

**Qué está mal y por qué.** El validador **no recibe el país en ningún punto**: ni por argumento,
ni desde la organización, ni desde el DTO. `IdentityDocumentForTypeConstraint.validate()` solo lee
`identityDocumentType` del propio objeto. `HcmService` tampoco añade contexto de país
(`hcm/hcm.service.ts:66-80` se limita a calcular el *blind index*). El resultado es que el algoritmo
de la Junta Central Electoral dominicana se aplica al documento de todo empleado del mundo.

Combinado con H-01 (el catálogo i18n renombra las opciones por locale), esto **rompe la alta de
empleados en todos los mercados donde hay traducción regional**, porque la interfaz invita
explícitamente a escribir un documento que el servidor va a rechazar:

| Locale del tenant | Lo que la UI pide (clave `document_type.cedula`) | Lo que el servidor exige | Resultado |
|---|---|---|---|
| `en-US` | «SSN» (9 dígitos) | cédula: 11 dígitos + Luhn mod-10 | **rechazo del 100 %** |
| `es-CL` | «RUN» (7-8 dígitos + DV, puede ser `K`) | ídem | **rechazo del 100 %** |
| `es-PE` | «DNI» (8 dígitos) | ídem | **rechazo del 100 %** |
| `es-AR` | «DNI» (7-8 dígitos) | ídem | **rechazo del 100 %** |
| `es-MX` | «CURP / INE» (18 alfanuméricos) | ídem | **rechazo del 100 %** |
| `es-CO` | «Cédula de ciudadanía» (6-10 dígitos, sin DV) | ídem | **rechazo del 100 %** |
| `pt-BR` | «CPF» (11 dígitos, verificador **distinto**) | ídem | rechazo salvo coincidencia fortuita |

Y en la otra opción, `document_type.rnc`: `en-US` la rotula «EIN» (9 dígitos **sin** dígito
verificador) y el servidor le aplica el mod-11 ponderado de la DGII — que rechazará la inmensa
mayoría de los EIN reales.

El campo es opcional (`if (value === … '') return true`), de modo que el empleado *puede* darse de
alta dejándolo vacío. Eso no atenúa el hallazgo: significa que en dieciocho países el producto solo
funciona si el cliente **no** usa el campo de identidad, en un módulo cuyo propósito es liquidar
nómina y presentar declaraciones nominativas.

**Cómo se ve la forma correcta.** `validate(value, { countryCode, typeCode })` resuelve la fila del
catálogo `(country, code)`, aplica su `pattern` y, si la fila declara `checksum`, invoca la función
registrada bajo ese nombre en un único registro de algoritmos —el mismo lugar donde ya viven
`isValidDominicanTaxId`, `isValidBrazilianCpf`, `isValidChileanRut`, `isValidUsSsnOrItin` y trece
más, en `tax-id-validators.ts`—. El `switch` desaparece. Un tipo cuyo `checksum` es nulo se valida
solo por patrón, que es el comportamiento correcto para un pasaporte.

**Nota sobre reutilización.** `tax-id-validators.ts` ya implementa los algoritmos de persona física
de nueve países (SSN/ITIN, CPF, RUN dentro del RUT chileno, DNI dentro del CUIT/CUIL…). El trabajo
aquí no es escribir criptografía de dígitos verificadores: es **enchufar RR.HH. a lo que ya existe**.

---

### C-03 · Enum rígido en base de datos · Los tipos de comprobante fiscal son un `ENUM` de PostgreSQL con los códigos de la DGII, en un módulo genérico

**Categoría:** enum rígido en base de datos
**Severidad:** **crítica**
**Módulo:** Cumplimiento / Secuencias fiscales

**Ubicación:**
- `apps/backend/api/src/app/compliance/entities/ncf-sequence.entity.ts:4-22` (enum `NcfType`)
- `apps/backend/api/src/app/compliance/entities/ncf-sequence.entity.ts:84-85` (`@Column({ type: 'enum', enum: NcfType })`)

```ts
export enum NcfType {
  B01 = 'B01', B02 = 'B02', B03 = 'B03', B04 = 'B04', B11 = 'B11', B15 = 'B15',
  E31 = 'E31', E32 = 'E32', E33 = 'E33', E34 = 'E34', E41 = 'E41',
  E43 = 'E43', E44 = 'E44', E45 = 'E45', E46 = 'E46', E47 = 'E47',
}
…
@Column({ type: 'enum', enum: NcfType })
type: NcfType;
```

**Qué está mal y por qué.** `B01`…`E47` son los códigos de comprobante de la DGII dominicana,
persistidos como enum de PostgreSQL en `ncf_sequences`, una tabla del módulo `compliance` que no
está acotado a la República Dominicana por ningún criterio. Los tipos de comprobante de Perú
(`01` factura, `03` boleta, `07` NC, `08` ND), de Chile (DTE `33`/`34`/`61`), de México (`I`/`E`/`P`)
o de Colombia no son expresables aquí, y añadirlos requiere migración de esquema.

Este hallazgo es especialmente llamativo porque **la corrección ya se hizo un módulo más allá**:
`invoices/interfaces/fiscal-adapter.interface.ts:17-23` documenta explícitamente que la interfaz
solía ser `readonly NcfType[]` y que eso «resolvía todos los demás países al adaptador genérico», y
lo cambió a `string`. La misma decisión no se propagó a la tabla que guarda los rangos.

El enum sigue además importado por ocho archivos fuera de `compliance/`, incluidos DTO de
facturación (`invoices/dto/create-invoice.dto.ts`, `issue-invoice.dto.ts`) y entidades de
facturación electrónica (`einvoicing/entities/fiscal-document-range.entity.ts`,
`ecf-lifecycle-message.entity.ts`).

**Cómo se ve la forma correcta.** `ncf_sequences.type` pasa a `varchar(8)` con clave foránea a
`fiscal_document_type_definitions(fiscal_region_id, code)` — **la tabla que ya existe y está vacía**
(ver A-06). El enum `NcfType` sobrevive, si se quiere, como constantes internas del adaptador
dominicano en `invoices/adapters/dominican-republic-fiscal.adapter.ts`, donde sí es correcto que
conozca los códigos de su propia autoridad.

---

## 3. Hallazgos altos

### A-01 · Clave de traducción que expone un concepto de país específico · `document_type.cedula` y `document_type.rnc` se usan como tabla de alias por país

**Categoría:** clave de traducción que expone un concepto de país específico
**Severidad:** alta
**Módulo:** i18n / RR.HH.

**Ubicación:**
- `libs/shared/locales/src/base/hcm.json:122` y `:132` (definición base)
- `libs/shared/locales/src/regional/en-US.json:4-5` → `"SSN"`, `"EIN"`
- `libs/shared/locales/src/regional/es-CL.json:6-7` → `"RUN"`, `"RUT"`
- `libs/shared/locales/src/regional/es-MX.json:6-7` → `"CURP / INE"`, `"RFC"`
- `libs/shared/locales/src/regional/es-CO.json:6-7` → `"Cédula de ciudadanía"`, `"NIT"`
- `libs/shared/locales/src/regional/es-PE.json:6-7` → `"DNI"`, `"RUC"`
- `libs/shared/locales/src/regional/es-AR.json:6-7` → `"DNI"`, `"CUIT / CUIL"`
- `libs/shared/locales/src/regional/pt-BR.json:6-7` → `"CPF"`, `"CNPJ"`
- `libs/shared/locales/src/regional/es-DO.json:8-9` → `"Cédula"`, `"RNC"`

**Qué está mal y por qué.** La clave en sí es el hallazgo, y por partida doble.

*Primero*, el nombre. `hcm.employees.form.document_type.cedula` afirma que «cédula» es un concepto
del dominio del producto y no un dato del catálogo de un país. Esto es exactamente lo que la regla
de «cero texto o concepto hardcodeado» de la auditoría de i18n prohíbe: una clave no debe delatar
de qué país nació el sistema. La clave hermana `.rnc` es peor todavía, porque «RNC» no es siquiera
genérico dentro de la República Dominicana — es el identificador fiscal, no un documento de
identidad personal.

*Segundo*, y más grave, **el uso**. Estas dos claves no traducen: **renombran**. `cedula` significa
«SSN» en Estados Unidos, «RUN» en Chile, «CPF» en Brasil y «CURP / INE» en México. Eso no es
localización de una misma cosa a varios idiomas; es un catálogo de tipos de documento por país
implementado dentro del archivo de traducciones, con dos entradas fijas, sin patrón de validación,
sin obligatoriedad y sin persona física/jurídica. Es el catálogo que falta, disfrazado, y disfrazado
de una forma que **impide** que el backend lo consulte: `applyRegionalCatalogue()`
(`libs/shared/ui-i18n/src/lib/regional-catalogue.ts:33-43`) vive en el cliente.

*Tercero*, la cobertura. Los parches regionales se seleccionan por `${idioma}-${país del tenant}`
(`libs/shared/ui-i18n/src/lib/locale.store.ts:85-91`) y **solo existen ocho**: `en-US`, `es-AR`,
`es-CL`, `es-CO`, `es-DO`, `es-MX`, `es-PE`, `pt-BR`. Frente a los 19 países de
`COUNTRY_FISCAL_PROFILES`, **once mercados no tienen parche** (EC, UY, PY, BO, VE, PA, CR, GT, SV,
HN, NI) y caen a la base: un tenant ecuatoriano ve «Documento de identidad» / «Identificación
fiscal», dos etiquetas genéricas detrás de las cuales se ejecutan los algoritmos dominicanos. Un
tenant angloparlante en la República Dominicana (`en-DO`) tampoco tiene parche y ve las mismas dos.

**Cómo se ve la forma correcta.** Las dos claves desaparecen del catálogo i18n. La etiqueta de cada
tipo de documento es un campo del catálogo (`label_key`), con valores como
`document_type.co.cc`, `document_type.co.ce`, `document_type.br.cpf`, y el `<select>` se llena
desde el endpoint, no desde un `<option>` por clave conocida. La clave i18n pasa a estar **generada
por el dato**, que es la única forma de que añadir un país no obligue a tocar el catálogo de
traducciones.

---

### A-02 · Documento hardcodeado · El `<select>` de tipo de documento tiene tres `<option>` fijos en la plantilla

**Categoría:** documento hardcodeado
**Severidad:** alta
**Módulo:** RR.HH. / Empleados (frontend)

**Ubicación:**
- `apps/core/client-web/src/app/features/hcm/employees/form/form.page.html:58-62`
- `apps/core/client-web/src/app/features/hcm/employees/form/form.page.ts:100`
- `apps/core/client-web/src/app/features/hcm/data/hcm.service.ts:8`

```html
<select formControlName="identityDocumentType">
  <option value="CEDULA">{{ 'hcm.employees.form.document_type.cedula' | translate }}</option>
  <option value="PASSPORT">{{ 'hcm.employees.form.document_type.passport' | translate }}</option>
  <option value="RNC">{{ 'hcm.employees.form.document_type.rnc' | translate }}</option>
</select>
```

```ts
// form.page.ts:100
identityDocumentType: ['CEDULA'],
// hcm.service.ts:8
export type IdentityDocumentType = 'CEDULA' | 'PASSPORT' | 'RNC';
```

**Qué está mal y por qué.** Tres opciones fijas, en ese orden, para todos los países; el valor por
defecto del formulario es el documento dominicano; y el *union type* del cliente duplica el enum del
servidor, de modo que hay dos listas cerradas que hay que mantener sincronizadas a mano. El
componente **no inyecta `CountryService`** (que existe, en
`apps/core/client-web/src/app/core/services/country.service.ts`) ni consulta nada sobre el país del
tenant. Añadir un tipo de documento obliga a editar la plantilla, el *union type*, el enum del
backend, la migración y el catálogo i18n: cinco archivos en tres capas, por país.

Además, el número de opciones es incorrecto incluso conceptualmente. Colombia usa, como mínimo, CC,
CE, TI, NIT, pasaporte y PEP para nómina; México, CURP y RFC; Brasil, CPF y RG. La estructura
«dos documentos nacionales + pasaporte» es la estructura dominicana, no una estructura universal.

**Cómo se ve la forma correcta.** El componente pide
`GET /localization/countries/:code/identity-document-types?appliesTo=individual`, recibe filas
`{ code, labelKey, pattern, required, appliesTo }` y las renderiza con `@for`. Sin valor por
defecto salvo que el catálogo marque uno (`is_default`). El *union type* del cliente se borra: el
código es `string`, porque es un dato.

---

### A-03 · Falta de catálogo único · El mismo concepto está implementado de cuatro formas distintas en el mismo repositorio

**Categoría:** falta de catálogo único
**Severidad:** alta
**Módulo:** transversal

**Ubicación:** las cuatro implementaciones

| # | Módulo | Dónde | Forma | Valida | País |
|---|---|---|---|---|---|
| 1 | Registro / Alta de tenant | `localization/fiscal/tax-id-validators.ts:680` (`TAX_ID_RULES`) | mapa `Record<país, reglas>` en código, 19 países, con `TaxpayerKind` y canonicalización | **sí**, aritméticamente | **sí** |
| 2 | Facturación | `invoices/interfaces/fiscal-adapter.interface.ts:14-25` | `string` + adaptador por régimen | sí, el adaptador | **sí** |
| 3 | RR.HH. / Empleados | `hcm/entities/employee.entity.ts:22` | `ENUM` de PostgreSQL, 3 valores dominicanos | sí, pero con algoritmos dominicanos | **no** |
| 4 | Ventas / Compras | `customers/entities/customer.entity.ts:83-84`, `suppliers/entities/supplier.entity.ts:31` | `varchar` libre, **sin tipo de documento** | **no** | no |

**Qué está mal y por qué.** Cuatro respuestas a la misma pregunta —«¿cómo se identifica legalmente
una persona o empresa en este país?»— conviviendo en el mismo servicio. Dos son correctas y no se
reutilizan; una es incorrecta; una no existe. Ninguna de las cuatro puede servir de fuente de verdad
a las otras tres porque ninguna modela el problema completo:

- (1) modela **un** identificador fiscal por país y por `TaxpayerKind`; no modela «la lista de
  documentos con los que puede identificarse una persona», que es lo que RR.HH. necesita. Su tipo
  `individualDocument?: { code; label; pattern }` (`country-profiles.ts:133`) es singular, y **solo
  está poblado en 2 de los 19 países** (DO en `:716`, US en `:742`).
- (2) modela tipos de **comprobante**, no de identidad.
- (3) y (4) no modelan nada reutilizable.

La divergencia no es teórica: hoy produce comportamientos incompatibles en un mismo tenant. Un
tenant chileno registra su RUT validado con el algoritmo chileno correcto (mod-11 con `K`), da de
alta un cliente con un RUT que nadie valida, y no puede dar de alta a ningún empleado con su RUN
porque el servidor le exige una cédula dominicana. Tres módulos, tres verdades, un solo usuario.

**Cómo se ve la forma correcta.** Un catálogo (§6) del que **beben los cuatro**. `TAX_ID_RULES` no
se tira: se convierte en el **registro de algoritmos** que el catálogo referencia por nombre, que
es lo que ya es de hecho. Los adaptadores de facturación siguen siendo dueños de sus códigos de
comprobante. RR.HH., Ventas y Compras consultan el catálogo por país.

---

### A-04 · Falta de catálogo único · Ventas y Compras no tienen tipo de documento, y su `taxId` no se valida en absoluto

**Categoría:** falta de catálogo único
**Severidad:** alta
**Módulo:** Ventas / Clientes · Compras / Proveedores

**Ubicación:**
- `apps/backend/api/src/app/customers/entities/customer.entity.ts:83-84`
- `apps/backend/api/src/app/customers/dto/create-customer.dto.ts:40-42`
- `apps/backend/api/src/app/suppliers/entities/supplier.entity.ts:31`
- `apps/core/client-web/src/app/features/contacts/customer-form/customer-form.page.html:34-35`
- `apps/core/client-web/src/app/features/contacts/supplier-form/supplier-form.html:32-33`

```ts
// create-customer.dto.ts:40
@IsString()
@IsOptional()
taxId?: string;
```

```html
<!-- customer-form.page.html:34 -->
<label for="taxId">{{ 'contacts.customer_form.tax_id' | translate }}</label>
<input id="taxId" formControlName="taxId" />
```

**Qué está mal y por qué.** El identificador del tercero es una cadena libre sin tipo asociado y sin
una sola restricción más allá de «es un string». No hay `@Matches`, no hay validador por país, no
hay `documentType`. Consecuencias concretas:

- **No se puede saber qué se guardó.** En la República Dominicana un cliente puede identificarse con
  RNC (9 dígitos, empresa) o con cédula (11 dígitos, persona). La columna no distingue cuál es, y
  la facturación electrónica sí necesita distinguirlo: el e-CF lleva el tipo. Hoy solo se puede
  inferir por longitud, que es precisamente la heurística que
  `invoices/dto/create-invoice.dto.ts:174-175` documenta haber eliminado del tipo de comprobante por
  ser incorrecta.
- **Entra basura.** Un NIT colombiano mal tecleado se acepta, se guarda, y falla meses después
  cuando la DIAN rechaza la factura. El proyecto ya argumenta exactamente esto en
  `tax-id-validators.ts:673-678` («aceptar un tax id no validado en un producto fiscal significa que
  lo primero que el cliente descubre es que sus facturas son rechazadas») — y lo aplica al registro
  del tenant, pero no a sus clientes ni a sus proveedores.
- **La etiqueta miente por locale.** `contacts.customer_form.tax_id` se sobrescribe a «RNC / Cédula»
  en `es-DO`, «CUIT» en `es-AR`, «CNPJ / CPF» en `pt-BR`: un único campo rotulado con dos documentos
  distintos separados por una barra, porque no hay dónde poner el tipo.

**Cómo se ve la forma correcta.** `customers` y `suppliers` ganan
`identity_document_type_code` + `identity_document_country`, con la misma FK al catálogo que
`employees`, y `taxId` se renombra a `identity_document` o se conserva como el valor. El DTO valida
contra la fila del catálogo. El formulario muestra un `<select>` alimentado por el mismo endpoint
que RR.HH. El campo deja de rotularse «RNC / Cédula» porque deja de ser un campo que sirve para dos
cosas.

> **A verificar, no inventar:** si el tenant puede tener clientes extranjeros (lo normal en
> exportación), el catálogo debe consultarse por el país **del cliente**, no por el del tenant, y la
> fila de `customers` necesita `country_code` propio. No he auditado si la entidad `Customer` ya
> guarda el país del cliente; conviene confirmarlo antes de diseñar la FK.

---

### A-05 · Falta de catálogo único · El catálogo correcto ya existe en la base de datos, se siembra en cada arranque, y nadie lo consume

**Categoría:** falta de catálogo único
**Severidad:** alta
**Módulo:** Localización

**Ubicación:**
- `apps/backend/api/src/app/localization/entities/fiscal-region.entity.ts:64-69` (columna JSONB)
- `apps/backend/api/src/app/localization/services/localization.service.ts:143-176` (siembra)
- `apps/backend/api/src/app/localization/drivers/db-driven-fiscal.strategy.ts:11-20, 28-34` (únicos lectores)

```ts
// fiscal-region.entity.ts:64
@Column({ type: 'jsonb', nullable: true })
identityDocumentConfig: {
  types: { code: string; label: string; regex: string; isCompany: boolean }[];
  validationApiUrl?: string;
};
```

**Qué está mal y por qué.** Esta columna **es** el catálogo pedido: una lista de tipos de documento
por región fiscal, cada uno con código, etiqueta, patrón y aplicabilidad a persona jurídica. Existe
desde el esquema base (`1700000000000-BaselineSchema.ts:89`), se puebla en cada arranque desde
`COUNTRY_FISCAL_PROFILES` (`onModuleInit → seedFiscalRegions`), y sus **únicos** lectores son dos
métodos de `DbDrivenFiscalStrategy`, una estrategia de fallback cuyo `validateTaxId` termina en
`return true` cuando no encuentra patrón (`db-driven-fiscal.strategy.ts:19`). RR.HH. no la lee.
Ventas no la lee. Compras no la lee. El formulario de registro tampoco: usa
`PublicCountryConfig`, que expone `taxIdLabel` y **un** `individualDocument`
(`localization/fiscal/public-country-config.ts:22-29`), no la lista.

Y tal como se siembra hoy, tampoco serviría todavía, por cuatro defectos de la propia siembra:

1. **El código se deriva de la etiqueta humana**, borrando lo no-ASCII
   (`localization.service.ts:146`):
   ```ts
   code: profile.taxId.label.replace(/[^A-Za-z]/g, '').toUpperCase() || 'TAXID',
   ```
   Para la República Dominicana, `'RNC / Cédula'` produce el código **`RNCCDULA`** (la `é` se
   elimina). Para Costa Rica, `'Cédula jurídica'` produce **`CDULAJURDICA`**. Son identificadores
   que nadie escribió a propósito, que cambian si alguien retoca la etiqueta, y que no corresponden
   a ningún código publicado por ninguna autoridad.
2. **Máximo dos entradas por país**: el identificador fiscal de empresa, y `individualDocument` si
   existe — y `individualDocument` solo está definido en **2 de 19** perfiles (DO y US). Diecisiete
   países quedan con **una sola** entrada, marcada `isCompany: true`.
3. **`isCompany` es booleano**, así que no puede expresar «aplica a ambos», que es el caso del RUT
   chileno, del NIT colombiano y del RUC peruano — los tres presentes en el producto.
4. **No hay obligatoriedad ni checksum**: solo `regex`, con lo cual todo dígito verificador queda
   fuera y la validación es estrictamente más débil que la que `tax-id-validators.ts` ya sabe hacer.

**Cómo se ve la forma correcta.** La JSONB se normaliza a una tabla de verdad (§6), el `code` se
declara explícitamente en el perfil de cada país en lugar de derivarse de una etiqueta,
`isCompany: boolean` pasa a `applies_to: 'individual' | 'company' | 'both'`, y se añaden
`required` y `checksum`. Y entonces **se conecta**: `PublicCountryConfig` expone la lista completa,
y RR.HH., Ventas y Compras la consultan.

---

### A-06 · Falta de catálogo único · La tabla `fiscal_document_type_definitions` existe desde el esquema base y nunca se escribe ni se lee

**Categoría:** falta de catálogo único
**Severidad:** alta
**Módulo:** Localización / Cumplimiento

**Ubicación:**
- `apps/backend/api/src/app/localization/entities/fiscal-document-type-definition.entity.ts` (completa)
- `apps/backend/api/src/app/database/migrations/1700000000000-BaselineSchema.ts:87` y `:311`
- `apps/backend/api/src/app/localization/entities/fiscal-region.entity.ts:59-61` (relación)

```ts
@Entity({ name: 'fiscal_document_type_definitions' })
export class FiscalDocumentTypeDefinition {
  @Column() code: string;              // e.g., '01', 'B01'
  @Column() name: string;              // e.g., 'Factura de Crédito Fiscal'
  @Column({ nullable: true }) sequenceFormat: string;
  @Column({ default: false }) expirationRequired: boolean;
  @ManyToOne('FiscalRegion', 'documentDefinitions') fiscalRegion: FiscalRegion;
}
```

**Qué está mal y por qué.** Esta es, exactamente, la tabla-catálogo por jurisdicción que C-03
necesita para dejar de ser un `ENUM`. Está declarada, migrada, relacionada con `FiscalRegion` y
registrada en `localization-provisioning.module.ts:50`. Una búsqueda en todo el repositorio
devuelve **cero** consultas, cero inserciones y cero *seeds*: sus únicas apariciones son la
declaración, la migración y el registro del módulo. Mientras tanto, los mismos datos que debería
contener viven hardcodeados como `enum NcfType` en `compliance/`.

El propio comentario de la entidad (`// e.g., '01', 'B01'`) documenta que se diseñó para albergar
tanto los códigos peruanos como los dominicanos. Nadie la llenó.

Que una tabla de catálogo lleve inerte desde el esquema base mientras el código hardcodea sus filas
es el síntoma más claro de que el problema no es de diseño sino de **adopción**: alguien vio la
forma correcta, la creó, y ningún módulo la tomó como fuente de verdad.

**Cómo se ve la forma correcta.** Se siembra desde los adaptadores de régimen
(`einvoicing/regimes/*/`), que ya conocen los códigos de su autoridad, y `ncf_sequences.type` pasa a
referenciarla por `(fiscal_region_id, code)`.

---

## 4. Hallazgos medios

### M-01 · Documento hardcodeado · Columnas de seguridad social dominicanas (`tss_nss`, `afp_code`, `sfs_code`) en la tabla universal de empleados, con el formato del NSS dominicano exigido a todo el mundo

**Categoría:** documento hardcodeado · validación no desacoplada por país
**Severidad:** media
**Módulo:** RR.HH. / Nómina

**Ubicación:**
- `apps/backend/api/src/app/hcm/entities/employee.entity.ts:132-143`
- `apps/backend/api/src/app/hcm/dto/create-employee.dto.ts:73-76`

```ts
// employee.entity.ts:133
/** TSS number (NSS). Identifies the person in every TSS filing. */
@Column({ name: 'tss_nss', type: 'varchar', nullable: true })  tssNss: string | null;
/** The pension fund (AFP) the person is enrolled in. */
@Column({ name: 'afp_code', type: 'varchar', nullable: true }) afpCode: string | null;
/** The health fund (ARS/SFS) the person is enrolled in. */
@Column({ name: 'sfs_code', type: 'varchar', nullable: true }) sfsCode: string | null;
```

```ts
// create-employee.dto.ts:75
@Matches(/^\d{7,11}$/, { message: 'validation.create_employee.tss_nss_format' })
tssNss?: string;
```

**Qué está mal y por qué.** TSS (Tesorería de la Seguridad Social), AFP y SFS/ARS son instituciones
dominicanas, y sus nombres están en el esquema físico de una tabla que no lo es. El equivalente
mexicano es el NSS del IMSS más la CURP; el brasileño, el PIS/PASEP y el INSS; el colombiano, la
afiliación a EPS y AFP con estructura distinta; el chileno, AFP e ISAPRE/FONASA. Un tenant peruano
guardará su código de ESSALUD en una columna llamada `sfs_code`, lo cual es un problema de
mantenimiento hoy y un problema de migración de datos cuando se corrija.

El `@Matches(/^\d{7,11}$/)` es el mismo error que C-02 en menor escala: el formato del NSS
dominicano aplicado a todos los países. La clave del mensaje de error lo confirma —
`validation.create_employee.tss_nss_format` se sobrescribe en `es-DO.json:11` a «El NSS de la TSS
debe tener entre 7 y 11 dígitos.»: la regla *y* su explicación son dominicanas.

Severidad media y no alta porque los tres campos son opcionales y su ausencia no bloquea el alta,
a diferencia de C-02.

**Cómo se ve la forma correcta.** Un `social_security_enrolments` por empleado con
`(scheme_code, country_code, value)` alimentado por el mismo catálogo de esquemas de seguridad
social por jurisdicción, o —mínimo viable— un JSONB `statutory_enrolment` cuyas claves y patrones
declare la estrategia de nómina del país. La estructura para esto **ya existe**:
`payroll/jurisdictions/jurisdiction-registry.ts` resuelve la estrategia de nómina por país y su
comentario dice literalmente «registrar un país nuevo es añadir una entrada al mapa». El registro
de campos estatutarios pertenece a esa estrategia, no a tres columnas de `employees`.

---

### M-02 · Documento hardcodeado · El buscador global rotula el identificador de todo cliente como «RNC»

**Categoría:** documento hardcodeado
**Severidad:** media
**Módulo:** Búsqueda

**Ubicación:** `apps/backend/api/src/app/search/search.service.ts:63`

```ts
description: `RNC: ${c.taxId}`,
```

**Qué está mal y por qué.** Cadena literal, construida en el servidor, sin pasar por i18n, con el
nombre del identificador fiscal dominicano. Un tenant brasileño que busca un cliente ve
`RNC: 11.222.333/0001-81` sobre un CNPJ. Es además doblemente incorrecto dentro de la propia
República Dominicana, donde ese mismo campo puede contener una cédula.

**Cómo se ve la forma correcta.** El servidor devuelve `{ taxId, documentTypeCode, countryCode }`
y el cliente compone la etiqueta desde el catálogo. Si el resultado de búsqueda tiene que llegar
pre-renderizado, la etiqueta se resuelve por i18n con la clave del catálogo, nunca por
concatenación de un literal.

---

### M-03 · Documento hardcodeado · La columna exportable/importable de clientes se llama `rnc` en el contrato público de datos

**Categoría:** documento hardcodeado
**Severidad:** media
**Módulo:** Hojas de datos (importación / exportación)

**Ubicación:** `apps/backend/api/src/app/datasheets/services/datasheet-import.service.ts:111`

```ts
columns: {
  nombre: 'companyName',
  rnc: 'taxId',
  correo: 'email',
  …
}
```

**Qué está mal y por qué.** El mapa de columnas define el **contrato público** del CSV/hoja que el
cliente sube y descarga. La cabecera que verá un cliente chileno o brasileño para su columna de
identificador es `rnc`. Corregirlo más tarde rompe las plantillas que los clientes ya tengan
guardadas, de modo que el coste de este hallazgo crece con cada mes de retraso — razón por la que,
pese a ser «solo un nombre», merece atención antes del lanzamiento y no después.

(De paso: todo el mapa está en español —`nombre`, `correo`, `telefono`, `direccion`, `fecha`— en un
producto multi-idioma con `pt` y `en` en el catálogo. Fuera del alcance de esta auditoría, pero es
el mismo defecto.)

**Cómo se ve la forma correcta.** La cabecera es una clave estable y neutra (`tax_id` /
`identity_document`) y la hoja se rotula con la etiqueta traducida del catálogo al exportar,
aceptando ambas al importar durante un periodo de gracia.

---

### M-04 · Clave de traducción que expone un concepto de país específico · Claves i18n con `rnc` en el nombre para un campo genérico

**Categoría:** clave de traducción que expone un concepto de país específico
**Severidad:** media
**Módulo:** Ajustes / i18n

**Ubicación:**
- `libs/shared/locales/src/base/settings.json:420` — `settings.company_profile.id_fiscal_rnc_tax_id`
- `libs/shared/locales/src/base/settings.json:2819` — `settings.subsidiaries.id_fiscal_rnc_tax_id`
- Consumidas en `apps/core/client-web/src/app/features/settings/company-profile/company-profile.page.html:52`
  y `…/settings/organization/subsidiaries/subsidiaries.page.html:76`
- Sobrescritas en los 8 parches regionales (p. ej. `pt-BR.json:12` → `"CNPJ"`, `es-CL.json:10` → `"RUT"`)

**Qué está mal y por qué.** El **valor** de la clave está bien: `"Identificación fiscal"` / `"Tax ID"`
es correctamente neutro. El **nombre** de la clave no: contiene `rnc`, lo que documenta en el
catálogo que el campo nació como el RNC dominicano. Es el mismo defecto que A-01, en su forma
benigna —aquí el valor base no miente y los parches regionales sí traducen la misma cosa, no cosas
distintas—, pero contradice igualmente la regla de «ninguna clave delata el país de origen» y
resulta desconcertante para quien añade un mercado nuevo.

**Cómo se ve la forma correcta.** Renombrar a `settings.company_profile.tax_id` y
`settings.subsidiaries.tax_id`, con entrada en `tools/i18n/migration/rename-map.json` para que la
herramienta de migración arrastre los ocho parches regionales.

---

### M-05 · Enum rígido en base de datos · El enum dominicano está fijado también en la herramienta de i18n

**Categoría:** enum rígido en base de datos (propagación)
**Severidad:** media
**Módulo:** Tooling i18n

**Ubicación:** `libs/shared/locales/src/composed-keys.json:164-168`

```json
"hcm.employees.form.document_type": [
  "CEDULA",
  "RNC",
  "PASSPORT"
],
```

**Qué está mal y por qué.** `composed-keys.json` declara las familias de claves cuyo último
segmento se compone en runtime, para que `verify-catalogues.mjs` no las dé por muertas y
`translation-coverage.spec` compruebe que existen en todos los idiomas. Al listar aquí los tres
valores del enum, **una cuarta capa** —el tooling de traducciones— pasa a conocer los tipos de
documento dominicanos. Añadir un tipo obliga ahora a tocar también este archivo, o la comprobación
de cobertura fallará.

Es el indicador más limpio de lo que cuesta un enum mal puesto: empezó en una migración y terminó
en el verificador de catálogos, atravesando entidad, DTO, validador, servicio del cliente,
plantilla y ocho archivos de traducción.

**Cómo se ve la forma correcta.** Cuando la etiqueta pase a ser un `label_key` del catálogo, esta
familia se declara como **dominio abierto** (`[]`, que el propio `$note` del archivo contempla:
«un array vacío significa que el dominio es abierto») o desaparece, porque las claves dejarán de
componerse a partir de un enum cerrado.

---

### M-06 · Documento hardcodeado · Las etiquetas de identificador en `COUNTRY_FISCAL_PROFILES` son literales en español, traducidos por búsqueda inversa sobre el propio literal

**Categoría:** documento hardcodeado · clave de traducción
**Severidad:** media
**Módulo:** Localización

**Ubicación:**
- `apps/backend/api/src/app/localization/fiscal/country-profiles.ts:715-716` (DO), `:740-742` (US), y las 17 restantes
- `apps/backend/api/src/app/localization/fiscal/fiscal-label-keys.ts:38-89` (`FISCAL_LABEL_KEYS`)

```ts
// country-profiles.ts:715
taxId: { label: 'RNC / Cédula', example: '131-12345-7', pattern: '…', hasCheckDigit: true },
individualDocument: { code: 'CEDULA', label: 'Cédula', pattern: '^\\d{11}$' },
```

```ts
// fiscal-label-keys.ts:38 — Spanish literal → catalogue key
export const FISCAL_LABEL_KEYS: Readonly<Record<string, string>> = {
  Provincia: 'fiscal.labels.province',
  'Código postal': 'fiscal.labels.postal_code',
  …
};
```

**Qué está mal y por qué.** El catálogo guarda la palabra, no la clave, y la traducción se resuelve
después **buscando el literal español en un diccionario inverso**. El archivo argumenta esta
decisión con solidez (la terminología propia de una autoridad no debe traducirse: «Ubigeo» traducido
a «District code» es más difícil de encontrar en el papel que el usuario está copiando, no menos), y
ese argumento es correcto **para el valor mostrado**. Pero no justifica el mecanismo: indexar por el
literal significa que cambiar una tilde rompe la traducción en silencio, que el mismo literal en dos
países comparte destino obligatoriamente, y que una etiqueta nueva no traducida es indistinguible
de una deliberadamente no traducida —el propio archivo lo admite: «una etiqueta sin entrada aquí no
es un olvido, es la segunda categoría»—. Esa ambigüedad es exactamente lo que una clave explícita
elimina.

**Cómo se ve la forma correcta.** Cada entrada del catálogo lleva `label_key` **y**, opcionalmente,
`label_verbatim` para los casos donde la decisión consciente es no traducir. El destino deja de
inferirse del texto: se declara. `FISCAL_LABEL_KEYS` desaparece.

---

### M-07 · Documento hardcodeado · `ncf_number` / `ncf_expires_at` como nombres de columna en la tabla universal de facturas

**Categoría:** documento hardcodeado
**Severidad:** media
**Módulo:** Facturación

**Ubicación:**
- `apps/backend/api/src/app/invoices/entities/invoice.entity.ts:109-110`, `:117-118`
- índice `UQ_invoices_org_ncf` en `:85-87`

```ts
/** Fiscal number (NCF / e-NCF in the Dominican Republic). Null while the document is a draft…
@Column({ name: 'ncf_number', type: 'varchar', nullable: true })  ncfNumber?: string | null;
/** Expiry of the DGII authorization that covers `ncfNumber`, stamped at issuance. */
@Column({ name: 'ncf_expires_at', type: 'date', nullable: true }) ncfExpiresAt?: string | null;
```

**Qué está mal y por qué.** NCF es «Número de Comprobante Fiscal», un término de la DGII, usado como
nombre de la columna que guarda el folio fiscal de cualquier país: el folio del CFDI mexicano, el
número de DTE chileno o la chave de acesso de la NF-e brasileña se guardan en `ncf_number`. El
comentario ya reconoce que es genérico («Fiscal number (NCF / e-NCF **in the Dominican Republic**)»),
lo que confirma que la semántica se generalizó y el nombre no.

Severidad media, no alta: es `varchar`, no enum, así que no bloquea añadir países —solo confunde a
quien lea el esquema y deja la marca dominicana en un contrato de datos duradero.

**Cómo se ve la forma correcta.** `fiscal_number` / `fiscal_number_expires_at`, con el índice
renombrado en consecuencia. Migración de renombrado puro, sin transformación de datos.

---

## 5. Hallazgos bajos

### B-01 · Validación no desacoplada por país · Un validador `IsRNC` dominicano vive exportado en una librería compartida de nombre genérico, sin consumidores

**Categoría:** validación no desacoplada por país
**Severidad:** baja
**Módulo:** `libs/shared/util-auth`

**Ubicación:**
- `libs/shared/util-auth/src/lib/decorators/is-rnc.decorator.ts` (completo)
- `libs/shared/util-auth/src/index.ts:2` (exportado en la API pública de la librería)

```ts
defaultMessage(args: ValidationArguments) {
  return 'El RNC debe ser válido (9 u 11 dígitos y cumplir algoritmo de validación)';
}
```

**Qué está mal y por qué.** Una librería llamada `util-auth`, compartida por todo el monorepo,
exporta un decorador que implementa los algoritmos de la DGII y de la JCE dominicanas, con el
mensaje de error en español codificado a mano en vez de como clave i18n. **Ningún archivo lo
importa** (la única referencia es su propio `export *`), así que hoy no causa daño; el riesgo es que
esté ahí, en la superficie pública de una librería genérica, invitando a que el próximo módulo que
necesite validar un identificador lo use en lugar de `tax-id-validators.ts`. Es también una tercera
copia de los mismos dos algoritmos, que ya viven en `hcm/validators/identity-document.validator.ts`
y en `localization/fiscal/tax-id-validators.ts`.

**Cómo se ve la forma correcta.** Borrarlo. `IsTaxIdValidForCountry()`, ya en uso en
`auth/dto/register-user.dto.ts:78`, es su sustituto correcto y consciente del país.

---

### B-02 · Documento hardcodeado · Placeholder con formato de RNC dominicano en Ajustes, sin traducir

**Categoría:** documento hardcodeado
**Severidad:** baja
**Módulo:** Ajustes / Perfil de empresa y Sucursales

**Ubicación:**
- `apps/core/client-web/src/app/features/settings/company-profile/company-profile.page.html:56`
- `apps/core/client-web/src/app/features/settings/organization/subsidiaries/subsidiaries.page.html:77`

```html
<input id="taxId" type="text" formControlName="taxId" placeholder="Ej. 132-45678-9">
```

**Qué está mal y por qué.** `132-45678-9` es la forma de un RNC dominicano, escrita como literal en
la plantilla, con «Ej.» en español fuera del sistema de traducción. Un tenant argentino recibe como
ejemplo de CUIT el formato de un RNC. Es especialmente visible en Sucursales, donde **cada sucursal
tiene su propio país** (`subsidiaries.page.html:41` muestra `sub.subsidiary.country`) y el ejemplo
sigue siendo dominicano para todas.

**Cómo se ve la forma correcta.** El `placeholder` se enlaza a `taxIdExample` del país
correspondiente — campo que `PublicCountryConfig` **ya expone**
(`public-country-config.ts:23`) y que el formulario de registro ya consume correctamente.

---

### B-03 · Falta de catálogo único · `fiscal_regions.tax_id_name` persiste una etiqueta humana en vez de una clave i18n

**Categoría:** falta de catálogo único
**Severidad:** baja
**Módulo:** Localización

**Ubicación:**
- `apps/backend/api/src/app/localization/entities/fiscal-region.entity.ts:44-45`
- `apps/backend/api/src/app/localization/drivers/dominican-republic/dominican-republic.strategy.ts:83`

```ts
@Column({ name: 'tax_id_name', default: 'Tax ID' })
taxIdLabel: string; // 'RNC', 'NIT', 'EIN'
```

**Qué está mal y por qué.** La base de datos guarda la palabra que se mostrará, con el `DEFAULT`
en inglés. Cualquier consumidor que la renderice está mostrando texto no traducible, y el comentario
del propio campo enumera tres documentos de tres países como ejemplo de lo que contiene. Es el mismo
defecto que M-06, un nivel más abajo: la etiqueta debería ser una clave.

Severidad baja porque los consumidores actuales de esta columna son el *driver* de fallback y la
siembra, no la interfaz principal —que lee `PublicCountryConfig`—.

**Cómo se ve la forma correcta.** `tax_id_label_key varchar` con valores como
`fiscal.tax_id_label.do`, resuelto por i18n en el cliente; o, si la decisión consciente es mostrar
la terminología de la autoridad sin traducir (M-06), declararlo explícitamente con
`tax_id_label_verbatim`.

---

## 6. El catálogo propuesto

Una tabla, sembrada como datos de referencia global (no por tenant), consultada por RR.HH., Ventas,
Compras, Registro y Facturación electrónica.

```sql
CREATE TABLE identity_document_types (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identidad de la entrada ------------------------------------------------
  country_code       char(2)      NOT NULL,   -- ISO 3166-1 alpha-2. Jurisdicción emisora.
  code               varchar(32)  NOT NULL,   -- Código de la autoridad, declarado, NUNCA derivado
                                              -- de la etiqueta. 'CC', 'CE', 'NIT', 'CPF', 'CURP'…
  -- Presentación -----------------------------------------------------------
  label_key          varchar(128) NOT NULL,   -- Clave i18n. 'document_type.co.cc'. Nunca la palabra.
  label_verbatim     varchar(64)  NULL,       -- Terminología de la autoridad que NO debe traducirse
                                              -- ('Ubigeo', 'CUIT'). Si está, gana sobre label_key.
  example            varchar(64)  NULL,       -- Placeholder. Nunca un identificador real emitido.

  -- Validación -------------------------------------------------------------
  pattern            varchar(256) NOT NULL,   -- Regex anclada en ambos extremos. Forma, no verdad.
  checksum           varchar(48)  NULL,       -- NOMBRE del algoritmo de dígito verificador
                                              -- ('do_cedula_luhn10', 'br_cpf', 'cl_rut_mod11'),
                                              -- resuelto contra el registro de funciones que hoy
                                              -- es tax-id-validators.ts. NULL = solo patrón.
  canonical_form     varchar(32)  NOT NULL DEFAULT 'alphanumeric',
                                              -- 'digits' | 'alphanumeric' | 'segmented'.
                                              -- Ya implementado en tax-id-validators.ts:594-613.

  -- Aplicabilidad ----------------------------------------------------------
  applies_to         varchar(16)  NOT NULL,   -- 'individual' | 'company' | 'both'.
                                              -- Booleano NO: el RUT chileno es 'both'.
  requirement        varchar(16)  NOT NULL,   -- 'required' | 'optional'.
                                              -- La INEXISTENCIA se expresa por AUSENCIA DE FILA,
                                              -- no por un tercer valor: un país no declara los
                                              -- documentos que no emite.
  used_for           text[]       NOT NULL DEFAULT '{}',
                                              -- Contextos: 'payroll','invoicing','registration'.
                                              -- México pide CURP para nómina y RFC para facturar;
                                              -- sin esto, el formulario de empleados ofrece el RFC.
  is_default         boolean      NOT NULL DEFAULT false,
                                              -- A lo sumo uno por (country_code, applies_to,
                                              -- contexto). Sustituye al DEFAULT 'CEDULA'.
  issuing_authority  varchar(64)  NULL,       -- 'JCE', 'DGII', 'RENIEC', 'Receita Federal'.
  valid_from         date         NULL,       -- Un documento que una reforma sustituye no se borra:
  valid_until        date         NULL,       -- las filas históricas deben seguir resolviéndose.
  sort_order         smallint     NOT NULL DEFAULT 0,

  CONSTRAINT uq_identity_document_types UNIQUE (country_code, code),
  CONSTRAINT ck_applies_to  CHECK (applies_to  IN ('individual','company','both')),
  CONSTRAINT ck_requirement CHECK (requirement IN ('required','optional'))
);
```

**Columnas mínimas pedidas, y dónde están:** código → `code`; país → `country_code`; etiqueta como
clave i18n → `label_key`; patrón de validación → `pattern` (+ `checksum` para el dígito verificador,
que una regex no puede expresar); obligatorio/opcional → `requirement` (+ ausencia de fila para
«inexistente»); persona física/jurídica → `applies_to`.

**Cómo lo referencian las tablas de negocio.** Sustituyendo los enums y los `varchar` sueltos:

```sql
ALTER TABLE employees
  ADD COLUMN identity_document_country char(2),
  ADD COLUMN identity_document_type_code varchar(32),
  ADD CONSTRAINT fk_employees_identity_document
    FOREIGN KEY (identity_document_country, identity_document_type_code)
    REFERENCES identity_document_types (country_code, code);
-- y, una vez migrados los datos:
--   ALTER TABLE employees DROP COLUMN identity_document_type;
--   DROP TYPE employees_identity_document_type_enum;
```

Lo mismo para `customers` y `suppliers` (hoy sin ninguna columna de tipo, A-04).

**El endpoint.** Uno solo, público para el registro y autenticado para el resto:

```
GET /localization/countries/:countryCode/identity-document-types?appliesTo=individual&usedFor=payroll
→ [{ code, labelKey, labelVerbatim, example, pattern, requirement, appliesTo, isDefault }]
```

`pattern` viaja al cliente para retroalimentación inmediata; `checksum` **no** —el algoritmo se
ejecuta en el servidor, que es donde se decide—. Es el mismo reparto que ya practica
`country-profiles.ts:100-114` para el `taxId` del tenant.

**Ejemplo de filas (República Dominicana, país piloto):**

| country | code | label_key | pattern | checksum | applies_to | requirement | used_for |
|---|---|---|---|---|---|---|---|
| DO | `CEDULA` | `document_type.do.cedula` | `^\d{11}$` | `do_cedula_luhn10` | individual | required | payroll, invoicing |
| DO | `RNC` | `document_type.do.rnc` | `^\d{9}$` | `do_rnc_mod11` | company | required | invoicing, registration |
| DO | `PASSPORT` | `document_type.passport` | `^[A-Za-z0-9]{5,20}$` | *(null)* | individual | optional | payroll |

> **A verificar, no inventar.** Las tres filas de arriba son las únicas que puedo afirmar a partir
> del código auditado, porque los algoritmos dominicanos están implementados y verificados en
> `tax-id-validators.spec.ts`. **No he modelado las filas de los otros 18 países y no debo
> inventarlas.** Antes de dar el catálogo por suficiente hay que confirmar con fuente oficial, por
> cada mercado: qué documentos admite la autoridad para identificar a un empleado y a un tercero,
> cuál es obligatorio para nómina, cuál para facturar, y si alguno lleva dígito verificador.
> Colombia (CC/CE/TI/NIT/pasaporte/PEP) y México (CURP para nómina, RFC para facturar) son, por lo
> que se ve en los parches i18n existentes, los dos casos que más probablemente **no** caben en la
> estructura «dos documentos + pasaporte» heredada del modelo dominicano, y por tanto los mejores
> para poner a prueba si el esquema propuesto es realmente suficiente.
>
> Un punto de diseño aún abierto, que conviene resolver con ellos delante: `PASSPORT` no pertenece
> a la jurisdicción del empleador sino a la del país emisor. O bien se modela como una fila por
> país (duplicándola 19 veces), o bien se admite `country_code = 'XX'` para documentos
> supranacionales. Me inclino por lo segundo, pero es una decisión que debe tomarse con el caso
> colombiano y el mexicano sobre la mesa, no antes.

---

## 7. Inventario completo, por módulo

Todos los lugares donde se encontró un documento o concepto legal específico de un país escrito
directamente en el código.

### RR.HH. / Empleados · Nómina

| Archivo:línea | Literal hardcodeado | Capa | Hallazgo |
|---|---|---|---|
| `apps/backend/api/src/app/hcm/entities/employee.entity.ts:22-28` | `CEDULA`, `RNC` (enum TS) | backend | C-01 |
| `apps/backend/api/src/app/hcm/entities/employee.entity.ts:103-109` | `enum` + `default: CEDULA` | BD | C-01 |
| `apps/backend/api/src/app/hcm/entities/employee.entity.ts:111` | comentario «HMAC of the cédula» | backend | C-01 |
| `apps/backend/api/src/app/hcm/entities/employee.entity.ts:133-143` | `tss_nss`, `afp_code`, `sfs_code` | BD | M-01 |
| `apps/backend/api/src/app/database/migrations/1789003000000-PayrollModule.ts:41` | `['CEDULA','PASSPORT','RNC']` | BD | C-01 |
| `apps/backend/api/src/app/database/migrations/1789003000000-PayrollModule.ts:72` | `NOT NULL DEFAULT 'CEDULA'` | BD | C-01 |
| `apps/backend/api/src/app/hcm/validators/identity-document.validator.ts:17-28` | `isValidCedula` (JCE mod-10) | backend | C-02 |
| `apps/backend/api/src/app/hcm/validators/identity-document.validator.ts:33-41` | `isValidRnc` (DGII mod-11) | backend | C-02 |
| `apps/backend/api/src/app/hcm/validators/identity-document.validator.ts:57-65` | `switch` por tipo, sin país | backend | C-02 |
| `apps/backend/api/src/app/hcm/dto/create-employee.dto.ts:53-55` | `@IsEnum(IdentityDocumentType)` | backend | C-01 |
| `apps/backend/api/src/app/hcm/dto/create-employee.dto.ts:75` | `@Matches(/^\d{7,11}$/)` (NSS TSS) | backend | M-01 |
| `apps/core/client-web/…/hcm/employees/form/form.page.html:59-61` | `value="CEDULA"`, `"PASSPORT"`, `"RNC"` | frontend | A-02 |
| `apps/core/client-web/…/hcm/employees/form/form.page.ts:100` | `identityDocumentType: ['CEDULA']` | frontend | A-02 |
| `apps/core/client-web/…/hcm/data/hcm.service.ts:8` | `'CEDULA' \| 'PASSPORT' \| 'RNC'` | frontend | A-02 |

### Ventas / Clientes · Compras / Proveedores

| Archivo:línea | Problema | Capa | Hallazgo |
|---|---|---|---|
| `apps/backend/api/src/app/customers/entities/customer.entity.ts:83-84` | `taxId` sin tipo de documento | BD | A-04 |
| `apps/backend/api/src/app/customers/dto/create-customer.dto.ts:40-42` | `@IsString()` sin validación por país | backend | A-04 |
| `apps/backend/api/src/app/suppliers/entities/supplier.entity.ts:31` | `taxId` sin tipo de documento | BD | A-04 |
| `apps/core/client-web/…/contacts/customer-form/customer-form.page.html:34-35` | input libre, etiqueta «RNC / Cédula» en `es-DO` | frontend | A-04 |
| `apps/core/client-web/…/contacts/supplier-form/supplier-form.html:32-33` | ídem | frontend | A-04 |

### Cumplimiento / Facturación

| Archivo:línea | Literal hardcodeado | Capa | Hallazgo |
|---|---|---|---|
| `apps/backend/api/src/app/compliance/entities/ncf-sequence.entity.ts:4-22` | `B01`…`E47` (enum TS) | backend | C-03 |
| `apps/backend/api/src/app/compliance/entities/ncf-sequence.entity.ts:84-85` | `@Column({ type:'enum', enum: NcfType })` | BD | C-03 |
| `apps/backend/api/src/app/invoices/entities/invoice.entity.ts:109-110, 117-118` | `ncf_number`, `ncf_expires_at` | BD | M-07 |
| `apps/backend/api/src/app/invoices/entities/invoice.entity.ts:85` | índice `UQ_invoices_org_ncf` | BD | M-07 |

### Localización (la fuente de verdad que no se usa)

| Archivo:línea | Problema | Capa | Hallazgo |
|---|---|---|---|
| `apps/backend/api/src/app/localization/entities/fiscal-region.entity.ts:64-69` | catálogo JSONB sin consumidores reales | BD | A-05 |
| `apps/backend/api/src/app/localization/services/localization.service.ts:146` | `code` derivado de la etiqueta → `RNCCDULA` | backend | A-05 |
| `apps/backend/api/src/app/localization/services/localization.service.ts:143-160` | máx. 2 entradas; `isCompany` booleano | backend | A-05 |
| `apps/backend/api/src/app/localization/entities/fiscal-document-type-definition.entity.ts` | tabla catálogo **totalmente muerta** | BD | A-06 |
| `apps/backend/api/src/app/localization/entities/fiscal-region.entity.ts:44-45` | `tax_id_name` guarda la palabra, no la clave | BD | B-03 |
| `apps/backend/api/src/app/localization/fiscal/country-profiles.ts:715-716` | `label: 'RNC / Cédula'`, `code: 'CEDULA'` | backend | M-06 |
| `apps/backend/api/src/app/localization/fiscal/country-profiles.ts:133` | `individualDocument` singular, 2/19 poblado | backend | A-03 |
| `apps/backend/api/src/app/localization/fiscal/fiscal-label-keys.ts:38-89` | traducción por búsqueda inversa del literal | backend | M-06 |
| `apps/backend/api/src/app/localization/drivers/dominican-republic/…strategy.ts:83` | `taxIdLabel: 'RNC'` | backend | B-03 |
| `apps/backend/api/src/app/localization/drivers/db-driven-fiscal.strategy.ts:19` | `return true` cuando no hay patrón | backend | A-05 |

### i18n (catálogos y tooling)

| Archivo:línea | Literal / clave | Hallazgo |
|---|---|---|
| `libs/shared/locales/src/base/hcm.json:122, 132` | claves `document_type.cedula` / `.rnc` | A-01 |
| `libs/shared/locales/src/regional/en-US.json:4-5` | `"SSN"`, `"EIN"` bajo `.cedula` / `.rnc` | A-01 |
| `libs/shared/locales/src/regional/es-CL.json:6-7` | `"RUN"`, `"RUT"` | A-01 |
| `libs/shared/locales/src/regional/es-MX.json:6-7` | `"CURP / INE"`, `"RFC"` | A-01 |
| `libs/shared/locales/src/regional/es-CO.json:6-7` | `"Cédula de ciudadanía"`, `"NIT"` | A-01 |
| `libs/shared/locales/src/regional/es-PE.json:6-7` | `"DNI"`, `"RUC"` | A-01 |
| `libs/shared/locales/src/regional/es-AR.json:6-7` | `"DNI"`, `"CUIT / CUIL"` | A-01 |
| `libs/shared/locales/src/regional/pt-BR.json:6-7` | `"CPF"`, `"CNPJ"` | A-01 |
| `libs/shared/locales/src/regional/es-DO.json:8-9` | `"Cédula"`, `"RNC"` | A-01 |
| `libs/shared/locales/src/base/settings.json:420, 2819` | claves `…id_fiscal_rnc_tax_id` | M-04 |
| `libs/shared/locales/src/composed-keys.json:164-168` | `["CEDULA","RNC","PASSPORT"]` | M-05 |
| *(11 de 19 países sin parche regional: EC, UY, PY, BO, VE, PA, CR, GT, SV, HN, NI)* | — | A-01 |

### Transversal

| Archivo:línea | Literal hardcodeado | Hallazgo |
|---|---|---|
| `apps/backend/api/src/app/search/search.service.ts:63` | `` `RNC: ${c.taxId}` `` | M-02 |
| `apps/backend/api/src/app/datasheets/services/datasheet-import.service.ts:111` | columna `rnc:` | M-03 |
| `libs/shared/util-auth/src/lib/decorators/is-rnc.decorator.ts` | `IsRNC` + mensaje en español | B-01 |
| `libs/shared/util-auth/src/index.ts:2` | exportado en la API pública | B-01 |
| `apps/core/client-web/…/settings/company-profile/company-profile.page.html:56` | `placeholder="Ej. 132-45678-9"` | B-02 |
| `apps/core/client-web/…/settings/organization/subsidiaries/subsidiaries.page.html:77` | ídem | B-02 |

---

## 8. Orden de corrección sugerido

No por severidad, sino por dependencia: cada paso habilita el siguiente.

1. **Construir `identity_document_types`** (§6) y sembrarlo desde `COUNTRY_FISCAL_PROFILES`, con
   `code` declarado explícitamente en cada perfil en vez de derivado de la etiqueta (A-05). Nada
   se rompe: solo se añade.
2. **Extraer el registro de algoritmos de `tax-id-validators.ts`**, indexado por el nombre que la
   columna `checksum` referencia. El código ya está escrito; se trata de exponerlo por nombre.
3. **Exponer el endpoint** y añadir la lista a `PublicCountryConfig` (A-05).
4. **Conectar RR.HH.**: validador por catálogo (C-02) y `<select>` dinámico (A-02). Aquí se paga
   el defecto funcional: a partir de este punto un empleado chileno, peruano o estadounidense puede
   darse de alta con su documento.
5. **Migrar el enum de `employees`** a FK, y eliminar `employees_identity_document_type_enum`
   (C-01). Después de (4), para que el enum no esté vivo y muerto a la vez.
6. **Retirar las claves `document_type.cedula` / `.rnc`** de los nueve archivos i18n y de
   `composed-keys.json` (A-01, M-05), ya sin consumidores.
7. **Conectar Ventas y Compras** (A-04), que es donde el catálogo deja de ser una corrección y
   pasa a ser una capacidad nueva.
8. **Sembrar `fiscal_document_type_definitions` y migrar `ncf_sequences.type`** (C-03, A-06).
   Independiente de 1-7; puede ir en paralelo.
9. **Renombrados y limpieza**: M-02, M-03, M-04, M-07, B-01, B-02, B-03.

Los pasos 1-6 son lo que hace falta para que **un cliente de cualquiera de los 19 países soportados
pueda dar de alta a un empleado el día 0**, que es el requisito que esta auditoría tenía que medir.
Hoy no puede: en once mercados ve dos etiquetas genéricas, y en los siete que sí tienen traducción
regional, la interfaz le pide un documento que el servidor rechaza.
