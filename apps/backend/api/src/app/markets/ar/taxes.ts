// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, implemented } from '../kit/coverage';

/** Argentina: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IVA',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IVA 21%', 21),
      valueAddedTax('IVA 10,5%', 10.5),
      valueAddedTax('IVA 27%', 27),
      valueAddedTax('IVA Exento 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'En Argentina las retenciones de IVA y de Ganancias dependen del régimen en que la AFIP inscribió al pagador y de la condición del beneficiario, y las percepciones de Ingresos Brutos dependen de la jurisdicción. Configura los regímenes en los que estés designado.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: implemented('IVA 21 % / 10,5 % / 27 %; sin detracciones, percepciones ni retenciones especiales'),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
