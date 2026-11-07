# Ficha T07: Localización y reglas por país (`localization`, `jurisdictions`, `geo`)

Familia F3. Auditor: F3 (localización, impuestos y cumplimiento). Fecha: 2026-10-31. HEAD sin modificar.

> **Sin hallazgos CRÍTICOS de seguridad** (aislamiento verificado en impuestos, tasas de cambio y jurisdicciones; endpoints públicos con throttle).
> **Hallazgo CRÍTICO de cumplimiento con impacto en esta ficha:** la autodeclaración de cobertura (`fiscal-coverage.ts`) afirma "implementado" en capacidades que no funcionan tal cual (DO: 607 con formato desalineado → ver `RFC-01` en `reportes-fiscales-cumplimiento.md`; MX: contabilidad electrónica bloqueada de fábrica). Ver `LOC-01`.

## 1. Identificación

- **Alcance backend:** `apps/backend/api/src/app/localization` (54 archivos no-spec, 7 633 LOC, 11 specs), `jurisdictions` (5 archivos, 465 LOC, 1 spec: solo estrategia de **nómina** DO), `geo` (3 archivos, 156 LOC, 0 specs). La lógica por país también vive fuera: `contracts/country-pack/country-pack.ts` (560 LOC, segundo "pack" de país), `invoices/adapters/fiscal-adapter.factory.ts`, `einvoicing/regimes/*` (7 regímenes), `currencies/currency-catalogue.ts`.
- **Endpoints:** `GET /localization/{countries, config/:cc, fiscal-regions, countries/:cc/identity-document-types, lookup/:taxId}` (públicos; el lookup con throttle 10/min y llamada a `api.digital.gob.do` solo DO), `GET /localization/{identity-document-types, country-pack, fiscal-document-types, fiscal-coverage}` (autenticados), CRUD `/localization/tax-jurisdictions`, `/localization/withholding-regimes`, `GET /geo/location` (público).
- **Tablas:** `fiscal_regions` (19 filas), `identity_document_types` (39: 2 por país + XX), `fiscal_document_type_definitions` (39), `tax_jurisdictions`, `tenant_withholding_regimes`. **Vacías y sin uso fuera de un `forFeature`:** `tax_templates`, `coa_templates`, `localization_templates`, `tax_schemes`, `tax_groups`, `report_definitions`, `einvoice_provider_configs` (consulta `count(*)` = 0; grep de uso: solo `localization-provisioning.module.ts`/`localization.module.ts`).
- **Frontend:** `features/settings/fiscal`, `features/accounting/fiscal-returns`, `core/api/country-pack.service.ts`, formularios de alta (signup) que leen el catálogo de país.
- **Países declarados:** 19 (AR BO BR CL CO CR DO EC GT HN MX NI PA PE PY SV US UY VE). `marketStatus: 'available'` en 8 (DO MX CO CL PE AR BR EC), `preview` en 11.
- **Dependencias:** organizations (alta), invoices (motor de impuestos, adaptador fiscal), einvoicing, compliance, payroll (vía `jurisdictions`), chart-of-accounts (plan inicial).
- **¿Es núcleo para vender?** Sí. Es la promesa central del producto ("LatAm + EE. UU. desde el día 0").

## 2. Estándar de referencia (Paso 3)

- **Capacidades básicas:** por país vendido: catálogo de impuestos con tasas vigentes **y vigencia histórica**; identificadores fiscales con dígito verificador y sus excepciones (RFC genérico MX `XAXX010101000`/`XEXX010101000`, consumidor final DO, "222222222222" CO, etc.); catálogo completo de documentos fiscales (factura, NC, ND, complemento de pago MX, boleta CL/PE, retención EC, documento soporte CO); plan de cuentas legal o mapeo obligatorio (PUC CO, PCGE PE, código agrupador SAT MX); declaraciones periódicas en formato oficial; moneda y formatos locales; país no soportado bloqueado o declarado.
- **Avanzadas:** reglas como datos versionados y actualizables sin release (paquetes de localización por país); proveedor externo para sales tax US (Avalara/Vertex/TaxJar); consulta de padrón (RNC/RUT/RFC); avisos de cambios normativos.
- **Invariantes:** ninguna regla de un país se aplica a otro; una tasa nueva no reescribe documentos emitidos; lo que el producto declara disponible funciona tal cual.
- **Cómo lo hacen los líderes (confianza media, conocimiento público de producto, no verificado en vivo):** Odoo distribuye la localización como módulos `l10n_xx` con plan de cuentas legal, impuestos, posiciones fiscales y reportes por país. Alegra, Siigo y CONTPAQi cubren un solo país (o pocos) a fondo: PUC completo en Siigo; código agrupador SAT, DIOT y contabilidad electrónica en CONTPAQi y Aspel; 606/607/608 en Alegra DO. QuickBooks delega el sales tax de EE. UU. a su motor automático (basado en Avalara). Dynamics/NetSuite: "localization packs" con fechas de vigencia en tasas.
- **Construcción de referencia:** un "country pack" único por país (datos con `valid_from/valid_to`, versionados y migrables), un registro de estrategias por capacidad, cero condicionales por país fuera del pack, y pruebas de conformidad por país contra ejemplos oficiales.

## 3. Resultado

- **Madurez: 42** (35–50, confianza media). **Preparación comercial: 38, No listo.**
- **Eje más débil:** 3 Multi-país y cumplimiento (35).
- **Hallazgos críticos abiertos:** 1 (`LOC-01`). **Altos:** 4 (`LOC-02` a `LOC-05`).

## 4. Tabla de los 12 ejes

| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 45 (38–52, media) | Los catálogos existen y son reales (validadores, divisiones, regímenes fiscales SAT, responsabilidades DIAN). Faltan documentos clave: MX solo I/E (sin P/REP, T, N), CO sin ND 92 ni documento soporte, CL sin boleta 39 ni ND 56, PE sin ND 08, EC sin comprobante de retención 07, BR solo NF-e 55; **11 países sin ningún tipo de documento** (`fiscal-document-type-catalogue.ts`) | Catálogo completo de documentos por país "available"; PUC, PCGE y código agrupador SAT sembrados |
| 2 | Corrección e integridad | 48 (40–55, media) | Tasas nacionales coinciden con las vigentes según mi conocimiento (tabla §6). `isValidMexicanRfc('XAXX010101000') === false` (ejecutado); el RFC "público en general" que exige el CFDI 4.0 es rechazado. Las tasas no tienen vigencia | Excepciones de identificadores; tasas con `valid_from/valid_to` |
| 3 | Multi-país y cumplimiento | 35 (28–42, media) | Ver la matriz §6: solo DO tiene un paquete razonablemente completo, y aun así su 607 sale con formato incorrecto. MX: contabilidad electrónica bloqueada (0/56 cuentas con código agrupador) | Paquete completo por país vendible y verificado con un contador local |
| 4 | Arquitectura | 52 (45–58, media) | Reglas como **constantes TS** repartidas en ≥9 archivos (`country-profiles.ts` 1 114 LOC, `country-tax-schemes.ts`, `withholding-regimes.ts`, `identity-document-catalogue.ts` 789, `fiscal-document-type-catalogue.ts`, `coa-builder.ts`, `fiscal-coverage.ts`, `contracts/country-pack/country-pack.ts` 560, `currency-catalogue.ts`) y copiadas al tenant una sola vez al darlo de alta | Un único pack de país, versionado, con vigencias y un mecanismo para propagar cambios a los tenants |
| 5 | Higiene y separación | 45 (38–52, media) | 7 entidades/tablas muertas; dos fuentes de verdad por país (`country-profiles` y `contracts/country-pack`); columnas DO en entidades genéricas (`vendor_bills.ncf_modified`, `isr_retention_type`) | Borrar entidades muertas y fusionar los packs; mover lo DO-específico a extensiones fiscales |
| 6 | Calidad del código | 66 (60–72, media) | Código claro, tipado, con comentarios que explican el porqué (algunos exageran: ver `LOC-01`) | Retirar los comentarios que afirman cosas falsas |
| 7 | Robustez y rendimiento | 65 (55–72, baja) | Validadores síncronos y totales; lookup externo con throttle y error controlado | Caché del padrón; timeouts explícitos |
| 8 | Seguridad y aislamiento | 74 (65–80, media) | IDOR sobre jurisdicciones/impuestos/tasas → 404 (verificado). `lookup/:taxId` es público y hace de proxy a un servicio del gobierno (throttle de 10/min por IP) | Captcha o autenticación en el lookup; registro de abuso |
| 9 | Pruebas | 58 (50–65, media) | 11 specs (validadores con casos, cobertura, pack de país), todas pasan con BD (`logs/api-test-db.log`: 266/266 suites). No hay casos de identificadores genéricos ni pruebas de conformidad contra ejemplos oficiales | Fixtures oficiales por país (XML/TXT aceptados por la autoridad) |
| 10 | Operabilidad | 50 (40–58, baja) | Avisos en log en `TaxDeterminationService`; no hay telemetría de "país no soportado" | Métricas por país y alerta de catálogos caducados |
| 11 | UX | 55 (45–62, baja) | La cobertura por capacidad se muestra al darse de alta y en ajustes (según el código; no recorrí la UI) | Verificación en UI; avisos de "solo contabilidad" en cada pantalla fiscal |
| 12 | Competitividad | 35 (28–45, media) | Más amplio que un líder local pero menos profundo en cada país (sin PUC, agrupador SAT, DIOT, exógena, PLE, SPED, ATS, Libro IVA) | Profundidad de un líder local en al menos 3–4 países |

Promedio simple ≈ 52. La madurez (42) es más baja porque el eje 3 es el propósito del módulo y la autodeclaración de cobertura no se cumple (crítico abierto ⇒ madurez ≤59).

## 5. Compuertas de producción

| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas y con lo básico | **No cumple** | `fiscal-coverage.ts` declara `implemented` para "periodicReturns DO 606-609" y "electronicAccounting MX", que fallan (ver `RFC-01`, `RFC-02`) |
| 2 | Integridad de escrituras | Cumple | Las líneas guardan su tasa e importe; cambiar el catálogo no reescribe documentos (las columnas de la línea son instantáneas) |
| 3 | Autorización y aislamiento | Cumple (parcial) | IDOR → 404 en `taxes`, `exchange-rates` y `tax-jurisdictions` (probado qa-a contra qa-b) |
| 4 | Validación en servidor | Cumple | `validateFiscalFields`, validadores de identificador, DTO con `Matches` |
| 5 | E2E sin 500 | Cumple (en lo probado) | Ningún 500 en las pruebas de humo |
| 6 | Cumplimiento correcto por país | **No cumple** | Ver la matriz §6 |
| 7 | Pruebas en CI | Parcial | Unitarias en CI; las de integración se saltan sin `DB_HOST` |
| 8 | Auditoría de negocio | Parcial | Exportación de reportes con `@AuditAccess`; los cambios de jurisdicción y tasa no verificados en la bitácora |
| 9 | Migraciones | Cumple | Global (`logs/migrations.log`) |
| 10 | Observabilidad | Parcial | Logs; sin métricas |
| 11 | UI y traducciones | Parcial | Ver la ficha de i18n |
| 12 | Documentación | No cumple | No hay guía por país para configurar y operar |

## 6. Matriz país × capacidad (evidencia: código, BD y API a 2026-10-31)

Leyenda: ✅ implementado y verificado · 🟡 parcial o sin verificar contra la autoridad · ❌ ausente · N/A. **Todas las tasas y formatos: verificar con un contador local.**

| País | Tasas sembradas (`country-tax-schemes.ts`) vs vigentes* | Identificador (dígito verificador) | Documentos fiscales (catálogo) | e-factura (builder en `einvoicing/regimes`) | Reportes periódicos | Plan de cuentas | Moneda / formatos | Veredicto |
|---|---|---|---|---|---|---|---|---|
| DO | ITBIS 18/16/0 ✅; retenciones (4 regímenes) 🟡 | RNC mód. 11 + cédula Luhn ✅ (DGII `401506254` válido) | B01–B17, E31–E47 ✅ | e-CF 🟡 (otra familia) | 606 ✅ formato; **607 ❌ desalineado**; 608/609 🟡; IT-1/IR-17 ❌ | IFRS genérico 56 ctas con ITBIS 🟡 | DOP, es-DO ✅ | **Piloto no apto** hasta corregir el 607 |
| MX | IVA 16/8/0 ✅; sin IEPS ni retenciones IVA/ISR ❌ | RFC ✅, **genérico `XAXX010101000` rechazado ❌** | I, E; **sin P (REP), T, N ❌** | CFDI 4.0 + PAC 🟡 | Anexo 24: Catálogo **bloqueado** (0/56 con `CodAgrup`) ❌, Balanza/Pólizas XML 🟡; DIOT ❌ | Genérico, sin código agrupador ❌ | MXN ✅ | **No listo** |
| US | Ninguna (por diseño) → jurisdicciones manuales ✅ (verificado: TX 6.25 + ciudad 1 + especial 1 = 8.25 %) | EIN por prefijo; SSN/ITIN 🟡 (sin dígito verificador por diseño del IRS) | N/A (no hay sello fiscal) | N/A | 1099 y declaraciones estatales ❌ | US GAAP en inglés 🟡 | USD, en-US ✅ | **Piloto** (contabilidad + sales tax manual, sin productos exentos ni certificados de exención) |
| CO | IVA 19/5/0 ✅; sin INC, ICA, ReteFuente/ReteIVA/ReteICA sembrados ❌ | NIT con DV ✅ | 01, 91; sin 92 ni documento soporte ❌ | DIAN UBL 2.1 🟡 | Exógena ❌ | **PUC ausente** (declarado en `STATUTORY_PLAN_REQUIRED`) ❌ | COP, es-CO ✅ | **No listo** |
| CL | IVA 19 ✅ | RUT mód. 11 ✅ | 33, 34, 61; sin 39, 56, 52 ❌ | SII DTE 🟡; **IVA por línea ≠ IVA sobre el neto** ❌ (ver `IMP-02`) | F29, libros ❌ | Genérico 🟡 | CLP 0 dec ✅ | **No listo** |
| PE | IGV 18 ✅; sin detracciones/percepciones ❌ | RUC ✅ | 01, 03, 07; sin 08 ❌ | SUNAT UBL 🟡 | PLE ❌ | PCGE ausente ❌ | PEN ✅ | **No listo** |
| AR | IVA 21/10,5/27 ✅; sin percepciones IIBB ❌ | CUIT ✅ | A/B/C factura + NC; sin ND ❌ | AFIP WSFE 🟡 | Libro IVA Digital ❌ | Genérico 🟡 | ARS ✅ | **No listo** |
| BR | Ninguna (ICMS/ISS/PIS/COFINS configurables) 🟡 | CNPJ/CPF ✅ | Solo NF-e 55; sin NFC-e 65 ni NFS-e ❌ | NF-e 4.00 🟡 | SPED ❌ | Genérico pt 🟡 | BRL, pt-BR (catálogo pt en variante europea, ver i18n) 🟡 | **No listo** |
| EC | IVA 15/0 ✅ (otras tarifas: verificar) | RUC ✅ | 01, 04; **sin 07 retención** ❌ | SRI 2.1.0 🟡 | ATS ❌ | Supercias ausente ❌ | USD ✅ | **No listo** |
| UY | IVA 22/10 ✅ | RUT ✅ | ❌ | ❌ (preview) | ❌ | Genérico | UYU ✅ | Solo contabilidad |
| PY | IVA 10/5 ✅ | RUC ✅ | ❌ | ❌ | ❌ | Genérico | PYG 0 dec ✅ | Solo contabilidad |
| BO | IVA 13 ✅ (sin IT 3 %) | NIT solo estructura 🟡 | ❌ | ❌ | ❌ | Plan del SIN ausente ❌ | BOB ✅ | Solo contabilidad |
| VE | IVA 16 ✅ (sin IGTF, reducida 8 %, lujo) | RIF ✅ | ❌ | ❌ | ❌ | Genérico | VES ✅ | Solo contabilidad |
| PA | ITBMS 7 ✅ | RUC estructura 🟡 | ❌ | ❌ | ❌ | Genérico | **PAB** (en la práctica se factura en USD: verificar) 🟡 | Solo contabilidad |
| CR | IVA 13 ✅ (sin 1/2/4 %) | Estructura (9–12 dígitos) 🟡 | ❌ | ❌ | ❌ | Genérico | CRC; cargo por servicio 10 % ✅ | Solo contabilidad |
| GT | IVA 12 ✅ | NIT ✅ | ❌ | ❌ (FEL) | ❌ | Genérico | GTQ ✅ | Solo contabilidad |
| SV | IVA 13 ✅ | NIT 14 estructura 🟡 | ❌ | ❌ (DTE) | ❌ | Genérico | USD ✅ | Solo contabilidad |
| HN | ISV 15 ✅ (sin 18 %) | RTN estructura 🟡 | ❌ | ❌ | ❌ | Genérico | HNL ✅ | Solo contabilidad |
| NI | IVA 15 ✅ | RUC estructura 🟡 | ❌ | ❌ | ❌ | Genérico | NIO ✅ | Solo contabilidad |

\*Tasas generales contrastadas con mi conocimiento de la normativa vigente a 2026 (confianza media-alta para las tasas generales, baja para reducidas y especiales). No pude abrir fuentes oficiales: `dgii.gov.do` y otros dominios no resuelven en este entorno. Verificar con un contador local.

**Barrido de condicionales por país** (patrón `(countryCode|country)\s*[!=]==\s*'XX'|case 'XX'|'XX' === …country`, excluidos `*.spec.ts`):
- Backend fuera de `localization`: **3 archivos**: `invoices/adapters/fiscal-adapter.factory.ts:65-81` (`switch` de 8 países, aceptable como registro, pero es código), `compliance/compliance.service.ts:426` (`!== 'DO'`, guarda correcta) y `einvoicing/services/fiscal-range.service.ts:243` (`!== 'PE'`). Dentro de `localization`: 3 (más `coa-builder.ts:284-285`, etiquetas BR y US).
- Frontend: 4 coincidencias (`fiscal-returns.page.ts:119-121,175`, `settings/fiscal/fiscal.page.ts:205` `isDominican`, `country-pack.service.ts`, contrato compartido).
- Términos DO fuera de los módulos fiscales que no son comentarios: solo ejemplos de Swagger y de importación (`register-user.dto.ts:75`, `customers-data-transfer.provider.ts:27`).
- **Conclusión:** hay **poca** dispersión, lo cual es una fortaleza real. Lo DO-específico persiste en el esquema (`vendor_bills.ncf_modified`, `isr_retention_type`).

**País por defecto:** no hay un DO por defecto en el camino de producción. Restos: `auth/services/dev-seeder.service.ts:79` (`|| 'DO'`, solo para desarrollo); en nómina, `payroll/entities/{payroll-run,payslip,statutory-reference}.entity.ts` con `default: 'DOP'`, `payroll-parameters-admin.service.ts:93` (`?? 'DOP'`) y `features/payroll/parameters/parameters.page.ts:190` (`?? 'DOP'`); y unos 15 respaldos `baseCurrency ?? 'USD'` repartidos por AP, AR, inventario, asientos, facturas, cotizaciones y OC (`accounts-payable.service.ts:232,948,1284`, `invoices.service.ts:1040,1212,1758`, `inventory-posting.service.ts:101,174,322`…). Un tenant sin `organization_settings` contabilizaría en USD sin avisar.

**País no soportado:** `coverageFor()` devuelve "solo contabilidad" de forma honesta, y `TaxDeterminationService` devuelve `NOT_DETERMINABLE`. El motor puro `computeDocument` acepta **cualquier** tasa para un país desconocido (ejecutado: `XX`, 33 % → aceptado), pero el alta restringe a los 19 países (según el comentario de `country-profiles.ts`; no lo probé por API).

## 7. Hallazgos

**LOC-01 · Autodeclaración de cobertura que no se cumple** · ejes 1 y 3 · Categoría: funcionalidad falsa o multi-país · **Severidad: Crítica**
- Ubicación: `localization/fiscal/fiscal-coverage.ts:75-105` y `country-profiles.ts` (`marketStatus: 'available'` en 8 países).
- Qué está mal: DO declara `periodicReturns: implemented (606, 607, 608 y 609)`, pero el 607 sale con 24 campos y columnas desplazadas (`RFC-01`). MX declara `electronicAccounting: implemented`, pero `GET /compliance/mx/electronic-accounting/catalogo` responde 400 `count_account_have_no_sat_grouping {count:56}` en un tenant recién creado. Además, `taxDetermination: implemented` para CL/PE/EC/AR solo siembra la tasa general (sin detracciones, percepciones ni retenciones). Ese texto se muestra al cliente antes del pago.
- Forma correcta: derivar el nivel de pruebas de conformidad (fixture oficial aceptado) y no de una tabla escrita a mano; marcar `needs-configuration` cuando falte el mapeo.
- Impacto: bloquea la venta (promesa falsa, riesgo legal). Esfuerzo: M.

**LOC-02 · El RFC genérico "público en general" es rechazado** · ejes 2 y 3 · multi-país · **Alta**
- Ubicación: `localization/fiscal/tax-id-validators.ts:193-235`. Ejecutado con ts-node: `XAXX010101000` → false; `XEXX010101000` → true. Ningún builder CFDI escribe `XAXX` (grep: solo un comentario en `contracts/country-pack/country-pack.ts:460`).
- Por qué: el CFDI 4.0 exige `XAXX010101000` para ventas a público en general y para la factura global; el SAT lo publica como RFC genérico y su dígito no sigue el algoritmo.
- Forma correcta: lista de excepciones por país en el catálogo (`XAXX…`, `XEXX…`, DO consumidor final, CO `222222222222`), con pruebas. Esfuerzo: S.

**LOC-03 · Las reglas por país son código sin vigencia** · eje 4 · arquitectura · **Alta**
- Ubicación: `country-tax-schemes.ts`, `withholding-regimes.ts`, `country-profiles.ts`, `contracts/country-pack/country-pack.ts`. Solo `tax_jurisdictions` tiene `effective_from/effective_to` (`entities/tax-jurisdiction.entity.ts:131`).
- Por qué: un cambio de tasa por decreto exige un release, y no se propaga a los tenants existentes (se sembró una copia en `taxes` sin vigencia). Un documento de fecha anterior emitido después del cambio requiere que el tenant mantenga ambas tasas a mano.
- Forma correcta: tabla de reglas por país con `valid_from/valid_to`, migraciones de datos versionadas y resolución por fecha del documento. Esfuerzo: L.

**LOC-04 · Catálogos de documentos fiscales incompletos** · eje 1 · multi-país · **Alta**
- Ubicación: `fiscal-document-type-catalogue.ts:81-159`. MX sin "P" (complemento de pago, obligatorio para PPD), "T" ni "N"; CO sin 92; CL sin 39/56/52; PE sin 08; EC sin 07 (retención); AR sin notas de débito; BR solo 55. Hay 11 países sin ningún tipo.
- Esfuerzo: M por país.

**LOC-05 · Plan de cuentas genérico; sin PUC, PCGE ni código agrupador SAT** · ejes 1 y 3 · multi-país · **Alta**
- Evidencia (BD): los 4 tenants QA tienen 56 cuentas; `count(fiscal_grouping_code) = 0` en MX. `coa-builder.ts:32-37` reconoce CO/PE/EC/BO como "importa el oficial". En lo positivo, nombra las cuentas de impuesto por país (ITBIS/IVA/Sales Tax).
- Forma correcta: sembrar el código agrupador SAT en las 56 cuentas MX; plantillas PUC y PCGE importables. Esfuerzo: M (MX, S).

**LOC-06 · Dos fuentes de verdad por país y 7 entidades muertas** · eje 5 · higiene · **Media**
- `localization/fiscal/country-profiles.ts` frente a `contracts/country-pack/country-pack.ts` (este último también trae ciudades de ejemplo, métodos de pago y conceptos de nómina). Las entidades `TaxTemplate`, `CoaTemplate`, `LocalizationTemplate`, `TaxScheme`, `TaxGroup`, `ReportDefinition` y `EinvoiceProviderConfig` tienen tablas vacías y no se usan. Esfuerzo: M.

**LOC-07 · Respaldos silenciosos de moneda y país** · eje 2 · bug latente · **Media**
- Unos 15 `baseCurrency ?? 'USD'` y `default: 'DOP'` en las entidades de nómina (lista en §6). Forma correcta: resolver la moneda funcional desde un único puerto de tenant y fallar si falta. Esfuerzo: S.

**LOC-08 · Columnas DO en entidades genéricas** · eje 5 · mezcla de contexto · **Media**
- `accounts-payable/entities/vendor-bill.entity.ts:124,265` (`ncf_modified`, `isr_retention_type`). Mover a una extensión fiscal por país (JSONB tipado o tabla satélite). Esfuerzo: M.

**LOC-09 · Validación de identificadores solo estructural en 6 países** · eje 3 · **Media**
- PA, CR, BO, SV, HN y NI aceptan cualquier cadena con la longitud correcta (`tax-id-validators.ts:530-562`), lo cual está documentado. Verificar si existe un algoritmo publicado (p. ej. el DV del RUC de Panamá). Esfuerzo: S.

**LOC-10 · Lookup de padrón público** · eje 8 · seguridad · **Baja**
- `localization.controller.ts:189` es `@Public` y llama a `api.digital.gob.do`; tiene throttle de 10/min por IP. Añadir captcha en el alta. Esfuerzo: S.

## 8. Camino mínimo a producción (por conjunto de países)

1. **DO (piloto):** corregir el 607 (`RFC-01`, S) y el redondeo (`IMP-01`, S); alinear `fiscal-coverage` con la realidad (`LOC-01`, S).
2. **MX:** RFC genéricos (S); sembrar el código agrupador SAT (S); CFDI tipo P/REP (L, einvoicing); DIOT (M).
3. **Resto de "available" (CO CL PE AR BR EC):** degradarlos a `preview` hasta tener documentos completos, plan legal y reportes. Si se mantienen, son XL por país.
4. **US:** mantener como piloto de contabilidad + sales tax manual; integrar un proveedor (el puerto ya existe) en L.
5. Transversal: reglas como datos con vigencia (`LOC-03`, L).

## 9. Camino a 100 (ordenado por impacto)

| Ítem | +puntos | Esfuerzo | Retocar o rehacer |
|---|---|---|---|
| Cobertura derivada de pruebas de conformidad | +8 | M | Retocar |
| Pack de país único con vigencias | +10 | L | Rehacer la capa de datos |
| Documentos fiscales completos MX/CO/CL/PE/EC | +10 | L | Ampliar |
| PUC/PCGE/agrupador SAT | +6 | M | Ampliar |
| Reportes periódicos por país (DIOT, exógena, PLE, ATS, F29) | +10 | XL | Nuevo |
| Excepciones de identificadores | +3 | S | Retocar |
| Proveedor sales tax US + exenciones | +5 | L | Ampliar |

## 10. Competitividad

- **Brechas básicas (bloquean la venta):** en MX, el REP y la DIOT (CONTPAQi y Aspel los tienen); en CO, PUC y exógena (Siigo, Alegra CO); en CL, boleta y F29 (Defontana, Bsale); en EC, retención y ATS (Contífico).
- **Diferenciadores existentes:** un único producto multipaís con validadores de identificador sólidos para 13 países; declaración honesta de "solo contabilidad" para los mercados `preview`; motor de sales tax US con nexo y sourcing basado en jurisdicciones propias.
- **Nota de competitividad:** 35 (28–45, confianza media).

## 11. Fortalezas a preservar

- Validadores de identificadores con dígito verificador, probados (`tax-id-validators.spec.ts`): verifiqué IDs públicos de DGII, DIAN, SII, AFIP, RFB, SUNAT y SRI y todos validan.
- Muy pocos condicionales por país fuera de `localization`.
- `coverageFor()` honesto para países desconocidos, y el registro de nómina rechaza países no soportados (`jurisdiction-registry.ts`).
- `geo.service.ts` ya no fabrica ubicaciones.

## 12. Lo que no se pudo verificar

- Fuentes oficiales: `dgii.gov.do`, `blog.alegra.com` y otros dominios no resuelven en el sandbox. Las tasas se contrastaron solo con conocimiento previo y WebSearch (búsqueda sin abrir los PDF).
- Flujo de alta para un país no listado (no probado por API para no generar tenants).
- UI de ajustes fiscales (no se recorrió con Playwright).
- Builders de e-factura por país (pertenecen a otra familia; solo revisé el IVA de CL).

Cobertura honesta: ~45 % de los archivos de `localization` leídos (todos los de reglas y catálogos clave), 100 % de `jurisdictions` y `geo`; endpoints ejecutados: tax-jurisdictions (POST), country-pack, fiscal-coverage, taxes.

<!-- RESUMEN: modulo=localizacion-reglas-pais; madurez=42; prep=38; veredicto=No listo; eje_debil=Multi-país y cumplimiento; criticos=1; altos=4; camino_min=L -->
