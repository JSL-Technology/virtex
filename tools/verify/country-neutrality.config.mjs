/**
 * What «country-neutral» means, in a form a machine can count.
 *
 * The product is sold across Latin America and the United States. Each market must look and
 * behave as if the product were made there — its language, its tax and document vocabulary, its
 * authority's rules — and the way to get there is a core that knows no country, with everything
 * that belongs to one market in that market's package, `markets/<cc>/`, reached through the
 * registry (docs/ARQUITECTURA_MERCADOS.md). A Dominican word in a generic screen,
 * `if (country === 'DO')` in a generic service, or an import of `markets/do/` from a business
 * module is how the next market gets the Dominican product again.
 *
 * `country-neutrality.mjs` counts those occurrences outside the market packages and fails CI when a
 * count rises. The baseline is today's debt; it can only go down, and the plan's last phase takes it
 * to zero.
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
 * Where a market's vocabulary belongs.
 *
 * Two places, and only two (docs/ARQUITECTURA_MERCADOS.md):
 *
 * - `markets/<cc>/` — the market's own package: its policy, its catalogues, its engines.
 * - `einvoicing/regimes/<cc>/` and `localization/drivers/<cc>/` — the DRIVERS that implement a
 *   market's electronic invoicing and its authority's tax-id registry. They cannot live in the
 *   package: they need the document entities (the invoice, its lines, the customer) and an HTTP
 *   client, and `markets/` depends on no business module (§2.4, §2.11). The package declares the
 *   POLICY — whether the law requires a regime, what it is called, what it asks of the company —
 *   and the driver implements it.
 *
 * Nothing else is exempt: not the contract, the kit or the queries of `markets/`, nor the shared
 * files of `einvoicing/` (its outbox, its ranges, its certificates), which serve every market
 * alike. Code of one market that still lives outside those two packages is counted, so the debt is
 * visible and only goes down as each phase of the plan moves it.
 */
export const MARKET_PACKAGE = new RegExp(
  `^/(?:markets|einvoicing/regimes|localization/drivers)/(${COUNTRY_CODES.map((c) => c.toLowerCase()).join('|')})/`,
);

/**
 * The files that ASSEMBLE the packages, and may therefore import them by name.
 *
 * `markets/catalogue.ts` lists every market package; `einvoicing/einvoicing.module.ts` wires every
 * regime adapter into the application and `localization-provisioning.module.ts` every tax-id
 * registry driver, which is the same job for the other halves (§2.11). Every other file reaches a
 * market through the registry (`markets/index.ts`), a regime through `FiscalRegimeRegistry` and a
 * registry driver through `TaxIdRegistryRegistry`.
 */
export const MARKET_ASSEMBLY = [
  '/markets/catalogue.ts',
  '/einvoicing/einvoicing.module.ts',
  '/einvoicing/regimes/fiscal-regime.registry.ts',
  '/localization/localization-provisioning.module.ts',
];

/**
 * Never scanned: history (a migration records what the schema was, in the words of its time), tests
 * and their fixtures, and generated catalogues.
 */
export const IGNORED_PATHS = [/\/migrations\//, /\.spec\.ts$/, /\.testing\.ts$/, /\.d\.ts$/, /\/assets\/i18n\//, /\/i18n\/messages\//, /\/testing\//];

/**
 * An i18n key that belongs to one market: a segment that is a country code (`settings.fiscal.do.x`)
 * or names its authority or documents (`einvoicing.ncf_…`, `…tax_name.icms_iss`). Its text may —
 * must — speak that market's language: a market package declares these keys itself
 * (`markets/<cc>/taxes.ts`, `markets/<cc>/purchases.ts`) and nothing else reads them. Every other
 * key is read in all 19 markets, and a market's word in one of those is what a regional patch
 * (`libs/shared/locales/src/regional/`) exists to add.
 */
export const COUNTRY_SCOPED_KEY = new RegExp(
  `(^|[._])(${COUNTRY_CODES.map((c) => c.toLowerCase()).join('|')})([._]|$)|dgii|ncf|ecf|tss|suir|itbis|rnc|cfdi|sat_|dian|cufe|sunat|sii_|afip|sefaz|nfe|icms|sri_|irs|60[6-9]`,
  'i',
);
