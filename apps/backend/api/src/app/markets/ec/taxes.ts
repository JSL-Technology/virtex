// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, implemented } from '../kit/coverage';

/** Ecuador: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IVA',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IVA 15%', 15),
      valueAddedTax('IVA 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'En Ecuador la retención en la fuente de IVA y de Renta depende del tipo de contribuyente del agente de retención y del bien o servicio. Configura los porcentajes vigentes conforme al SRI.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: implemented('IVA 15 % / 0 %; sin detracciones, percepciones ni retenciones especiales'),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
