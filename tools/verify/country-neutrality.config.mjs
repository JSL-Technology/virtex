/**
 * What «country-neutral» means, in a form a machine can count.
 *
 * The product is sold across Latin America and the United States. Each market must look and
 * behave as if the product were made there — its language, its tax and document vocabulary, its
 * authority's rules — and the way to get there is a core that knows no country, with everything
 * that belongs to one market in that market's regime adapter or in data. A Dominican word in a
 * generic screen, or `if (country === 'DO')` in a generic service, is how the next market gets the
 * Dominican product again.
 *
 * `country-neutrality.mjs` counts those occurrences outside the places they belong and fails CI
 * when a count rises. The baseline is today's debt; it can only go down.
 */

/**
 * Terms that unambiguously name one market's authority, documents, taxes or identifiers.
 * Deliberately conservative: words shared by several markets (IVA, NIT, RUC, RUT, ISR, «factura»)
 * are not here, because they do not tie code to one country.
 */
export const COUNTRY_TERMS = {
  DO: ['dgii', 'ncf', 'ecf', 'itbis', 'rnc', 'tss', 'suir', 'infotep'],
  MX: ['cfdi', 'ieps', 'diot', 'imss', 'infonavit'],
  CO: ['dian', 'cufe'],
  PE: ['sunat', 'igv'],
  CL: ['sii'],
  AR: ['afip', 'cuit'],
  BR: ['sefaz', 'nfe', 'icms', 'cnpj'],
  EC: ['sri'],
  US: ['irs', 'ein'],
};

/**
 * A stem matches as a word in any case (`NCF`, `ncf`), and as the start of a camelCase or
 * snake_case part (`ncfModified`, `assertNcfFree`, `vendor_ncf_key`) — never inside another word
 * (`median` is not `dian`).
 */
export function termPattern(stem) {
  const cap = stem[0].toUpperCase() + stem.slice(1);
  const upper = stem.toUpperCase();
  return `(?:(?<![A-Za-z])${stem}(?![a-z])|${cap}(?![a-z])|(?<![A-Za-z])${upper}(?![A-Za-z]))`;
}

/** Every market the product sells into, for the `=== 'XX'` comparisons. */
export const COUNTRY_CODES = ['DO', 'US', 'MX', 'CO', 'CL', 'PE', 'AR', 'BR', 'EC', 'UY', 'PY', 'BO', 'VE', 'PA', 'CR', 'GT', 'SV', 'HN', 'NI'];

/**
 * Where a market's vocabulary belongs. A path that matches is that market's own code or data:
 * its regime adapter, its payroll strategy, its reports, the country catalogues.
 */
export const COUNTRY_SCOPED_PATHS = [
  /\/regimes\//,
  /\/strategies\//,
  /\/adapters\//,
  /\/localization\/fiscal\//,
  /\/contracts\/country-pack\//,
  /\/reports\/(dr|mx)-/,
  /dominican/i,
  /(^|[/._-])(do|mx|co|pe|cl|ar|br|ec|us)([/._-])/,
  /\/ecf[-.]/,
  /\/einvoicing\/(services|entities|dto)\/ecf/,
  /payroll-tss/,
  // A file named after its authority is that market's, wherever it sits (`dgii-transport.service`).
  /(^|\/)(dgii|ncf|sat|pac|dian|sunat|sii|sri|afip|arca|sefaz|nfe|cfdi)[-.]/i,
];

/**
 * Never scanned: history, tests, generated catalogues — and Nest modules, the composition roots
 * that must name every regime adapter they wire.
 */
export const IGNORED_PATHS = [/\/migrations\//, /\.spec\.ts$/, /\.testing\.ts$/, /\.module\.ts$/, /\.d\.ts$/, /\/assets\/i18n\//, /\/i18n\/messages\//, /\/testing\//];

/**
 * An i18n key that belongs to one market: a segment that is a country code (`settings.fiscal.do.x`)
 * or names its authority or documents (`einvoicing.ncf_…`). Its text may — must — speak that
 * market's language. Every other key is read in all 19 markets.
 */
export const COUNTRY_SCOPED_KEY = new RegExp(
  `(^|[._])(${COUNTRY_CODES.map((c) => c.toLowerCase()).join('|')})([._]|$)|dgii|ncf|ecf|tss|suir|itbis|rnc|cfdi|sat_|dian|sunat|sii_|afip|sefaz|nfe|sri_|irs|60[6-9]`,
  'i',
);
