// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, implemented } from '../kit/coverage';

/** Mexico: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IVA',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IVA 16%', 16),
      valueAddedTax('IVA Región Fronteriza 8%', 8),
      valueAddedTax('IVA Tasa 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'En México la retención de IVA e ISR depende del tipo de servicio (honorarios, arrendamiento, autotransporte, servicios profesionales) y de si el receptor es persona moral. El CFDI exige declarar cada retención con su impuesto y su base. Configura los supuestos que apliquen a tus operaciones.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: implemented('IVA 16 % / 8 % frontera / 0 %'),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
