# Ficha T06: Internacionalización (`i18n` backend, `libs/shared/locales`, `libs/shared/ui-i18n`, `tools/i18n`)

Familia F3. Fecha: 2026-10-31.

> No hay hallazgos críticos de seguridad. No hay hallazgos críticos.

## 1. Identificación

**Backend: `apps/backend/api/src/app/i18n`**
- 11 archivos, 1 786 LOC y 4 specs.
- Interceptor de idioma (`locale.interceptor.ts`), `I18nExceptionFilter` y `LocalizedException`.
- Catálogos generados `messages/{es,en,pt}.json`, con **9 885 claves cada uno** (paridad exacta) y `regional.json` con 53 sustituciones.
- `regional-format.dto.ts` para el formato regional por usuario: orden y separador de fecha, formato numérico, formato de hora y primer día de la semana.

**Fuente única: `libs/shared/locales/src`**
- `base/*.json`: 120 archivos, cada clave con `es`/`en`/`pt` o `literal`.
- `regional/*.json`: 8 locales (es-DO 20 claves, es-MX 11, es-AR 7, es-CL, es-CO, es-PE, pt-BR 9, en-US 3).
- `targets.json` y `composed-keys.json`.

**Frontend: `libs/shared/ui-i18n`**
- `FormatService` basado en `Intl`, con caché de formateadores y zona horaria.
- `LocaleStore`, manejador de traducciones faltantes, pipes y directiva de entrada numérica.

**Herramientas: `tools/i18n`**
- `build-catalogues`, `verify-catalogues`, `scan-hardcoded-strings`, `scan-typescript-prose` (con baseline de 32), `verify-localized-names`.
- Todas corren en CI (`.github/workflows/ci.yml:180-186`).

**Otros**
- Correos: plantillas por idioma (`mail/mail-template.helpers.ts`, `mail.processor.ts:54`, que traduce el asunto con `subjectKey`).
- PDF de factura: claves `invoice.pdf.*`, con sustituciones regionales.

**¿Es núcleo?** Sí, es transversal a todo el producto.

## 2. Estándar de referencia

**Capacidades básicas**
- Paridad de idiomas, sin texto hardcodeado.
- Errores del servidor como clave + parámetros, traducidos al idioma del lector.
- Formatos de número, fecha y moneda por locale y por usuario.
- Terminología fiscal regional: ITBIS/IVA/IGV, RNC/RFC/NIT, "aguinaldo" frente a "regalía pascual".
- Plantillas de correo y de factura traducidas.

**Capacidades avanzadas**
- Plurales ICU y localización de nombres de catálogo (cuentas).
- Flujo de traducción profesional con memoria.
- Variante pt-BR (no pt-PT) para Brasil.

**Referentes (confianza media):** Odoo (catálogos `.po` por módulo y variantes `es_MX`/`es_CO`/`pt_BR`), Dynamics y NetSuite (paquetes de idioma por locale).

## 3. Resultado

- **Madurez: 62** (55–70, confianza media).
- **Preparación: 60.** Veredicto: **Piloto controlado**.
- **Eje más débil:** 3 (cobertura regional y pt-BR).
- **Hallazgos:** 0 críticos, 1 alto.

## 4. Doce ejes

| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 68 (60–75, media) | Paridad de 9 885 claves en es/en/pt. `i18n:verify` en OK: "No untranslated interface text" y 15 literales permitidos (`logs/i18n:verify.log`) | Cerrar la baseline de 32 frases en TypeScript del cliente |
| 2 | Corrección | 58 (50–65, media) | **41 claves pt en español** (p. ej. `accounts_payable.debit_notes.posted` = «Nota de débito {{number}} contabilizada.»). **38 con marcadores de pt-PT** («ficheiro», «Verifica-a, ou emite»), en 11 archivos base | Revisión nativa pt-BR |
| 3 | Multi-país | 55 (45–62, media) | Hay sustituciones regionales solo para 8 locales (53 claves). EC, UY, PY, BO, VE, PA, CR, GT, SV, HN y NI usan el español neutro. Los formatos de país están en `country-profiles.ts`. El usuario puede fijar su formato regional | Terminología por país para los 19 países declarados |
| 4 | Arquitectura | 72 (65–78, media) | Fuente única que genera los catálogos de back y front. El servidor devuelve claves (`messageKey`, `fieldErrors[].key`) y el cliente traduce. Verificado: 400 en `POST /taxes` con claves en es/en/pt | — |
| 5 | Higiene | 68 (60–74, baja) | Herramientas con baseline. Persisten algunos respaldos `?? 'es'` (`ai/*`, `notifications/*`) | Un único resolutor de idioma |
| 6 | Calidad | 70 (62–76, media) | `FormatService` usa `Intl` con caché y zona horaria; `money()` exige el código de moneda | `regional-format-editor.component.ts:226` fija `'en-US'` para un ejemplo |
| 7 | Robustez | 68 (60–74, baja) | Manejador de traducción faltante | — |
| 8 | Seguridad | 75 (68–80, baja) | N/A en su mayoría. Los parámetros de los mensajes se interpolan; el escape en plantillas de correo no está verificado | Verificar el escape en HBS |
| 9 | Pruebas | 66 (58–72, media) | 4 specs en backend, `regional-catalogue.spec`, `locale-source.spec` y verificadores en CI | Prueba que impida que pt contenga frases en español |
| 10 | Operabilidad | 60 (50–68, baja) | Errores de traducción visibles en desarrollo | Métrica de claves faltantes en producción |
| 11 | UX | 60 (50–68, baja) | No recorrí la UI | — |
| 12 | Competitividad | 60 (52–68, media) | Comparable a Odoo en estructura; por debajo en variantes regionales | — |

## 5. Compuertas

| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | Cumple | — |
| 2 | Integridad | N/A | Módulo sin escrituras críticas |
| 3 | Aislamiento | N/A | El formato regional es por usuario |
| 4 | Validación en servidor | Cumple | DTO con `IsIn` |
| 5 | E2E | Cumple en lo probado | — |
| 6 | Cumplimiento por país | Parcial | Terminología regional solo en 8 locales |
| 7 | CI | Cumple | Verificadores en CI |
| 8 | Auditoría | N/A | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | Traducciones completas | **No cumple** | pt incompleto y en pt-PT |
| 12 | Documentación | Parcial | Las herramientas documentan su uso |

## 6. Hallazgos

### I18N-01 · El catálogo "pt" mezcla español y portugués europeo para un mercado brasileño
- **Ejes:** 2 y 3. **Categoría:** UX y multi-país. **Severidad: Alta** (bloquea la venta en BR, único mercado lusófono).
- **Ubicación:** `libs/shared/locales/src/base/*.json`, 11 archivos con «ficheiro», «utilizador» o «ecrã». Hay 41 claves con marcadores de español, entre ellas `accounts_payable.debit_note_*`, `data_imports.imported` y `ai.admin.credits_used`.
- **Cómo se obtuvo:** script Python sobre `apps/backend/api/src/app/i18n/messages/pt.json` comparando con es.
- **Forma correcta:** etiquetar el idioma como `pt-BR`, hacer una revisión nativa y añadir al verificador una prueba que falle si `pt == es` en frases de más de 3 palabras.
- **Esfuerzo:** M.

### I18N-02 · Terminología regional solo para 8 de los 19 países
- **Eje:** 3. **Severidad:** Media.
- **Ubicación:** `libs/shared/locales/src/regional/`.
- **Qué falta:** EC, UY, PY, BO, VE, PA, CR, GT, SV, HN y NI no tienen sustituciones. Ejemplos: «ITBMS» en PA, «ISV» en HN, «aguinaldo» en CR/GT/SV/HN/NI y «décimo tercero» en EC/PA.
- **Mitigación parcial:** los nombres de impuesto vienen de `country-tax-schemes.ts`.
- **Esfuerzo:** S–M.

### I18N-03 · Baseline de 32 frases en español en TypeScript del cliente
- **Eje:** 1. **Severidad:** Media.
- **Ubicación:** `tools/i18n/typescript-prose-baseline.json`.
- **Problema:** texto visible sin traducir para usuarios en inglés o portugués.
- **Esfuerzo:** S.

### I18N-04 · Respaldos de idioma dispersos
- **Eje:** 5. **Severidad:** Baja.
- **Ubicación:** `?? 'es'` en `ai/close/close-assistant.service.ts:113`, `ai/engine/ai-scheduler.service.ts:84`, `notifications/*` y `invoices.controller.ts:322`.
- **Esfuerzo:** S.

## 7. Camino mínimo a producción

1. I18N-01, si se vende en Brasil.
2. I18N-03.
3. I18N-02, para los países que se activen.

## 8. Camino a 100

| Acción | Puntos | Esfuerzo |
|---|---|---|
| Revisión nativa pt-BR y verificador anti-mezcla | +10 | M |
| Variantes regionales para los 19 países | +8 | M |
| Cerrar la baseline de prosa | +4 | S |
| Métrica de claves faltantes en producción | +3 | S |
| Flujo de traducción profesional (TMS) | +5 | M |

## 9. Competitividad

**Nota: 60** (52–68, confianza media).
- **Diferenciadores:** fuente única para backend y frontend, errores del servidor como claves con parámetros y formato regional por usuario.
- **Brecha:** la variante pt-BR.

## 10. Fortalezas

- Paridad exacta de claves y verificadores en CI.
- Contrato de errores basado en claves.
- `FormatService` con `Intl` y zona horaria por país.
- Correos y PDF de factura traducidos por idioma.

## 11. No verificado

- La UI en los tres idiomas (no recorrí con Playwright).
- La calidad del inglés.
- El escape en las plantillas HBS.

**Cobertura:**
- Aproximadamente 40 % de los archivos.
- Catálogos: 100 % analizados por script.
- Endpoint ejecutado: 1 error de validación en 3 idiomas.

<!-- RESUMEN: modulo=internacionalizacion; madurez=62; prep=60; veredicto=Piloto controlado; eje_debil=Multi-país y cumplimiento; criticos=0; altos=1; camino_min=M -->
