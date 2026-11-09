// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { valueAddedTax, withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, implemented } from '../kit/coverage';

/** Colombia: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.vat',
  principalTaxName: 'IVA',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('IVA 19%', 19),
      valueAddedTax('IVA 5%', 5),
      valueAddedTax('IVA Excluido 0%', 0),
    ],
  },
  withholding: withholdingConfiguredByTenant(
    'En Colombia la ReteFuente depende del concepto y de la calidad del beneficiario, la ReteIVA de si el pagador es agente de retención, y la ReteICA de la actividad y del municipio donde se realiza el hecho generador. Configura los conceptos y tarifas que apliquen a tu actividad y a los municipios donde tributas antes de facturar con retención.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: implemented('IVA 19 % / 5 % / excluido'),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
