// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { needsConfiguration, notApplicable } from '../kit/coverage';

/** United States: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'BY_JURISDICTION',
  nameKey: 'localization.country_pack.tax_name.sales_tax',
  principalTaxName: 'Sales Tax',
  scheme: {
    configurationRequired: true,
    noRegistrationMeansNoTax: true,
    configurationNote:
      'El impuesto sobre las ventas en Estados Unidos lo fijan el estado, el condado y la ciudad de destino; no existe una tasa federal. Configura las jurisdicciones donde tienes nexo antes de facturar. Puerto Rico no es una jurisdicción estatal más: su IVU es un régimen propio que se declara ante Hacienda de Puerto Rico (SURI), con su propia tasa estatal y municipal.',
    taxes: [],
  },
  withholding: {
    applies: false,
    regimes: [],
    configurationRequired: true,
    configurationNote:
      'United States sales invoices do not carry withholding; backup withholding and non-resident withholding are payment-level obligations reported on Forms 1099 and 1042-S, not on the invoice. Nothing is withheld automatically.',
  },
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: needsConfiguration(
      'Sales tax por jurisdicción, con sourcing origen/destino y nexo',
      'las jurisdicciones donde está registrado, en Ajustes → Impuestos',
    ),
    // Backup and non-resident withholding are payment-level obligations (Forms 1099, 1042-S), never
    // a line of the sales invoice.
    withholding: notApplicable(),
  },
};
