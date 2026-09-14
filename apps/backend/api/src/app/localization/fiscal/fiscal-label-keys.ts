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
  Provincia: 'fiscal.labels.province',
  Estado: 'fiscal.labels.state',
  Departamento: 'fiscal.labels.department',
  Región: 'fiscal.labels.region',
  State: 'fiscal.labels.state',
  'Código postal': 'fiscal.labels.postal_code',
  // `CEP` and `ZIP code` are the local names for the same thing and stay as they are.

  // ---- Field labels that describe a kind of value ----
  'Tipo de ingreso': 'fiscal.labels.income_type',
  'Régimen fiscal': 'fiscal.labels.tax_regime',
  'Responsabilidades fiscales': 'fiscal.labels.tax_responsibilities',
  'Giro comercial': 'fiscal.labels.line_of_business',
  'Código de actividad económica': 'fiscal.labels.economic_activity_code',
  'Condición frente al IVA': 'fiscal.labels.vat_condition',
  'Punto de venta': 'fiscal.labels.point_of_sale',
  'Obligado a llevar contabilidad': 'fiscal.labels.required_to_keep_books',
  'N.º de resolución de contribuyente especial': 'fiscal.labels.special_taxpayer_resolution',

  // ---- The DGII income types ----
  //
  // Translated, unlike the Mexican and Colombian catalogues: these six are descriptions of
  // ordinary accounting categories rather than coded catalogue entries, the code (`01`…`06`) is
  // what actually travels in the e-CF, and it is rendered beside the label — so a reader
  // choosing by the translated description still submits the same code.
  'Ingresos por operaciones (no financieros)': 'fiscal.do.income_type.operations',
  'Ingresos financieros': 'fiscal.do.income_type.financial',
  'Ingresos extraordinarios': 'fiscal.do.income_type.extraordinary',
  'Ingresos por arrendamientos': 'fiscal.do.income_type.leasing',
  'Ingresos por venta de activo depreciable': 'fiscal.do.income_type.depreciable_asset_sale',
  'Otros ingresos': 'fiscal.do.income_type.other',

  // ---- Help text ----
  //
  // Always translated: it exists to explain, and an explanation nobody can read explains nothing.
  'La DGII lo requiere en el e-CF y en el reporte 607.': 'fiscal.help.do_income_type',
  'El SAT lo exige en cada CFDI 4.0. Aparece en tu Constancia de Situación Fiscal.':
    'fiscal.help.mx_tax_regime',
  'Selecciona todas las que figuren en tu RUT. Viajan como lista en el XML de la factura electrónica.':
    'fiscal.help.co_responsibilities',
  'El SII lo imprime en cada documento tributario electrónico.': 'fiscal.help.cl_line_of_business',
  'Código de distrito del INEI. SUNAT lo exige en el comprobante electrónico.':
    'fiscal.help.pe_ubigeo',
  'Determina qué clase de comprobante (A, B, C) podés emitir.': 'fiscal.help.ar_vat_condition',
  'El punto de venta habilitado en AFIP para facturación electrónica.':
    'fiscal.help.ar_point_of_sale',
  'El SRI lo exige como campo del comprobante electrónico.': 'fiscal.help.ec_accounting',
  'Obrigatório em toda NF-e.': 'fiscal.help.br_tax_regime',
  'Informe ISENTO se não for contribuinte de ICMS.': 'fiscal.help.br_state_registration',
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
