// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, implemented } from '../kit/coverage';

/** Chile: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IVA',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IVA 19%', 19),
      valueAddedTax('Exento 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'En Chile la retención aplica a las boletas de honorarios y a los cambios de sujeto que el SII establece por resolución para determinados productos. Configura los que te apliquen.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: implemented('IVA 19 % / exento; sin detracciones, percepciones ni retenciones especiales'),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
