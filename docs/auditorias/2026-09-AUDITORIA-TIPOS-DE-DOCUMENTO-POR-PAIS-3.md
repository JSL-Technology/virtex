# Auditoría — Tipos de documento/identidad hardcodeados por país (tercera pasada)

**Fecha:** 2026-09-18
**Alcance:** todo el proyecto (backend, frontend, i18n, esquema de base de datos)
**Antecedentes:** [primera pasada](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS.md) y [segunda pasada](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS-2.md). Esta tercera pasada re-audita contra los mismos invariantes: confirma cuáles ya se cumplen (con evidencia) y reporta lo que sigue hardcodeado como si fuera universal.

---

## Paso 0 — El estándar (ya implementado)

La forma correcta es un **catálogo**, no un enum: cada entrada es un par `(país, código)` con su etiqueta (clave i18n o término verbatim de la autoridad), su patrón, su algoritmo de checksum por nombre, a quién identifica (persona física / jurídica / ambas), su obligatoriedad, y en qué contexto del producto se pide (nómina / facturación / registro). El formulario y la validación consultan ese catálogo filtrado por el país de la cuenta.

Ese catálogo **ya existe** en `apps/backend/api/src/app/localization/fiscal/identity-document-catalogue.ts` (interfaz `IdentityDocumentTypeSpec`, líneas 91-140) y respalda una tabla `identity_document_types` sembrada por país. Las pasadas 1 y 2 lo construyeron y migraron los módulos a él. Esta pasada mide qué falta para que el catálogo sea *la única* fuente de verdad, sin caminos paralelos que reintroduzcan el hardcode.

---

## Estado de los invariantes (verificado en esta pasada)

| Invariante | Estado | Evidencia |
|---|---|---|
| Cero enum de BD de tipos de documento | ✅ | El enum `employees_identity_document_type_enum` (`CEDULA`/`PASSPORT`/`RNC`) fue eliminado por la migración `1789005200000-EmployeeIdentityDocumentCatalogue.ts`; empleados/clientes/proveedores guardan el par `(identity_document_type_code, identity_document_country)` contra el catálogo. |
| Catálogo, no enum, para agregar países | ✅ | Agregar un mercado es un `INSERT` en `identity_document_types` (o una fila en `IDENTITY_DOCUMENT_TYPES`), sin `ALTER TYPE` ni deploy. |
| Formularios consultan el catálogo, no listas fijas | ✅ | `customer-form.page.ts:45`, `supplier-form.ts:47`, `hcm/employees/form/form.page.ts:85` cargan `documentTypes` desde el endpoint; el registro usa `nPattern`/`individualDocument` del config del país (`register.page.ts`). No quedan `<option>` de documento hardcodeados. |
| Validación desacoplada por país | ✅ | `validateTaxId` / `TAX_ID_VALIDATORS` derivan del catálogo (`identity-document-catalogue.ts:599-700`); se retiró `TAX_ID_RULES`. |
| Claves i18n no delatan un concepto de país | ✅ | `document_type.cedula`/`.rnc` se retiraron; las etiquetas van por `identity_document.*` con `labelVerbatim` (el término que imprime la autoridad). |
| Reportes específicos de país guardados | ✅ | 606/607/608/609 ahora exigen `country === 'DO'` (`compliance.service.ts:414-421`) en vez de generar un archivo DGII para cualquier tenant. |

**Conclusión parcial:** la arquitectura del catálogo es correcta y los puntos de *captura* de identidad (formularios, entidades, validadores) ya no tienen documentos hardcodeados. Los hallazgos abiertos que siguen están en los puntos de *consumo* — donde el código vuelve a **inferir** el tipo de documento en vez de leer el que ya se guardó — y en **defaults de país** hardcodeados a `'DO'`.

---

## Hallazgos abiertos

### H-01 — Los generadores de e-facturación infieren el tipo de documento del comprador contando dígitos

- **Categoría:** validación/derivación no desacoplada por país (se reintroduce la inferencia que el catálogo eliminó)
- **Severidad:** **alta**
- **Ubicación / módulo:** `einvoicing/regimes`
  - Brasil — `br/nfe.builder.ts:164` → `dest.ele(buyerDocument.length === 14 ? 'CNPJ' : 'CPF', {}, buyerDocument)`; y `:172` → `indIEDest` decidido por la misma longitud.
  - Argentina — `ar/afip.builder.ts:196-200` → `buyerDocumentType()` devuelve `80` (CUIT) / `96` (DNI) / `99` según el largo; y `:185-186` decide "responsable inscripto" con `length === 11`.
  - Perú — `pe/sunat.builder.ts:162-167` → `customerDocumentType()` devuelve `'6'` (RUC) / `'1'` (DNI) / `'0'` según el largo.
- **Qué está mal y por qué:** el `Customer` ya guarda `identityDocumentTypeCode` (`customers/entities/customer.entity.ts:113-118`) y `taxpayerType` — el código de catálogo que se eligió al capturar el dato. Estos tres builders lo ignoran y **vuelven a deducir** el tipo de documento a partir de la forma del número, que es exactamente la inferencia que el catálogo se construyó para eliminar. Contar dígitos es frágil: un CPF con dígito de más, un RUC de 8 dígitos versus un DNI, o un número mal tecleado, colisionan y se declaran a la autoridad con el tipo equivocado. Además el catálogo ya tiene un campo hecho a medida para esto — `regimeCodes` (`identity-document-catalogue.ts:135-139`, "this document's code in each electronic-invoicing regime, so a builder can state the buyer's document type without inferring it from the number's length") — pero está poblado en **cero** filas y leído por **cero** builders.
- **Cómo se ve la forma correcta:** poblar `regimeCodes` en cada fila (`BR.CNPJ → { nfe: 'CNPJ' }`, `BR.CPF → { nfe: 'CPF' }`, `AR.CUIT → { afip: '80' }`, `AR.DNI → { afip: '96' }`, `PE.RUC → { sunat: '6' }`, `PE.DNI → { sunat: '1' }`…); el builder resuelve `customer.identityDocumentTypeCode` en el catálogo y emite `spec.regimeCodes[regime]`. El único caso que queda por forma —"consumidor final sin identificar"— se decide por **ausencia** de documento, no por longitud.

### H-02 — País por defecto hardcodeado a `'DO'`

- **Categoría:** concepto de un país específico hardcodeado (jurisdicción asumida)
- **Severidad:** **media-alta**
- **Ubicación / módulo:** Nómina e i18n
  - `payroll/payroll.controller.ts:209, 215, 221, 227` → cuatro endpoints con `@Query('country') country = 'DO'`.
  - `payroll/entities/payroll-run.entity.ts:66` → `@Column({ name: 'country_code', length: 2, default: 'DO' })`.
  - `i18n/request-locale.ts:83` → `const countryCode = (tenant?.countryCode ?? '').toUpperCase() || 'DO'`.
- **Qué está mal y por qué:** un tenant costarricense o mexicano que llame `GET /payroll/parameters` (o `/contributions`, `/references`, `/tax-brackets`) sin `?country=`, o cuya corrida se cree sin país explícito, recibe **en silencio** los parámetros estatutarios dominicanos (AFP/SFS/ISR) — deducciones incorrectas, no un error. El default a `'DO'` convierte "no sé de qué país es" en "es República Dominicana". El propio `shared/tenancy/tenant-country.resolver.ts:15` documenta haber quitado este mismo `?? 'DO'` de `payroll-run.service.ts`; falta terminar de aplicarlo en el controlador y en el default de columna.
- **Cómo se ve la forma correcta:** derivar el país del tenant vía `TenantCountryResolver`, y **fallar cerrado** (400) cuando no se puede determinar, en vez de asumir DO. La columna `country_code` debe poblarse desde el país de la corrida, sin `default`. (El `|| 'DO'` de `auth/services/dev-seeder.service.ts:43` es config de desarrollo y es aceptable.)

### H-03 — Los identificadores estatutarios se modelan como datos, pero el formulario no los renderiza por país

- **Categoría:** falta de surface del catálogo (el dato está por país; la UI asume un conjunto dominicano)
- **Severidad:** **media**
- **Ubicación / módulo:** RR.HH. / Nómina
  - Datos (correcto): `payroll/jurisdictions/jurisdiction-strategy.interface.ts` define `StatutoryIdentifierSpec[]`; `dominican-republic.strategy.ts` lo puebla; `hcm.service.ts` lo consume (`forCountry(country).statutoryIdentifiers`).
  - Surface (faltante): `hcm/entities/employee.entity.ts:192-213` guarda `socialSecurityNumber` + `statutoryEnrolment jsonb`; el formulario `hcm/employees/form/form.page.html:83-84` renderiza **un solo** input fijo `socialSecurityNumber`. No hay endpoint que exponga los `statutoryIdentifiers` del país (a diferencia de `GET .../identity-document-types`).
- **Qué está mal y por qué:** el modelado de datos es correcto (spec por país, no columnas dominicanas), pero la UI todavía asume la forma dominicana: un único número de seguridad social, sin validación ni etiqueta por país, y sin poder pedir un segundo/tercer identificador que otro país sí exige. Es el mismo patrón que ya se resolvió para el documento de identidad, un nivel más arriba, a medio camino.
- **Cómo se ve la forma correcta:** un endpoint `GET .../statutory-identifier-types` (paralelo a `identity-document-types`) que devuelva los `StatutoryIdentifierSpec` del país del tenant, y que el formulario los renderice dinámicamente (etiqueta, patrón, obligatoriedad) igual que hace con los documentos de identidad. *Nota de cobertura, no de arquitectura:* hoy solo existe la estrategia de jurisdicción de RD; los demás mercados tendrán specs vacíos hasta que se agregue su estrategia — eso es cobertura pendiente de nómina, no un hardcode.

### H-04 — Regla de negocio por país incrustada en línea (recargo por servicio)

- **Categoría:** concepto de un país específico hardcodeado (no es un tipo de documento, pero es el mismo antipatrón)
- **Severidad:** **baja-media**
- **Ubicación / módulo:** `invoices/invoices.service.ts:1414`
  - `serviceChargeRate: countryCode === 'DO' || countryCode === 'CR' ? 0.1 : 0`
- **Qué está mal y por qué:** la tasa del recargo por servicio (la "ley"/propina del 10 %) vive como un `if` de país en línea, en vez de como un dato del perfil fiscal del país. Cuando se agregue el próximo país con recargo obligatorio, esto obliga a tocar código en vez de datos — exactamente lo que el resto del esfuerzo evita. Se reporta como adyacente al alcance porque no es un documento de identidad, pero comparte el defecto de fondo: "conocer un país por su nombre en el código".
- **Cómo se ve la forma correcta:** mover la tasa al perfil fiscal del país (`country-profiles.ts` o la configuración de país correspondiente) como un campo `serviceChargeRate`, y que `invoices.service` lo lea del perfil.

---

## Catálogo de referencia (ya implementado) y sus dos extensiones

El catálogo objetivo **ya está** en `IdentityDocumentTypeSpec`. Columnas mínimas (todas presentes):

| Columna | Rol |
|---|---|
| `countryCode` | ISO alpha-2 de la jurisdicción emisora (`XX` para supranacional, p.ej. pasaporte) |
| `code` | código de la autoridad (`RNC`, `RUC`, `CNPJ`…), declarado, nunca derivado de la etiqueta |
| `labelKey` / `labelVerbatim` | clave i18n; el término verbatim de la autoridad gana al renderizar |
| `pattern` + `checksum` | forma + algoritmo por nombre (`document-checksums.ts`) |
| `appliesTo` | `individual` / `company` / `both` |
| `requirement` | `required` / `optional` (la inexistencia se expresa por **ausencia de fila**) |
| `usedFor` | `payroll` / `invoicing` / `registration` |
| `isDefault`, `sortOrder`, `issuingAuthority` | preselección y presentación |

Las dos extensiones que faltan para cerrar los hallazgos:

1. **Poblar `regimeCodes`** (ya declarado en la interfaz, línea 139) en las filas de los países con e-facturación, para que H-01 lea el tipo de documento en vez de contar dígitos.
2. **Un catálogo paralelo `statutory_identifier_types`** (mismas columnas: `país`, `código`, `labelKey`, `pattern`, `appliesTo` trabajador/empleador, `required`), expuesto por endpoint y renderizado por el formulario, para cerrar H-03. El modelado por `StatutoryIdentifierSpec` ya es la mitad de esto.

---

## Lista de lo que queda hardcodeado, por módulo

**einvoicing (regimes)** — inferencia del tipo de documento del comprador por longitud, en vez de leer el código de catálogo guardado (H-01):
- `br/nfe.builder.ts:164` (`CNPJ`/`CPF`), `:172` (`indIEDest`)
- `ar/afip.builder.ts:196-200` (`80`/`96`/`99`), `:185-186` (responsable inscripto por `length === 11`)
- `pe/sunat.builder.ts:162-167` (`6`/`1`/`0`)

**payroll** — país por defecto `'DO'` (H-02):
- `payroll.controller.ts:209, 215, 221, 227`
- `entities/payroll-run.entity.ts:66`

**i18n** — país por defecto `'DO'` (H-02):
- `request-locale.ts:83`

**hcm** — identificadores estatutarios no renderizados por país (H-03):
- `hcm/employees/form/form.page.html:83-84` (input fijo `socialSecurityNumber`; falta endpoint + render dinámico)

**invoices** — regla de negocio de país en línea (H-04, adyacente):
- `invoices.service.ts:1414` (`serviceChargeRate` por `countryCode`)

**No son hallazgos (verificado):** los términos de país en `mx-electronic-accounting.ts` (`RFC`), `ecf-lifecycle-xml.builder.ts` (`RNC`) y las estrategias por país son correctos — son formatos *inherentemente* de una sola jurisdicción. Las migraciones históricas que crearon el enum (`1789003000000`, `1789005200000`) tampoco lo son: son historia aplicada y la última **retira** el enum hacia el catálogo.
</content>
</invoke>
