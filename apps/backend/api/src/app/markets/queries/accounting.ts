import type { CoaSegmentSpec } from '../contracts';
import { allMarkets, isKnownMarket, marketFor } from '../registry';

/**
 * The chart-of-accounts facts each market declares: the shape of its account codes, the official
 * plan its law prescribes, and the names that belong to its institutions alone.
 */

/**
 * The default account-code structure: the starting plan writes four-digit codes (`1000` → `1100` →
 * `1110`), which is one segment; the hierarchy is carried by `parentId`, not by the code's
 * punctuation.
 */
const DEFAULT_COA_SEGMENTS: readonly CoaSegmentSpec[] = Object.freeze([
  Object.freeze({ name: 'Cuenta', length: 4, isRequired: true }),
]);

/** The account-code structure a market's chart of accounts is written in. */
export function coaSegmentsFor(countryCode: string): readonly CoaSegmentSpec[] {
  return marketFor(countryCode).accounting.segments ?? DEFAULT_COA_SEGMENTS;
}

/** Total number of characters a market's account code carries. */
export function coaCodeLength(countryCode: string): number {
  return coaSegmentsFor(countryCode).reduce((total, segment) => total + segment.length, 0);
}

/**
 * Split a template code into the segments the market's structure declares. Throws rather than
 * truncating: a code that does not fit is a defect in the template, and the only thing worse than
 * failing to provision is provisioning a chart whose codes have been silently reshaped.
 */
export function splitCoaCode(countryCode: string, code: string): string[] {
  const specs = coaSegmentsFor(countryCode);
  const expected = coaCodeLength(countryCode);
  if (code.length !== expected) {
    throw new Error(
      `El código contable "${code}" no encaja en la estructura de ${countryCode} ` +
        `(${specs.map((s) => s.length).join('-')}, ${expected} caracteres).`,
    );
  }
  const segments: string[] = [];
  let offset = 0;
  for (const spec of specs) {
    segments.push(code.slice(offset, offset + spec.length));
    offset += spec.length;
  }
  return segments;
}

/** The official plan each market's law prescribes, where it does. */
export const STATUTORY_PLAN_REQUIRED: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    allMarkets()
      .filter((market) => market.accounting.statutoryPlanRequired)
      .map((market) => [market.code, market.accounting.statutoryPlanRequired as string]),
  ),
);

/** True when the market is one whose statutory plan the starting template does not reproduce. */
export function requiresStatutoryPlanImport(countryCode: string): boolean {
  return Boolean(marketFor(countryCode).accounting.statutoryPlanRequired);
}

/** A market the product is not sold in has no chart of accounts. */
export function hasCoaTemplate(countryCode: string): boolean {
  return isKnownMarket(countryCode);
}

/**
 * Names in the opening plan that belong to ONE market's institutions. A plan provisioned for any other
 * market must contain none of them.
 */
export const COUNTRY_SPECIFIC_COA_TERMS: Readonly<Record<string, readonly RegExp[]>> = Object.freeze(
  Object.fromEntries(
    allMarkets()
      .filter((market) => market.accounting.exclusiveTerms.length > 0)
      .map((market) => [market.code, market.accounting.exclusiveTerms]),
  ),
);
