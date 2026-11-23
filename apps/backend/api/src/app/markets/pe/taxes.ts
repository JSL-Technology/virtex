// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, implemented } from '../kit/coverage';

/** Peru: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IGV',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IGV 18%', 18),
      valueAddedTax('Exonerado 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'En Perú el régimen de retenciones del IGV aplica sólo a los agentes de retención designados por la SUNAT, y las detracciones dependen del bien o servicio y de su código en el Anexo correspondiente. Configura los regímenes que la SUNAT te haya designado.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: implemented('IGV 18 % / exonerado; sin detracciones, percepciones ni retenciones especiales'),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
