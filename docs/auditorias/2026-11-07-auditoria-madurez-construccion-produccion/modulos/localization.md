# Ficha — `localization` (perfiles de país, esquemas impositivos, catálogos fiscales, plan de cuentas, retenciones, determinación de impuestos, cobertura fiscal)

Familia LOC · 2026-11-07 · auditor LOC

> ⚠️ CRÍTICO (LOC-01): en Brasil (mercado declarado `marketStatus: 'available'`) un tenant recién creado factura con impuesto 0 sin bloqueo: `POST /invoices/preview` con `taxRate: 0.18` devuelve `taxAmount: 0`, `taxTreatment: "TAXED"` y `exemptTotal: 1000`. La única pista es un aviso en la UI pensado para el sales tax de EE. UU. («no cobra imposto sobre vendas em nenhum estado»). Es un cálculo fiscal incorrecto en un país que se declara disponible.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/localization/` (≈60 archivos, ≈13.000 líneas sin specs; los mayores: `fiscal/country-profiles.ts` 1.114, `fiscal/identity-document-catalogue.ts` 789, `fiscal/tax-id-validators.ts` 650, `services/localization.service.ts` 590, `fiscal/coa-builder.ts` 490). Fuentes de reglas país que están fuera del módulo: `contracts/country-pack/country-pack.ts` (560), `invoices/adapters/fiscal-adapter.factory.ts`, `invoices/sales-tax.engine.ts`.
- **Endpoints**: `GET /localization/countries|fiscal-regions|config/:cc|countries/:cc/identity-document-types|lookup/:taxId` (públicos), `GET /localization/identity-document-types|country-pack|fiscal-document-types|fiscal-coverage`, CRUD `/localization/tax-jurisdictions` y `/localization/withholding-regimes` (con `@HasPermission(TAXES_*)`).
- **Tablas**: `fiscal_regions` (19), `identity_document_types` (39), `fiscal_document_type_definitions` (39), `tax_jurisdictions`, `tenant_withholding_regimes`; tablas muertas (0 filas, sin lectores): `tax_schemes`, `coa_templates`, `tax_templates`, `localization_templates`, `report_definitions`.
- **Frontend**: registro (`features/auth/register/steps/*`), ajustes `fiscal`, `einvoicing-regime`, `tax-jurisdictions` (`settings-registry.ts:180-198`), formulario de factura.
- **Países**: los 19 de `COUNTRY_FISCAL_PROFILES`. Es **núcleo para vender**: sin esto no hay alta de tenant.

## 2. Estándar de referencia (resumen)
(a) **Básico**: perfil por país (moneda, idioma, zona horaria, formatos); impuestos con sus tasas **versionadas por vigencia**; plan de cuentas local (y el estatutario donde la ley lo exige: PUC en CO, PCGE en PE, catálogo de la Supercías en EC, código agrupador SAT en MX); validación del identificador fiscal con su dígito verificador; catálogo de documentos fiscales; retenciones; un país no soportado se rechaza o se declara tal cual. **Avanzado**: motor de determinación (origen/destino, nexo, ICMS interestatal/ST/DIFAL), paquetes de localización instalables y versionados, actualizaciones normativas sin desplegar código.
(b) **Invariantes**: ninguna tasa sin vigencia; ningún país hereda reglas de otro; un impuesto no determinable bloquea, no deja 0; lo que se declara cubierto debe estar cubierto.
(c) **Líderes**: Odoo instala módulos `l10n_xx` por país con plan, impuestos y posiciones fiscales como datos (confianza alta, conocimiento público de su arquitectura de módulos). SAP y Dynamics 365 guardan los códigos de impuesto con fechas de validez en tablas de configuración (confianza media). NetSuite y QuickBooks delegan el sales tax de EE. UU. en motores como Avalara (confianza alta). Alegra, Siigo y CONTPAQi traen el PUC o el código agrupador de fábrica (confianza media, no verificado en esta sesión).
(d) **Construcción**: las reglas viven en tablas versionadas (`effective_from/to`) con semilla por país; el código solo trae algoritmos (dígitos verificadores, firmas); un único punto resuelve el «paquete país»; no hay `switch` por país en los servicios.

## 3. Resultado
- **Madurez: 42 (35–50, confianza media)**. Tope por el eje 2 (cálculo fiscal BR) y por el hallazgo crítico (≤59).
- **Preparación comercial: 38 (30–45)** → **No listo** (compuerta 6 incumplida: BR, y DO filtrado a los demás países en nombres de cuentas y terminología).
- **Eje más débil**: 3 (multi-país): las reglas son código sin vigencia y lo dominicano se filtra al resto.
- **Críticos abiertos**: 1 (LOC-01).

## 4. Ejes
| # | Eje | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad/completitud | 45 (38–52, media) | Alta real en los 19 países: `verify:markets` en `virteex_test` → «ALL MARKETS PROVISION CLEANLY», 56 cuentas en cada uno. No hay planes estatutarios: `coa-builder.ts:32-37` solo avisa para CO/PE/EC/BO; MX sin código agrupador. Cinco entidades/tablas muertas. | PUC, PCGE y código agrupador SAT como datos importables; borrar las tablas muertas. |
| 2 | Corrección/integridad | 35 (28–45, media) | LOC-01 (BR a 0 %). Cuentas de nómina dominicanas en todos los países hispanos (LOC-02). Validadores: 50 de 53 casos con identificadores públicos reales dan lo esperado; falla `XAXX010101000` (LOC-05). | Bloquear `NO_NEXUS` en BR; nombres de cuenta por país; RFC genérico. |
| 3 | Multi-país | 30 (22–38, media) | Tasas en `country-tax-schemes.ts` sin vigencia; la tabla `taxes` no tiene `effective_*`. Reglas país repartidas en ≥8 archivos de código. Condicionales `'DO'` en AP/POS/compliance. Terminología DO en el catálogo base (LOC-04). | Tablas de tasas con vigencia; un único paquete país; eliminar los `switch`. |
| 4 | Arquitectura | 45 (38–52, media) | Mucha justificación en comentarios, pero las reglas siguen en constantes TS. `fiscal-adapter.factory.ts:63-82` es un `switch` por país. Hay duplicación: `fiscal_regions.dateFormat` frente al `Intl` del front. | Un registro de paquetes por país inyectado. |
| 5 | Higiene | 45 (38–52, baja) | `country-pack` vive en `contracts/` y repite hechos del perfil (el propio spec lo admite). `AccountRole.AFP_PAYABLE/SFS_PAYABLE/INFOTEP_PAYABLE` (roles DO) dentro de `chart-of-accounts`. | Roles neutros (`PENSION_PAYABLE`, …). |
| 6 | Calidad de código | 55 (48–62, media) | Tipado razonable; `getTaxIdDetails(): Promise<any>` (`tax-id-registry-lookup.ts:23`); comentarios que hablan de auditorías pasadas en lugar de describir el código. | Tipos estrictos y comentarios técnicos. |
| 7 | Robustez | 55 (45–62, baja) | La consulta a la DGII tiene try/catch y vuelve a `found:false`, pero no tiene timeout explícito (`dominican-republic.strategy.ts:23`). `seedFiscalRegions` se ejecuta en cada arranque. | Timeout y caché de la consulta; semilla por migración. |
| 8 | Seguridad | 62 (55–70, media) | Endpoints de escritura con `@HasPermission`. `lookup` es público con throttle 10/min y valida antes de salir a la red (`localization.service.ts:386-401`). No probé aislamiento en `tax-jurisdictions` (0 filas). | Prueba A/B de aislamiento en jurisdicciones y retenciones. |
| 9 | Pruebas | 58 (50–65, media) | Specs de validadores, cobertura, catálogos y determinación (`fiscal/*.spec.ts`). Nada prueba que una factura BR sin jurisdicciones quede bloqueada ni que los nombres de cuenta sean del país. | Pruebas por país «sin filtrado DO». |
| 10 | Operabilidad | 45 (35–55, baja) | Hay log de aviso en una determinación no `DETERMINED`. No hay auditoría de negocio del cambio de tasas (no verificado). | Auditoría de cambios de tasa y régimen. |
| 11 | UX/idiomas | 45 (38–52, media) | En BR el formulario de factura muestra «faixa de comprovantes … (série B) ou (série E)», que son series NCF dominicanas (LOC-03); en UY no hay ningún aviso de que no se emite documento fiscal. | Mensajes por país desde el paquete. |
| 12 | Competitividad | 35 (28–45, baja) | Frente a Odoo l10n, Siigo y Alegra: faltan planes estatutarios, retenciones locales (solo DO), declaraciones periódicas (solo DO, y MX parcial) y vigencias. | Ver §9. |

Promedio simple ≈ 47. La madurez (42) queda por debajo por los topes del eje 2 y del crítico.

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas, capacidades básicas | No cumple | Sin planes estatutarios; tablas de plantillas muertas. |
| 2 | Integridad | No cumple | LOC-01. |
| 3 | AuthZ/aislamiento | Parcial | `@HasPermission` presente; aislamiento A/B no probado en este módulo. |
| 4 | Validación servidor | Cumple | El DTO y los validadores rechazan una tasa no vigente en el país (UY 18 % → 400 `invoices.tax_rate_rate_not_valid_country`). |
| 5 | Humo sin 500 | Cumple | Sin 500 en mis llamadas. |
| 6 | Cumplimiento por país | **No cumple** | BR a 0 %; nombres DO en el plan de cuentas; 11 países sin documento fiscal. |
| 7 | Pruebas en CI | Parcial | Las specs pasan, pero CI está en rojo globalmente (GLOBAL-RESULTS). |
| 8 | Auditoría negocio | No verificado | — |
| 9 | Migraciones | Cumple | Sin deriva (global). |
| 10 | Observabilidad | Parcial | — |
| 11 | UI/traducciones | Parcial | Ver ficha i18n. |
| 12 | Documentación | Parcial | `docs/architecture/COUNTRY_PACK.md` existe (no leído a fondo). |

## 6. Hallazgos
**LOC-01** · localization/invoices · eje 2 · *integridad de datos / multi-país* · **Crítica**
- **Ubicación**: `localization/fiscal/tax-determination/tenant-jurisdiction.provider.ts:62-73` (devuelve `NO_NEXUS`, rate 0) y `invoices/invoices.service.ts:567-588` (solo `NOT_DETERMINABLE` bloquea).
- **Qué está mal**: Brasil usa el motor de sales tax de EE. UU. (estado/condado/ciudad sumados). Si el tenant no tiene jurisdicciones, la factura sale al 0 %.
- **Pasos y resultado**: `QA_SESSION=loc qa-client qa-br-a POST /invoices/preview` con una línea de 1000 y `taxRate:0.18` → `tax:0`, `taxedTotal:0`, `exemptTotal:1000`, con el tratamiento «TAXED».
- **Por qué es grave**: ICMS, ISS y PIS/COFINS no son componentes que se sumen como un sales tax. El ICMS va «por dentro», tiene tasas interestatales, ST y DIFAL (verificar con contador local). Y el país está marcado `marketStatus: 'available'`.
- **Forma correcta**: en BR, `NO_NEXUS` debe bloquear la emisión. Hace falta un motor tributario propio de BR por CST/CFOP/NCM, o declarar BR `preview` y `taxDetermination: not-implemented`.
- **Impacto**: bloquea la venta en BR. **Esfuerzo**: L para el bloqueo y la declaración honesta; XL para el motor.

**LOC-02** · localization/chart-of-accounts · eje 3 · *multi-país (filtrado DO)* · **Alta**
- **Ubicación**: `coa-builder.ts:367-393`, y las cuentas 2160 «Propina Legal» y 2165 «Impuesto Selectivo al Consumo» que se crean sin condición.
- **Qué está mal**: todo tenant hispano (MX, CO, CL, PE, AR, UY, GT…) recibe «AFP por Pagar (TSS)», «SFS por Pagar (TSS)», «SRL e INFOTEP por Pagar» y «Aportes Patronales (TSS/INFOTEP)», que son instituciones dominicanas. MX recibe además la propina legal de la Ley 16-92 (DO) y el ISC (en MX el equivalente es el IEPS).
- **Verificado en BD**: el tenant qa-mx-a tiene las cuentas 2141-2143 y 5250 con esos nombres. Los roles `AccountRole.AFP_PAYABLE/SFS_PAYABLE/INFOTEP_PAYABLE` tienen nombre dominicano.
- **Forma correcta**: nombres y roles neutros, más el paquete de nómina del país (IMSS/INFONAVIT/SAR en MX; EPS/AFP/ARL/Parafiscales en CO).
- **Impacto**: riesgo operativo y mala imagen ante el contador. **Esfuerzo**: M.

**LOC-03** · localization/invoices · eje 3/11 · *multi-país* · **Alta**
- **Qué está mal**: el formulario de factura de BR (pt-BR) exige «uma faixa de comprovantes vigente, tradicional (série B) ou eletrônica (série E)», que es el modelo NCF de la DGII. BR también muestra el aviso de sales tax de EE. UU. («nenhum estado»).
- **Verificación**: Playwright, `/e/qa-br-a-srl/invoices/new`. Además aparece un «Página não encontrada» incrustado.
- **En UY/GT**: no hay ningún aviso de que la factura no es un documento fiscal. Esto coincide con lo que vio FAC y lo verifiqué aparte en `/e/qa-uy-a-srl/invoices/new`.
- **Forma correcta**: requisitos de emisión tomados del paquete país, y en los países `preview` un banner «este documento no es un comprobante fiscal».
- **Esfuerzo**: S/M.

**LOC-04** · i18n/localization · eje 3 · *multi-país (terminología DO por defecto)* · **Media**
- **Qué está mal**: el catálogo base en español dice «ITBIS» en claves genéricas.
  - `purchasing.orders.form.tax_rate` = «ITBIS» (es la columna de órdenes de compra para MX, CO, AR…).
  - `pos.accounting_setup_incomplete` y `invoices.new.tax_withheld_fraction_tax` = «ITBIS retenido».
  - `accounts_payable.capture.supplier_unknown` dice «RNC» incluso en en y pt.
- **Volumen**: 13 claves es con ITBIS, 19 con RNC y 46 con NCF. Parte son claves de flujos solo DO.
- **Forma correcta**: término neutro en la base y el término dominicano en `regional/es-DO.json`.
- **Esfuerzo**: S.

**LOC-05** · localization · eje 2 · *bug* · **Alta (MX)**
- **Qué está mal**: `validateTaxId('MX','XAXX010101000')` devuelve false con y sin tipo de contribuyente. Es el RFC genérico «público en general» que exige el CFDI 4.0 para ventas a consumidor final. En cambio `XEXX010101000` sí se acepta.
- **Ubicación**: `identity-document-catalogue.ts:628` y `tax-id-validators.ts:193`.
- **Forma correcta**: aceptar los RFC genéricos publicados por el SAT como excepción explícita (verificar con contador).
- **Esfuerzo**: S.

**LOC-06** · localization · eje 3 · *multi-país (vigencia)* · **Alta**
- **Qué está mal**: las tasas del IVA, ITBIS, IGV, etc. están en constantes TS (`country-tax-schemes.ts:61-145`) y la tabla `taxes` no tiene `effective_from/to` (comprobado en `information_schema`). Un cambio de tasa (EC pasó del 12 % al 15 % en abril de 2024) no conserva el histórico: las facturas antiguas se recalculan o se validan contra la tasa nueva.
- **Lo que sí tiene vigencia**: `tax_jurisdictions` y `payroll_*`.
- **Forma correcta**: `tax_rates(tax_id, rate, effective_from, effective_to)` y validar contra la fecha de emisión.
- **Esfuerzo**: M/L.

**LOC-07** · localization · eje 4/5 · *arquitectura* · **Media**
- **Qué está mal**: las reglas de un país están repartidas en al menos 8 archivos de código:
  - `country-profiles.ts`, `country-tax-schemes.ts`, `fiscal-coverage.ts`, `coa-builder.ts`
  - `identity-document-catalogue.ts`, `fiscal-document-type-catalogue.ts`
  - `withholding-regimes.ts`, `contracts/country-pack/country-pack.ts`
- **Además**: un `switch` por país en `fiscal-adapter.factory.ts:63` y condicionales `'DO'` en `accounts-payable.service.ts:446,490`, `pos.service.ts:377`, `compliance.service.ts:494,517` y `apps/pos/src/app/domain/receipt.ts:94`. En el front, `settings-registry.ts:180-198` (`countries:['DO']`, `['US','BR']`), `fiscal-returns.page.ts:29,120`, `fiscal.page.ts:206`, y `tax-jurisdictions.page.ts:80,146,166` pone `'US'` por defecto también para BR.
- **Qué son esos condicionales**: son **guardas** (no filtran reglas DO a otros países), pero obligan a tocar código para abrir un mercado.
- **Forma correcta**: un paquete país en datos y un registro de capacidades.
- **Esfuerzo**: L.

**LOC-08** · localization · eje 1 · *código muerto* · **Baja**
- **Qué está mal**: las entidades `TaxScheme`, `CoaTemplate`, `TaxTemplate`, `LocalizationTemplate` y `ReportDefinition` tienen tablas vacías y nadie las lee. `EinvoiceProviderConfig` no tiene referencias.
- **Esfuerzo**: S.

**LOC-09** · localization · eje 2 · *bug menor* · **Media**
- **Qué está mal**:
  - La cobertura de UY, PY y los demás «genéricos» dice `taxDetermination: not-implemented`, pero se aprovisionan IVA 22/10/0 y se validan.
  - La cobertura MX/CO declara retenciones `needs-credentials` (constante `noWithholding`, `fiscal-coverage.ts:58`) cuando el catálogo de retenciones viene vacío y es el usuario quien debe crearlo: «credenciales» no es el término correcto.
  - Los textos `detail` están en español fijo y le llegan así a un tenant US con `books_language=en` (`GET /localization/fiscal-coverage` como qa-us-a).
- **Esfuerzo**: S.

**LOC-10** · localization · eje 2 · *integridad* · **Media**
- **Qué está mal**: `completePendingRegistration` no vuelve a validar el identificador fiscal y marca `tax_id_verified_at = now()` (`registration.service.ts:286-290`). Los tenants QA de GT y UY se crearon con el RNC dominicano «131190317», que además es inválido (mi prueba da false). La validación ocurre solo en `registerCheckout`.
- **Forma correcta**: volver a validar al consolidar (defensa en profundidad).
- **Esfuerzo**: S.

**LOC-11** · localization · eje 3 · *multi-país (datos)* · **Baja/Media**
- PA usa moneda `PAB`. En la práctica la contabilidad y la banca operan en USD (verificar con contador).
- `VE electronicInvoicing.required:false`: SENIAT exige facturación digital por imprenta digital a ciertos contribuyentes (Providencia SNAT/2024/000102; verificar).
- La zona horaria por defecto de US es `America/New_York` para todo el país (configurable en `organizations.timezone`).
- Los separadores de EC (`,` miles) no coinciden con CLDR es-EC (`.` miles); en CR, CLDR usa espacio. No afecta a la UI, que usa `Intl`.

## 7. Camino mínimo a producción
1. LOC-01: bloquear la emisión en BR sin jurisdicción o tributos, o degradar BR a `preview` (S/M). Para BR.
2. LOC-02 y LOC-03: nombres de cuenta neutros y mensajes de emisión por país (M). Para todos los países que no son DO.
3. LOC-05: RFC genérico (S). Para MX.
4. LOC-06: tasas con vigencia (M/L). Para todos.
5. Banner de «documento no fiscal» en los países `preview` (S). Para UY…NI.
6. LOC-10: revalidar al consolidar (S).

En LOC-06 y LOC-07 hay que rehacer, no basta con retocar: la decisión de modelar reglas como constantes TS impide la vigencia y la actualización normativa sin desplegar.

## 8. Camino a 100
- Tasas con vigencia: +8, M.
- Paquete país en datos, con un registro único y sin `switch`: +8, L.
- Planes estatutarios importables (PUC, PCGE, código agrupador SAT): +7, L.
- Motor BR (ICMS/ST/DIFAL, PIS/COFINS por régimen): +6, XL.
- Retenciones por país (CO retefuente/ReteIVA/ReteICA, PE detracciones, AR percepciones): +6, L.
- Pruebas «sin filtrado DO» por país: +4, S.
- Auditoría de cambios de tasa: +3, S.

## 9. Competitividad
- **Básicas faltantes**: plan estatutario (CO, PE, EC, BO), código agrupador SAT, retenciones locales fuera de DO, tasas con vigencia, motor BR.
- **Avanzadas**: integración con Avalara/Vertex (solo hay un punto de extensión `TAX_DETERMINATION_PROVIDERS`), declaraciones periódicas fuera de DO.
- **Diferenciadores**: un catálogo de identificadores con dígito verificador amplio (19 países) y una declaración de cobertura honesta por capacidad.
- **Referencias**: Odoo l10n_* (alta), Siigo y Alegra con PUC nativo en CO (media, no verificado hoy).

## 10. Fortalezas a preservar
- Rechazo explícito de países no soportados (`registration-strategy.factory.ts:24`; `validateTaxId('ES',…)` = false).
- Validadores con buena precisión en los casos reales (DO, MX, CO, CL, AR, BR, PE, EC, VE).
- La validación de la tasa contra el catálogo del tenant **no** filtra la tasa DO: UY y GT rechazan el 18 %.
- La determinación US tiene vigencia, sourcing y aviso en la UI.
- La tabla `fiscal-coverage` es una sola fuente para la UI y el adaptador.

## 11. No verificado
- Aislamiento A/B de `tax-jurisdictions` y `withholding-regimes`.
- La consulta a la DGII (llama a un servicio externo; no la ejecuté).
- La emisión real en MX, CO, PE y demás (es dominio de FAC).
- La UI de registro por país.
- Los identificadores de UY, PY, GT y PA quedan en confianza baja: no conseguí ejemplos oficiales verificados y no hice consultas web por la cuota.
