# Auditoría — Tipos de documento/identidad hardcodeados por país (quinta pasada)

**Fecha:** 2026-09-18
**Alcance:** todo el proyecto (backend, frontend, i18n, esquema de base de datos)
**Antecedentes:** [primera](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS.md), [segunda](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS-2.md), [tercera](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS-3.md) y [cuarta](./2026-09-AUDITORIA-TIPOS-DE-DOCUMENTO-POR-PAIS-4.md) pasada. Esta quinta pasada re-audita contra los mismos invariantes tras cerrar H-01…H-06, confirma que los puntos de captura y **los cinco** regímenes de consumo siguen limpios, y encuentra **un** foco restante: una **fuente de verdad paralela muerta** en `localization/drivers/` que todavía cargaba etiquetas y validación de documento hardcodeadas por país.

> **Estado: RESUELTO.** El único hallazgo que reporta este documento se corrigió. Verificado en verde: `tsc` del backend (`tsconfig.app.json`, exit 0) y las suites de `localization` + `einvoicing` (15 suites, 734 tests; afip/nfe/sunat/cfdi/sii/sri/dian, catálogo de identidad, validadores fiscales). *(La única spec roja del entorno — `localization.service.spec.ts › getPublicCountryConfig › taxIdLabel`, "RNC / Cédula" vs "RNC" — **se verificó que falla idéntica en el árbol limpio sin estos cambios**: depende de un `fiscal_region` sembrado en base de datos, ausente en este sandbox (`No existe fiscal_region para DO` / `ECONNREFUSED`). Es ambiental, no una regresión, exactamente como anotó la cuarta pasada.)*
>
> - **H-07** — el sistema de `FiscalStrategy` (`localization/drivers/`) declaraba `getConfig()` (que devolvía `taxIdLabel: 'RNC'` / `'EIN/SSN'` / `'Tax ID'` y un `taxIdRegex`/`taxIdMask` por país) y `validateTaxId()` (que distinguía RNC de cédula **contando dígitos**), ambos con **cero llamadores**. Se estrechó la interfaz a su único método vivo y genuinamente por-país — el lookup al registro externo de la autoridad (la API de la DGII) — y se eliminaron los dos métodos muertos y sus literales.

---

## Estado de los invariantes (reverificado en esta pasada)

| Invariante | Estado | Evidencia |
|---|---|---|
| Cero enum de BD de tipos de documento | ✅ | par `(código, país)`; sin cambios desde la 3ª pasada |
| Cero unión TS `'CEDULA' \| 'RNC' \| …` en código vivo | ✅ | `git grep` sin resultados en `apps/**/src` (fuera de specs) |
| Claves i18n no delatan un país | ✅ | vivas: `identity_document.*`; los únicos `document_type.*` son comentarios que describen lo **retirado** |
| Captura consulta el catálogo | ✅ | customer/supplier/employee forms cargan `documentTypes` por `usedFor`; el único literal `'Cédula'` es el mock de test |
| Consumo (e-facturación) desacoplado | ✅ | BR/AR/PE/EC/CO leen `regimeCodes`; `indIEDest` (NFe) y "responsable inscripto" (AFIP) ya derivan del catálogo, no de `.length` |
| Sin default `'DO'` | ✅ | todo hit es data DR-scoped, la estrategia DR declarando su propio país, o un comentario del fix H-02 |
| Identificadores estatutarios por país | ✅ | el form de empleado renderiza `@for (spec of statutoryFields())` dinámicamente (H-03) |
| **Una sola fuente de verdad para etiqueta + validación del documento** | ✅ *(ahora sí)* | eliminada la fuente paralela muerta `FiscalStrategy.getConfig()/validateTaxId()` (H-07) |

**Conclusión:** cerrado el último foco conocido. La etiqueta del identificador fiscal (`fiscalIdentifierLabel`) y su validación (`validateTaxId`) salen únicamente del catálogo, para todos los mercados. No queda ningún camino paralelo — ni vivo ni muerto — que nombre o valide un documento por país fuera del catálogo.

---

## Hallazgo (resuelto)

### H-07 — Fuente de verdad paralela *muerta* con etiqueta y validación hardcodeadas por país

- **Categoría:** falta de catálogo único / documento hardcodeado / validación no desacoplada por país
- **Severidad:** **baja** *(sería **alta** si estuviera cableada — se comprobó que no lo estaba)*
- **Ubicación / módulo:** `localization/drivers/`
  - `fiscal-strategy.interface.ts` — la interfaz `FiscalStrategy` (y su base `BaseFiscalStrategy`) declaraban `getConfig()` y `validateTaxId()`.
  - `dominican-republic/dominican-republic.strategy.ts:83` → `taxIdLabel: 'RNC'`; `:86-87` → `taxIdRegex`/`taxIdMask`; `:15-56` → `validateTaxId` con la aritmética RNC/cédula distinguida por **longitud** (`str.length === 9 / 11`).
  - `usa/usa.strategy.ts:29` → `taxIdLabel: 'EIN/SSN'`; `:9-15` → `validateTaxId` = `clean.length === 9`.
  - `generic-fiscal.strategy.ts:19` → `taxIdLabel: 'Tax ID'`, `taxIdRegex: '.*'`; `validateTaxId` = `return true` (aceptaba cualquier cosa).
- **Qué está mal y por qué:** `getConfig()` tenía **cero llamadores** — la config pública ya se arma desde el catálogo en `localization.service.ts` (`fiscalIdentifierFor` → `labelVerbatim ?? translate(labelKey)`, líneas 308-325) — y `strategy.validateTaxId` tampoco se llamaba: la validación pasa por el `validateTaxId` del catálogo (líneas 365/389) y por `IdentityDocumentService`. El único método vivo era `getTaxIdDetails()`, usado por `lookupTaxId` (línea 413) para el enriquecimiento contra el registro externo de la autoridad (la API de la DGII, propia de RD). Mientras la interfaz siguiera anunciando `getConfig()`/`validateTaxId()` como métodos de primera clase, sobrevivían en el árbol: la etiqueta `'RNC'`/`'EIN/SSN'` como literal (en contradicción con la etiqueta que deriva del catálogo) y el mismísimo antipatrón de "contar dígitos → RNC o cédula" que el catálogo se construyó para eliminar. Ni el lint ni los tests lo marcaban; un desarrollador futuro podía recablear cualquiera de los dos y reintroducir el hardcode en silencio.
- **Cómo se ve la forma correcta (aplicada):** estrechar la interfaz a su único método vivo y genuinamente por-país, y renombrarla acorde — ya no es una "fiscal strategy" completa, es un **lookup de registro fiscal**:
  - Nuevo `drivers/tax-id-registry-lookup.ts`: `interface TaxIdRegistryLookup { getTaxIdDetails(taxId): Promise<any> }` + `BaseTaxIdRegistryLookup`. Se eliminó de paso el `import { RegisterUserDto }` sin uso.
  - Borrado `drivers/fiscal-strategy.interface.ts`.
  - Las tres estrategias pierden `getConfig()` y `validateTaxId()` (y con ellas los literales `taxIdLabel`/`taxIdRegex`/`taxIdMask` y la ramificación por longitud). RD conserva su lookup a la DGII; US y GENERIC devuelven `null` (no hay registro externo), equivalente a no tener driver — `lookupTaxId` toma su rama sin-driver.
  - `localization.service.ts`: el `Map<string, FiscalStrategy>` pasa a `Map<string, TaxIdRegistryLookup>`.

---

## Lista de lo que quedaba hardcodeado, por módulo (todo resuelto)

**localization (drivers)** — fuente de verdad paralela muerta con etiqueta + validación por país (H-07):
- `fiscal-strategy.interface.ts` — interfaz con `getConfig()`/`validateTaxId()` → reemplazada por `tax-id-registry-lookup.ts` (solo `getTaxIdDetails`). ✔
- `dominican-republic.strategy.ts` — `taxIdLabel: 'RNC'`, `taxIdRegex`/`taxIdMask`, `validateTaxId` por longitud → eliminados; queda el lookup a la DGII. ✔
- `usa/usa.strategy.ts` — `taxIdLabel: 'EIN/SSN'`, `validateTaxId` = `length === 9` → eliminados; `getTaxIdDetails` → `null`. ✔
- `generic-fiscal.strategy.ts` — `taxIdLabel: 'Tax ID'`, `validateTaxId` = `return true` → eliminados; `getTaxIdDetails` → `null`. ✔

**No son hallazgos (verificado en esta pasada):**
- Los checks de longitud del emisor en los builders (`nfe.builder.ts:245` `length !== 14`, `afip.builder.ts:230` `length !== 11`) validan el **propio** CNPJ/CUIT del tenant dentro de un builder inherentemente de una sola jurisdicción — misma categoría que la 3ª pasada ya despejó para `mx-electronic-accounting.ts` (RFC) y `ecf-lifecycle-xml.builder.ts` (RNC).
- La estrategia de nómina `payroll/jurisdictions/dominican-republic.strategy.ts` (homónima, otra clase) declara `readonly countryCode = 'DO'`: correcto, es la estrategia *de* RD.
- `testing/country.service.mock.ts` (`'Cédula'`, `individualDocument`) es un fixture de test.

---

## Cierre

Cinco pasadas después, el invariante se cumple de punta a punta: el tipo de documento y su validación son **datos del catálogo** `(país, código)`, en captura y en consumo, sin enum de BD, sin unión TS, sin clave i18n que delate un país, sin default `'DO'`, y ahora **sin ninguna segunda fuente** —viva o muerta— que nombre o valide un documento por su país fuera del catálogo. Agregar el próximo mercado sigue siendo un `INSERT`.
