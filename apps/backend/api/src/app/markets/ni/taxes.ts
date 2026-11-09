// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { notImplemented } from '../kit/coverage';

/** Nicaragua: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IVA',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IVA 15%', 15),
      valueAddedTax('Exento 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'Configura los regímenes de retención que te correspondan y sus tarifas vigentes antes de facturar con retención. Mientras no lo hagas, no se retiene nada automáticamente.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: notImplemented(),
    withholding: notImplemented(),
  },
};
