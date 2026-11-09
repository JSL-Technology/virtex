import {
  TaxpayerType,
  allMarkets,
  applicableWithholdingRegimes,
  inForceOn,
  knownMarket,
  type WithholdingKind,
  type WithholdingScope,
} from '../../markets';

/**
 * Withholding at source, as each market declares it (`markets/<cc>/taxes.ts`), in the shape the
 * withholding resolver and the tenant's own regimes (`tenant_withholding_regimes`) were written
 * against.
 *
 * Every rate must be confirmed against the tenant's own tax advice before it is relied on — rates
 * change by decree between releases, and a taxpayer's classification is a fact about that taxpayer,
 * not about this software. `legalBasis` names the instrument so the confirmation is a lookup rather
 * than a research project.
 */
export { TaxpayerType, inForceOn, type WithholdingKind, type WithholdingScope };

export interface WithholdingRegime {
  /** Stable identifier recorded on the document, so a filing can be traced to the rule applied. */
  code: string;
  kind: WithholdingKind;
  /** As a fraction: of the output tax for `VAT`, of the taxable base for `INCOME`. */
  rate: number;
  /** The buyer classifications this regime applies to. */
  payers: TaxpayerType[];
  /** The seller classifications it applies to. Absent means any. */
  payees?: TaxpayerType[];
  scope: WithholdingScope;
  /** What the tenant sees, in the country's own terminology. */
  label: string;
  /** The instrument that establishes it. */
  legalBasis: string;
  /** The period the regime applies in. Open bounds are null. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface CountryWithholdingScheme {
  regimes: WithholdingRegime[];
  /** True when nothing applies until the tenant configures its own regimes. */
  configurationRequired: boolean;
  /** Shown to the tenant when `configurationRequired`. */
  configurationNote?: string;
}

function legacyScheme(countryCode: string): CountryWithholdingScheme | undefined {
  const market = knownMarket(countryCode);
  if (!market) return undefined;
  const withholding = market.taxes.withholding;
  return {
    regimes: withholding.regimes.map((regime) => ({
      ...regime,
      payers: [...regime.payers] as TaxpayerType[],
      payees: regime.payees ? ([...regime.payees] as TaxpayerType[]) : undefined,
    })),
    configurationRequired: withholding.configurationRequired,
    ...(withholding.configurationNote ? { configurationNote: withholding.configurationNote } : {}),
  };
}

export const COUNTRY_WITHHOLDING_SCHEMES: Readonly<Record<string, CountryWithholdingScheme>> = Object.freeze(
  Object.fromEntries(allMarkets().map((market) => [market.code, legacyScheme(market.code) as CountryWithholdingScheme])),
);

export function findWithholdingScheme(countryCode: string | null | undefined): CountryWithholdingScheme | undefined {
  return COUNTRY_WITHHOLDING_SCHEMES[countryCode?.toUpperCase() ?? ''];
}

/**
 * The regimes that apply to a sale, given who is buying, who is selling and what is being sold —
 * at most one of each kind, the more specific rule winning (`applicableWithholdingRegimes`).
 */
export function applicableRegimes(
  scheme: CountryWithholdingScheme | undefined,
  context: { payer: TaxpayerType; payee: TaxpayerType; scope: Exclude<WithholdingScope, 'ANY'>; on: string },
): WithholdingRegime[] {
  return applicableWithholdingRegimes(scheme, context);
}
