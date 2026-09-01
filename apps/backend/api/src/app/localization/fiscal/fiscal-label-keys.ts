/**
 * Which of a country profile's human labels are translated, and which are not.
 *
 * ## The problem
 *
 * `COUNTRY_FISCAL_PROFILES` carries the words the signup form puts on screen — `'Provincia'`,
 * `'Código postal'`, `'Tipo de ingreso'`, `'La DGII lo requiere en el e-CF y en el reporte 607.'`
 * — as Spanish literals, and `step-configuration.html` renders them raw. So an English-speaking
 * founder registering a Dominican company filled in a form that was half in a language they had
 * not chosen, and a Spanish-speaking one registering in the United States met `'State'` and
 * `'ZIP code'`. The one form that takes the customer's money was untranslatable by design.
 *
 * ## The line this file draws
 *
 * **Generic vocabulary is translated.** "Provincia", "Código postal", "Tipo de ingreso" describe
 * a kind of field. A reader needs those in their own language, and nothing is lost by giving
 * them: the field is still the same field.
 *
 * **A country's own terminology is not.** `RNC / Cédula`, `CUIT`, `CNPJ`, `Ubigeo`, `Inscrição
 * Estadual` are the names the tax authority uses, printed on the documents the user is copying
 * from. Translating "Ubigeo" to "District code" would make it *harder* to find on the page in
 * front of them, not easier. Same for the option lists of the Mexican `Régimen fiscal` and the
 * Colombian `Responsabilidades fiscales`: those are catalogue entries whose exact wording is
 * what the filing is validated against, and an approximate gloss is how somebody selects the
 * wrong regime.
 *
 * A label with no entry here is therefore NOT an oversight — it is the second category, and the
 * default of passing it through unchanged is the correct behaviour. `fiscal-labels.spec.ts`
 * pins the mapping so a new market's generic labels cannot silently join the untranslated set.
 */

/**
 * Spanish literal (as written in the profile) → catalogue key.
 *
 * Keyed on the literal rather than on a `labelKey` field added to every profile entry, because
 * the same word appears in nine countries and would otherwise be nine places to keep in step.
 */
export const FISCAL_LABEL_KEYS: Readonly<Record<string, string>> = {
  // ---- Address ----
  Provincia: 'FISCAL.LABELS.PROVINCE',
  Estado: 'FISCAL.LABELS.STATE',
  Departamento: 'FISCAL.LABELS.DEPARTMENT',
  Región: 'FISCAL.LABELS.REGION',
  State: 'FISCAL.LABELS.STATE',
  'Código postal': 'FISCAL.LABELS.POSTAL_CODE',
  // `CEP` and `ZIP code` are the local names for the same thing and stay as they are.

  // ---- Field labels that describe a kind of value ----
  'Tipo de ingreso': 'FISCAL.LABELS.INCOME_TYPE',
  'Régimen fiscal': 'FISCAL.LABELS.TAX_REGIME',
  'Responsabilidades fiscales': 'FISCAL.LABELS.TAX_RESPONSIBILITIES',
  'Giro comercial': 'FISCAL.LABELS.LINE_OF_BUSINESS',
  'Código de actividad económica': 'FISCAL.LABELS.ECONOMIC_ACTIVITY_CODE',
  'Condición frente al IVA': 'FISCAL.LABELS.VAT_CONDITION',
  'Punto de venta': 'FISCAL.LABELS.POINT_OF_SALE',
  'Obligado a llevar contabilidad': 'FISCAL.LABELS.REQUIRED_TO_KEEP_BOOKS',
  'N.º de resolución de contribuyente especial': 'FISCAL.LABELS.SPECIAL_TAXPAYER_RESOLUTION',

  // ---- The DGII income types ----
  //
  // Translated, unlike the Mexican and Colombian catalogues: these six are descriptions of
  // ordinary accounting categories rather than coded catalogue entries, the code (`01`…`06`) is
  // what actually travels in the e-CF, and it is rendered beside the label — so a reader
  // choosing by the translated description still submits the same code.
  'Ingresos por operaciones (no financieros)': 'FISCAL.DO.INCOME_TYPE.OPERATIONS',
  'Ingresos financieros': 'FISCAL.DO.INCOME_TYPE.FINANCIAL',
  'Ingresos extraordinarios': 'FISCAL.DO.INCOME_TYPE.EXTRAORDINARY',
  'Ingresos por arrendamientos': 'FISCAL.DO.INCOME_TYPE.LEASING',
  'Ingresos por venta de activo depreciable': 'FISCAL.DO.INCOME_TYPE.DEPRECIABLE_ASSET_SALE',
  'Otros ingresos': 'FISCAL.DO.INCOME_TYPE.OTHER',

  // ---- Help text ----
  //
  // Always translated: it exists to explain, and an explanation nobody can read explains nothing.
  'La DGII lo requiere en el e-CF y en el reporte 607.': 'FISCAL.HELP.DO_INCOME_TYPE',
  'El SAT lo exige en cada CFDI 4.0. Aparece en tu Constancia de Situación Fiscal.':
    'FISCAL.HELP.MX_TAX_REGIME',
  'Selecciona todas las que figuren en tu RUT. Viajan como lista en el XML de la factura electrónica.':
    'FISCAL.HELP.CO_RESPONSIBILITIES',
  'El SII lo imprime en cada documento tributario electrónico.': 'FISCAL.HELP.CL_LINE_OF_BUSINESS',
  'Código de distrito del INEI. SUNAT lo exige en el comprobante electrónico.':
    'FISCAL.HELP.PE_UBIGEO',
  'Determina qué clase de comprobante (A, B, C) podés emitir.': 'FISCAL.HELP.AR_VAT_CONDITION',
  'El punto de venta habilitado en AFIP para facturación electrónica.':
    'FISCAL.HELP.AR_POINT_OF_SALE',
  'El SRI lo exige como campo del comprobante electrónico.': 'FISCAL.HELP.EC_ACCOUNTING',
  'Obrigatório em toda NF-e.': 'FISCAL.HELP.BR_TAX_REGIME',
  'Informe ISENTO se não for contribuinte de ICMS.': 'FISCAL.HELP.BR_STATE_REGISTRATION',
};

/**
 * The catalogue key for a label, or null when the label is a country's own terminology.
 *
 * Null is a decision, not a gap — see the header.
 */
export function fiscalLabelKey(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null;
  return FISCAL_LABEL_KEYS[label.trim()] ?? null;
}
