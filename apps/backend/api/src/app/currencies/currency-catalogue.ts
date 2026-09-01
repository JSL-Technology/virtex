/**
 * The ISO 4217 currencies the product ships knowing about.
 *
 * `currency` is referenced by a foreign key from `invoices.currency_code`, `vendor_bills` and
 * `quotes`, and nothing ever populated it. The table was empty in every environment, so the very
 * first invoice a tenant tried to issue violated `FK_ac87bccead7522c5bed20d3b996` — a constraint
 * error surfacing as a 500 with no explanation. A currency list is reference data, identical for
 * every tenant, and belongs in code where it is reviewable, not in a manual INSERT somebody has to
 * remember per environment.
 *
 * The list covers the currency of every market in `COUNTRY_FISCAL_PROFILES` plus the majors a
 * Latin American exporter actually invoices in. `minorUnits` is the ISO 4217 exponent and drives
 * rounding: Chilean and Paraguayan amounts carry no decimals, and rounding them to two produces
 * totals their tax authorities reject.
 */
export interface CurrencyDefinition {
  code: string;
  name: string;
  symbol: string;
  /** ISO 4217 exponent: number of decimal places the currency is expressed in. */
  minorUnits: number;
}

export const CURRENCY_CATALOGUE: readonly CurrencyDefinition[] = Object.freeze([
  { code: 'DOP', name: 'Peso dominicano', symbol: 'RD$', minorUnits: 2 },
  { code: 'USD', name: 'Dólar estadounidense', symbol: 'US$', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
  { code: 'MXN', name: 'Peso mexicano', symbol: 'MX$', minorUnits: 2 },
  { code: 'COP', name: 'Peso colombiano', symbol: 'CO$', minorUnits: 2 },
  { code: 'CLP', name: 'Peso chileno', symbol: 'CL$', minorUnits: 0 },
  { code: 'PEN', name: 'Sol peruano', symbol: 'S/', minorUnits: 2 },
  { code: 'ARS', name: 'Peso argentino', symbol: 'AR$', minorUnits: 2 },
  { code: 'BRL', name: 'Real brasileño', symbol: 'R$', minorUnits: 2 },
  { code: 'UYU', name: 'Peso uruguayo', symbol: '$U', minorUnits: 2 },
  { code: 'PYG', name: 'Guaraní paraguayo', symbol: '₲', minorUnits: 0 },
  { code: 'BOB', name: 'Boliviano', symbol: 'Bs', minorUnits: 2 },
  { code: 'VES', name: 'Bolívar venezolano', symbol: 'Bs.', minorUnits: 2 },
  { code: 'PAB', name: 'Balboa panameño', symbol: 'B/.', minorUnits: 2 },
  { code: 'CRC', name: 'Colón costarricense', symbol: '₡', minorUnits: 2 },
  { code: 'GTQ', name: 'Quetzal guatemalteco', symbol: 'Q', minorUnits: 2 },
  { code: 'HNL', name: 'Lempira hondureño', symbol: 'L', minorUnits: 2 },
  { code: 'NIO', name: 'Córdoba nicaragüense', symbol: 'C$', minorUnits: 2 },
  { code: 'CAD', name: 'Dólar canadiense', symbol: 'CA$', minorUnits: 2 },
  { code: 'GBP', name: 'Libra esterlina', symbol: '£', minorUnits: 2 },
  { code: 'CHF', name: 'Franco suizo', symbol: 'CHF', minorUnits: 2 },
  { code: 'JPY', name: 'Yen japonés', symbol: '¥', minorUnits: 0 },
  { code: 'CNY', name: 'Yuan chino', symbol: 'CN¥', minorUnits: 2 },
]);

const BY_CODE = new Map(CURRENCY_CATALOGUE.map((c) => [c.code, c]));

export function findCurrency(code: string): CurrencyDefinition | undefined {
  return BY_CODE.get((code ?? '').toUpperCase());
}

/**
 * Decimal places a currency is expressed in. Unknown codes fall back to 2, the overwhelmingly
 * common case; a wrong exponent on a known currency is the failure worth preventing, and this list
 * covers every market the product sells into.
 */
export function minorUnitsFor(code: string): number {
  return findCurrency(code)?.minorUnits ?? 2;
}
