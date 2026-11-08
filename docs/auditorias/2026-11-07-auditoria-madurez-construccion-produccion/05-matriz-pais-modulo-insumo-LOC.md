# Insumo LOC — Matriz país × aprovisionamiento (declarado frente a real)

Familia LOC · 2026-11-07.

**Fuentes de lo «real»**
- `npm run verify:markets` contra `virteex_test` (EXIT 0, «ALL MARKETS PROVISION CLEANLY»). Log: `scratchpad/agents/loc/verify-markets.log`.
- SQL de solo lectura en `erp` sobre los tenants QA: DO, MX, US, CO, CL, BR, PE, AR, UY y GT.
- `GET /localization/fiscal-coverage` por tenant.
- `POST /invoices/preview` con `taxRate 0.18`.

**Fuentes de lo «declarado»**
- `fiscal-coverage.ts`
- `country-profiles.ts` (`marketStatus`)
- README (l.102: «los 19 mercados se aprovisionan»)

**Datos comunes a los 19 países**
- Plan de cuentas: 56 cuentas en todos, la misma estructura IFRS y 1 segmento de 4 dígitos (`coa-builder.ts`).
- Nombres del plan: en español en los países hispanos, con conceptos de nómina dominicanos en todos ellos (AFP/SFS «TSS», «SRL e INFOTEP», «Aportes Patronales (TSS/INFOTEP)», 2160 «Propina Legal», 2165 «Impuesto Selectivo al Consumo»). BR recibe pt con «Impuesto a Recuperar/Recolher» en español; US recibe inglés.
- Ningún país tiene plan estatutario (PUC, PCGE…).
- Las tasas son constantes de código **sin vigencia** (la tabla `taxes` no tiene `effective_*`).
- Nómina: solo DO (`JurisdictionRegistry`); los otros 18 países dan error.
- Retenciones: catálogo vacío salvo DO.

**Tasas**: las contrasté con mi conocimiento de la normativa pública a 2026. No pude hacer WebSearch por la cuota, así que la confianza va indicada y todo debe **verificarse con contador o abogado local**.

| País | Estado declarado (`marketStatus` / cobertura) | Impuestos aprovisionados (real) | ¿Tasa correcta? (confianza) | Documentos fiscales (catálogo BD / adaptador) | Moneda · idioma libros · TZ | Brecha principal |
|---|---|---|---|---|---|---|
| **DO** | available; ITBIS, e-CF (credenciales), 606-609 implementados, retenciones | ITBIS 18 / 16 / 0 | Sí: 18 % general, 16 % reducido (Ley 253-12) (alta) | 20 tipos (B01…B17, E31…E47) / adaptador DGII | DOP · es · America/Santo_Domingo | IT-1, IR-17 e IR-3 no implementados (declarado). Es el país de referencia. |
| **US** | preview; sales tax «needs-credentials», sin 1099 | Ninguno (las jurisdicciones las configura el tenant, con vigencia) | N/A, correcto no sembrar tasa (alta) | 0 / genérico (no aplica sello) | USD · en · America/New_York para todo el país | Sin jurisdicciones factura al 0 % con aviso en la UI. Sin 1099 ni declaraciones estatales. TZ por defecto del este. |
| **MX** | available; IVA implementado, CFDI 4.0 (CSD + PAC), contabilidad electrónica needs-config | IVA 16 / 8 frontera / 0 | 16 % y 0 % sí. El 8 % es un estímulo por decreto para la región fronteriza, no general (media) | 2 (I, E) / adaptador de numeración MX | MXN · es · America/Mexico_City | RFC genérico `XAXX010101000` rechazado (LOC-05). Cuentas TSS/INFOTEP dominicanas. Sin cuentas de IVA en flujo (trasladado/acreditable pendiente). Sin nómina IMSS. Sin DIOT. |
| **CO** | available; IVA, DIAN UBL (credenciales) | IVA 19 / 5 / excluido 0 | Sí (alta) | 2 (01, 91) / adaptador CO | COP · es · America/Bogota | Sin PUC (Decreto 2650; avisado en código). Sin retefuente, ReteIVA ni ReteICA. Sin nómina. |
| **CL** | available; IVA, SII DTE (CAF) | IVA 19 / exento | Sí (alta) | 3 (33, 34, 61) / adaptador CL | CLP · es · America/Santiago | Sin boleta 39/41 ni guía 52 (verificar). Sin F29. Sin nómina. |
| **PE** | available; IGV, SUNAT UBL | IGV 18 / exonerado | 18 % = IGV 16 % + IPM 2 % (alta). Falta la tasa reducida MYPE de restaurantes y hoteles (Ley 31556) (media) | 3 (01, 03, 07) / adaptador PE | PEN · es · America/Lima | Sin PCGE (avisado). Sin detracciones, percepciones ni retenciones (declarado). |
| **AR** | available; IVA, AFIP CAE | IVA 21 / 10,5 / 27 / exento | Sí (alta) | 6 (1, 3, 6, 8, 11, 13) / adaptador AR | ARS · es · America/Argentina/Buenos_Aires | Sin percepciones ni retenciones IIBB/IVA. Sin nómina. |
| **BR** | **available**; taxDetermination needs-credentials, NF-e (A1/A3 + SEFAZ) | **Ninguno** | N/A (ICMS, ISS y PIS/COFINS dependen del estado y del régimen) | 1 (55) / adaptador BR | BRL · pt · America/Sao_Paulo | **CRÍTICO LOC-01**: factura al 0 % sin bloqueo (preview con 18 % → tax 0). Usa el motor de sales tax de EE. UU. La UI pide «série B/E» (NCF dominicano). Cuentas con «Impuesto» en español. |
| **EC** | available; IVA, SRI | IVA 15 / 0 | 15 % desde abril de 2024 (alta), pero sin vigencia: las facturas de 2023 al 12 % no se pueden validar (LOC-06) | 2 (01, 04) / adaptador EC | USD · es · America/Guayaquil | Sin catálogo de la Supercías (avisado). Sin retenciones (obligatorias en EC). |
| **UY** | preview; cobertura genérica: todo not-implemented salvo contabilidad | IVA 22 / 10 / exento | Sí (alta) | 0 / genérico (sin número fiscal) | UYU · es · America/Montevideo | Sin CFE de la DGI. La factura se emite sin aviso de que no es fiscal (UI verificada). La cobertura dice taxDetermination not-implemented pero el IVA se valida. |
| **PY** | preview | IVA 10 / 5 / exento | Sí (alta) | 0 / genérico | PYG · es · America/Asuncion | Sin SIFEN/e-Kuatia. Sin aviso. |
| **BO** | preview | IVA 13 / exento | 13 % nominal, incluido en el precio (tasa efectiva 14,94 %); el modelo «sobre la base» puede ser incorrecto (media) | 0 / genérico | BOB · es · America/La_Paz | Sin facturación en línea del SIN. Sin IT 3 %. Sin plan del SIN (avisado). |
| **VE** | preview; e-invoicing required:false | IVA 16 / exento | 16 % general sí (alta). Falta el reducido del 8 % y el IGTF del 3 % (media) | 0 / genérico | VES · es · America/Caracas | `required:false` dudoso (Providencia SNAT/2024/000102; verificar). Inflación y reexpresión no tratadas. |
| **PA** | preview | ITBMS 7 / exento | 7 % general sí; faltan el 10 % y el 15 % de licores y tabaco (media) | 0 / genérico | **PAB** (en la práctica USD) · es · America/Panama | Sin SFEP. Moneda poco práctica. |
| **CR** | preview; propina 10 % | IVA 13 / exento | 13 % sí; faltan los reducidos del 4 %, 2 % y 1 % (media) | 0 / genérico | CRC · es · America/Costa_Rica | Sin FE de Hacienda (obligatoria). Validador de cédula solo estructural. |
| **GT** | preview | IVA 12 / exento | Sí (alta) | 0 / genérico | GTQ · es · America/Guatemala | Sin FEL de la SAT (obligatoria). Sin aviso. |
| **SV** | preview | IVA 13 / exento | Sí (alta) | 0 / genérico | USD · es · America/El_Salvador | Sin DTE de Hacienda (obligatorio). NIT solo estructural (14 dígitos). |
| **HN** | preview; e-invoicing required:false | ISV 15 / exento | 15 % sí; falta el 18 % de bebidas y tabaco (media) | 0 / genérico | HNL · es · America/Tegucigalpa | Sin documentos de la SAR (CAI). RTN solo estructural. |
| **NI** | preview; required:false | IVA 15 / exento | Sí (alta) | 0 / genérico | NIO · es · America/Managua | RUC solo estructural. |

## Validadores de identificador fiscal (prueba propia)
Script: `scratchpad/agents/loc/taxids.ts`, compilado con esbuild y ejecutado contra `validateTaxId` real. Resultado: 53 casos.

**Válidos reales que se aceptan**
- DO: DGII 401-50625-4
- MX: SAT970701NN3, EKU9003173C9, XEXX010101000
- CO: DIAN 800197268-4, Ecopetrol 899999068-1
- CL: SII 60.803.000-K, Codelco 61.704.000-K
- AR: AFIP 33-69345023-9, YPF 30-54668997-9
- BR: Petrobras 33.000.167/0001-01, BB 00.000.000/0001-91, CPF 111.444.777-35
- PE: SUNAT 20131312955
- EC: SRI 1760013210001
- VE: PDVSA J-00123072-6
- US: EIN 94-2404110

**Inválidos que se rechazan**
- Dígito verificador alterado en DO, MX, CO, CL, AR, BR, PE, EC y VE.
- EIN con prefijo 07 y SSN de área 666.
- Países no soportados (XX, ES).

**Defectos**
- MX `XAXX010101000` («público en general») rechazado (LOC-05).
- US SSN 078-05-1120 (anulado por la SSA) aceptado (baja).
- PA, CR, BO, SV, HN y NI solo tienen validación estructural: cualquier número de la longitud correcta pasa (declarado en el código).
- UY, PY y GT: confianza baja, sin ejemplos oficiales verificados.

## País no soportado
- El registro lo rechaza: `registration-strategy.factory.ts:24` devuelve `auth.country_country_code_not_available_registration`.
- `validateTaxId` devuelve false.
- `coverageFor()` da «solo contabilidad».

No hay caída a DO por defecto. **Pero** dentro de los países soportados lo dominicano se filtra en tres sitios:
- nombres de cuenta;
- términos del catálogo base («ITBIS», «RNC»);
- requisito de «serie B/E» en BR.

Los condicionales `=== 'DO'` del backend (AP, POS, compliance) y del front (`settings-registry`, `fiscal.page`, `fiscal-returns`) son guardas: no aplican reglas DO a otros países.

## Agrupación por situación
- **DO**: completo en la práctica (piloto).
- **MX, CO, CL, PE, AR, EC**: impuestos nacionales correctos y documentos con credenciales. Sin planes estatutarios, sin retenciones locales y sin nómina, con nombres de nómina DO.
- **BR**: no listo. Cálculo fiscal incorrecto (crítico) pese a declararse `available`.
- **US**: sales tax configurable y correcto en diseño. Sin declaraciones ni nómina.
- **UY, PY, BO, VE, PA, CR, GT, SV, HN, NI**: solo contabilidad genérica más la tasa nacional. Sin documento fiscal y sin aviso en la factura, a pesar de que la factura electrónica es obligatoria por ley en UY, PY, BO, PA, CR, GT y SV.
