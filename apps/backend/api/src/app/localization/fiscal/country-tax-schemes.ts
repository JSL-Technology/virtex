import { TaxType } from '../../taxes/entities/tax.entity';

/**
 * The consumption taxes each market's tenants start with.
 *
 * Two things were wrong before this file existed. The seed created exactly one tax template, for
 * the Dominican Republic, with `type: 'VAT'` — and `taxes.type` is a Postgres enum whose only
 * values are `Porcentaje` and `Fijo`, so applying the fiscal package raised
 * `invalid input value for enum taxes_type_enum: "VAT"` and rolled the registration transaction
 * back. Every other market got no taxes at all, silently.
 *
 * `TaxType` describes HOW a tax is computed (a percentage or a fixed amount), which is not the
 * same question as WHAT the tax is. Conflating the two is what produced the enum error, so the
 * regime is carried separately in `regime` and never written to that column.
 *
 * On rates: only a country's headline national rate is seeded, because that is the only figure
 * that is unambiguous without knowing the tenant's regime, sector and location. Two markets have
 * no such figure and are deliberately seeded empty rather than given a plausible-looking default:
 *
 *   - United States — sales tax is levied by state, county and city, is destination-based, and
 *     has no federal component. Any single number would be wrong everywhere.
 *   - Brazil — ICMS is per-state, ISS per-municipality, and PIS/COFINS rates depend on whether
 *     the taxpayer is under the cumulative or non-cumulative regime.
 *
 * `configurationRequired` marks those, so onboarding can ask instead of the product quietly
 * shipping a wrong rate. A zero-rate placeholder would have been worse than nothing: it looks
 * configured.
 *
 * Every rate here is the standard national rate in force for the country's principal consumption
 * tax. They are seeded as the tenant's starting point and are editable per tenant, because rates
 * change by decree and a tenant's accountant is the authority on their own filings.
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
  /**
   * True when the country's tax base cannot be expressed as a national rate and the tenant must
   * configure it during onboarding.
   */
  configurationRequired: boolean;
  /** Shown to the tenant when `configurationRequired`; explains precisely what is missing. */
  configurationNote?: string;
}

const vat = (name: string, rate: number): CountryTax => ({
  name,
  rate,
  computation: TaxType.PERCENTAGE,
  regime: 'VAT',
});

export const COUNTRY_TAX_SCHEMES: Readonly<Record<string, CountryTaxScheme>> = {
  // The reduced 16 % rate is the one the DGII's own ITBIS2 bucket exists for (Ley 253-12 art. 23:
  // yoghurt, butter, coffee, edible fats, sugars, cocoa and chocolate). Listing only 18 % and 0 %
  // meant the server rejected a line the e-CF builder already knew how to transmit — the tax
  // validator and the comprobante generator disagreed about the same regime.
  DO: {
    configurationRequired: false,
    taxes: [
      vat('ITBIS 18%', 18),
      vat('ITBIS Tasa Reducida 16%', 16),
      vat('ITBIS Exento 0%', 0),
    ],
  },

  US: {
    configurationRequired: true,
    configurationNote:
      'El impuesto sobre las ventas en Estados Unidos lo fijan el estado, el condado y la ciudad de destino; no existe una tasa federal. Configura las jurisdicciones donde tienes nexo antes de facturar. Puerto Rico no es una jurisdicción estatal más: su IVU es un régimen propio que se declara ante Hacienda de Puerto Rico (SURI), con su propia tasa estatal y municipal.',
    taxes: [],
  },

  MX: {
    configurationRequired: false,
    taxes: [vat('IVA 16%', 16), vat('IVA Región Fronteriza 8%', 8), vat('IVA Tasa 0%', 0)],
  },

  CO: {
    configurationRequired: false,
    taxes: [vat('IVA 19%', 19), vat('IVA 5%', 5), vat('IVA Excluido 0%', 0)],
  },

  CL: { configurationRequired: false, taxes: [vat('IVA 19%', 19), vat('Exento 0%', 0)] },

  PE: { configurationRequired: false, taxes: [vat('IGV 18%', 18), vat('Exonerado 0%', 0)] },

  AR: {
    configurationRequired: false,
    taxes: [
      vat('IVA 21%', 21),
      vat('IVA 10,5%', 10.5),
      vat('IVA 27%', 27),
      vat('IVA Exento 0%', 0),
    ],
  },

  BR: {
    configurationRequired: true,
    configurationNote:
      'No Brasil o ICMS é estadual, o ISS é municipal e as alíquotas de PIS/COFINS dependem do regime (cumulativo ou não-cumulativo). Configure os tributos conforme o regime e a localização da empresa antes de emitir notas.',
    taxes: [],
  },

  EC: { configurationRequired: false, taxes: [vat('IVA 15%', 15), vat('IVA 0%', 0)] },

  UY: {
    configurationRequired: false,
    taxes: [vat('IVA Básico 22%', 22), vat('IVA Mínimo 10%', 10), vat('Exento 0%', 0)],
  },

  PY: {
    configurationRequired: false,
    taxes: [vat('IVA 10%', 10), vat('IVA 5%', 5), vat('Exento 0%', 0)],
  },

  BO: { configurationRequired: false, taxes: [vat('IVA 13%', 13), vat('Exento 0%', 0)] },

  VE: { configurationRequired: false, taxes: [vat('IVA 16%', 16), vat('Exento 0%', 0)] },

  PA: { configurationRequired: false, taxes: [vat('ITBMS 7%', 7), vat('Exento 0%', 0)] },

  CR: { configurationRequired: false, taxes: [vat('IVA 13%', 13), vat('Exento 0%', 0)] },

  GT: { configurationRequired: false, taxes: [vat('IVA 12%', 12), vat('Exento 0%', 0)] },

  SV: { configurationRequired: false, taxes: [vat('IVA 13%', 13), vat('Exento 0%', 0)] },

  HN: { configurationRequired: false, taxes: [vat('ISV 15%', 15), vat('Exento 0%', 0)] },

  NI: { configurationRequired: false, taxes: [vat('IVA 15%', 15), vat('Exento 0%', 0)] },
};

export function findTaxScheme(countryCode: string): CountryTaxScheme | undefined {
  return COUNTRY_TAX_SCHEMES[countryCode?.toUpperCase() ?? ''];
}

/** The name of the country's principal consumption tax, for naming ledger accounts. */
export function principalTaxName(countryCode: string): string {
  const first = findTaxScheme(countryCode)?.taxes[0]?.name;
  if (!first) return countryCode?.toUpperCase() === 'US' ? 'Sales Tax' : 'Impuesto';
  // 'ITBIS 18%' -> 'ITBIS'; 'IVA Básico 22%' -> 'IVA Básico'
  return first.replace(/\s*\d+([.,]\d+)?%\s*$/, '').trim();
}
