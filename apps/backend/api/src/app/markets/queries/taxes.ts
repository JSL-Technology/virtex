import type { MarketTaxScheme, MarketWithholdingRegime, WithholdingKind, WithholdingPartyType, WithholdingScope } from '../contracts';
import { knownMarket, marketFor } from '../registry';

/**
 * Taxes across the catalogue: the consumption taxes a company starts with, and the withholding a
 * sale is subject to.
 */

/** The consumption taxes a company of the market starts with; undefined where the product is not sold. */
export function taxSchemeFor(countryCode: string | null | undefined): MarketTaxScheme | undefined {
  return knownMarket(countryCode)?.taxes.scheme;
}

/** The name of the market's principal consumption tax, as the ledger names its accounts. */
export function principalTaxName(countryCode: string | null | undefined): string {
  return marketFor(countryCode).taxes.principalTaxName;
}

/** A withholding table: the market's own, or the one a tenant configured. */
export interface WithholdingTable {
  regimes: readonly MarketWithholdingRegime[];
  configurationRequired: boolean;
}

/**
 * The regimes that apply to a sale, given who buys, who sells and what is sold, on the document's
 * date. At most one of each kind: a document cannot be subject to two rates of the same withholding
 * at once, and where the table would allow it the more specific rule — the one that names the
 * payee's classification — wins over the general one. Nothing applies from a table that still needs
 * the tenant's configuration.
 */
export function applicableWithholdingRegimes<R extends MarketWithholdingRegime>(
  table: { regimes: readonly R[]; configurationRequired: boolean } | undefined,
  context: { payer: WithholdingPartyType; payee: WithholdingPartyType; scope: Exclude<WithholdingScope, 'ANY'>; on: string },
): R[] {
  if (!table || table.configurationRequired) return [];

  const matches = table.regimes.filter(
    (regime) =>
      inForceOn(regime, context.on) &&
      regime.payers.includes(context.payer) &&
      (regime.payees === undefined || regime.payees.includes(context.payee)) &&
      (regime.scope === 'ANY' || regime.scope === context.scope),
  );

  const bestOf = (kind: WithholdingKind): R | undefined => {
    const ofKind = matches.filter((regime) => regime.kind === kind);
    if (ofKind.length <= 1) return ofKind[0];
    // The rule that names the payee is the specific one; the one that does not is the fallback.
    return ofKind.sort((a, b) => Number(Boolean(b.payees)) - Number(Boolean(a.payees)))[0];
  };

  return [bestOf('VAT'), bestOf('INCOME')].filter((regime): regime is R => regime !== undefined);
}

/** True when the period contains the date. Open bounds are null. */
export function inForceOn(period: { effectiveFrom: string | null; effectiveTo: string | null }, date: string): boolean {
  return (!period.effectiveFrom || period.effectiveFrom <= date) && (!period.effectiveTo || period.effectiveTo >= date);
}
