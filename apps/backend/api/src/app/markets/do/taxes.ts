// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes, MarketWithholding } from '../contracts';
import { valueAddedTax } from '../kit/taxes';
import { implemented } from '../kit/coverage';

/**
 * The four regimes below are the ones that arise on an ordinary sales invoice. Withholding on
 * dividends, on payments abroad, and the rates that apply to specific professions are not here:
 * they are not sales-invoice events, and inventing entries for them would put rates in front of a
 * user for transactions this document cannot represent.
 */
const WITHHOLDING: MarketWithholding = {
  applies: true,
  configurationRequired: false,
  regimes: [
    {
      code: 'DO-ITBIS-100-PF',
      kind: 'VAT',
      rate: 1,
      payers: ['COMPANY', 'WITHHOLDING_AGENT'],
      payees: ['INDIVIDUAL'],
      scope: 'SERVICES',
      label: 'ITBIS retenido 100 % — servicios prestados por persona física',
      legalBasis: 'Norma General 02-05, art. 2 (DGII)',
      effectiveFrom: '2005-01-01',
      effectiveTo: null,
    },
    {
      code: 'DO-ITBIS-30-ESTADO',
      kind: 'VAT',
      rate: 0.3,
      payers: ['GOVERNMENT'],
      scope: 'ANY',
      label: 'ITBIS retenido 30 % — pagos del Estado a proveedores',
      legalBasis: 'Ley 253-12, art. 25; Norma General 07-09 (DGII)',
      effectiveFrom: '2013-01-01',
      effectiveTo: null,
    },
    {
      code: 'DO-ISR-10-SERV-PF',
      kind: 'INCOME',
      rate: 0.1,
      payers: ['COMPANY', 'WITHHOLDING_AGENT', 'GOVERNMENT'],
      payees: ['INDIVIDUAL'],
      scope: 'SERVICES',
      label: 'ISR retenido 10 % — honorarios y servicios de persona física',
      legalBasis: 'Ley 11-92 (Código Tributario), art. 309',
      effectiveFrom: '1992-05-16',
      effectiveTo: null,
    },
    {
      code: 'DO-ISR-5-ESTADO',
      kind: 'INCOME',
      rate: 0.05,
      payers: ['GOVERNMENT'],
      payees: ['COMPANY', 'WITHHOLDING_AGENT'],
      scope: 'ANY',
      label: 'ISR retenido 5 % — pagos del Estado a personas jurídicas',
      legalBasis: 'Ley 11-92, art. 309, párrafo; Ley 253-12',
      effectiveFrom: '2013-01-01',
      effectiveTo: null,
    },
  ],
};

/** Dominican Republic: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'NATIONAL_RATES',
  nameKey: 'localization.country_pack.tax_name.itbis',
  principalTaxName: 'ITBIS',
  scheme: {
    configurationRequired: false,
    taxes: [
      valueAddedTax('ITBIS 18%', 18),
      valueAddedTax('ITBIS Tasa Reducida 16%', 16),
      valueAddedTax('ITBIS Exento 0%', 0),
    ],
  },
  withholding: WITHHOLDING,
  serviceChargeRate: 0.1,
  coverage: {
    taxDetermination: implemented('ITBIS 18 % / 16 % / exento'),
    withholding: implemented('ITBIS e ISR retenidos, Norma 02-05 y Ley 11-92'),
  },
};
