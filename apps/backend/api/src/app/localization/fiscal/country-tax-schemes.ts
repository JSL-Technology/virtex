import { TaxType } from '../../taxes/entities/tax.entity';
import { allMarkets, principalTaxName as marketPrincipalTaxName, type MarketTaxScheme } from '../../markets';

/**
 * The consumption taxes each market's tenants start with, in the shape the taxes module seeds from.
 *
 * Each market declares its taxes in `markets/<cc>/taxes.ts`; this view adds the one thing that is the
 * taxes module's own — `TaxType`, how a tax is computed, as the enum `taxes.type` stores — and goes
 * away as the seeders read `taxSchemeFor(cc)` directly.
 */
export interface CountryTax {
  /** Shown in the tenant's tax list, in the country's own terminology. */
  name: string;
  /** Percentage points. `18` means 18%. */
  rate: number;
  /** How the tax is computed — the value actually stored in `taxes.type`. */
  computation: TaxType;
  /** What the tax is: VAT, sales tax, excise. Descriptive; never written to the enum column. */
  regime: string;
}

export interface CountryTaxScheme {
  taxes: CountryTax[];
  configurationRequired: boolean;
  configurationNote?: string;
  noRegistrationMeansNoTax?: boolean;
}

function legacyScheme(scheme: MarketTaxScheme): CountryTaxScheme {
  return {
    configurationRequired: scheme.configurationRequired,
    ...(scheme.noRegistrationMeansNoTax ? { noRegistrationMeansNoTax: true } : {}),
    ...(scheme.configurationNote ? { configurationNote: scheme.configurationNote } : {}),
    taxes: scheme.taxes.map((tax) => ({
      name: tax.name,
      rate: tax.rate,
      computation: tax.computation === 'FIXED' ? TaxType.FIXED : TaxType.PERCENTAGE,
      regime: tax.regime,
    })),
  };
}

export const COUNTRY_TAX_SCHEMES: Readonly<Record<string, CountryTaxScheme>> = Object.freeze(
  Object.fromEntries(allMarkets().map((market) => [market.code, legacyScheme(market.taxes.scheme)])),
);

export function findTaxScheme(countryCode: string): CountryTaxScheme | undefined {
  return COUNTRY_TAX_SCHEMES[countryCode?.toUpperCase() ?? ''];
}

/** The name of the country's principal consumption tax, for naming ledger accounts. */
export function principalTaxName(countryCode: string): string {
  return marketPrincipalTaxName(countryCode);
}
