// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAccounting } from '../contracts';
import { officialRateFeed } from './accounting/official-rates';

/**
 * SAT «código agrupador» (Anexo 24), at the first level of the catalogue, for the accounts of the
 * neutral plan. The first level is the one this product can assign without knowing the company's
 * operations (national or foreign customers, rate of the sale); the accountant refines a subaccount
 * where the company needs the second level. Verificar con contador local.
 */
const GROUPING_CODES: Readonly<Record<string, string>> = {
  '1000': '100',
  '1110': '101',
  '1120': '102',
  '1130': '105',
  '1140': '115',
  '1150': '118',
  '1155': '113',
  '1160': '109',
  '2000': '200',
  '2110': '201',
  '2120': '205',
  '2130': '208',
  '2135': '216',
  '2140': '210',
  '2141': '211',
  '2142': '211',
  '2143': '211',
  '2144': '216',
  '2150': '213',
  '2165': '213',
  '2170': '206',
  '3000': '300',
  '3100': '301',
  '3300': '304',
  '3400': '305',
  '4000': '400',
  '4100': '401',
  '4200': '401',
  '4300': '402',
  '4900': '403',
  '5000': '500',
  '5100': '501',
  '5200': '601',
  '5250': '601',
  '5300': '601',
  '5400': '601',
  '5600': '601',
  '5700': '701',
  '5750': '701',
};

/**
 * Mexico: what the market adds to the neutral starting plan. Every name is a starting point a local
 * accountant confirms: it names the institution an account is remitted to, which is a legal fact of
 * the country.
 */
export const accounting: MarketAccounting = {
  statutoryPlanRequired: null,
  segments: null,
  payrollAccounts: {
    pension: 'Aportaciones SAR (Retiro, Cesantía y Vejez) por Pagar',
    health: 'Cuotas IMSS por Pagar',
    otherContributions: 'Aportaciones INFONAVIT por Pagar',
    incomeTaxWithheld: 'ISR Retenido por Sueldos y Salarios por Pagar',
    employerContributions: 'Cuotas Patronales IMSS, SAR e INFONAVIT',
  },
  exciseTaxAccount: 'IEPS por Pagar',
  serviceChargeAccount: null,
  fiscalGroupingCodes: GROUPING_CODES,
  exclusiveTerms: [/IMSS/, /INFONAVIT/, /\bSAR\b/, /IEPS/],
  inflationAccounting: null,
  officialExchangeRates: {
    publisher: 'Banco de México',
    quoteCurrency: 'MXN',
    legalBasis: 'Tipo de cambio FIX que el Banco de México publica en el DOF; las contribuciones se convierten al publicado el día anterior (CFF art. 20).',
    feed: officialRateFeed,
  },
  // LISR, art. 34: the maximum yearly percentage on the original investment, straight line. A
  // starting point — verificar con contador local (art. 35 fixes machinery by activity).
  taxDepreciation: {
    authority: 'SAT',
    categories: [
      { code: 'MX-34-I', nameKey: 'fixed_assets.tax_categories.mx_34_i', method: 'STRAIGHT_LINE', annualRate: 0.05, legalBasis: 'LISR, art. 34, fracción I, inciso b' },
      { code: 'MX-34-III', nameKey: 'fixed_assets.tax_categories.mx_34_iii', method: 'STRAIGHT_LINE', annualRate: 0.1, legalBasis: 'LISR, art. 34, fracción III' },
      { code: 'MX-34-VI', nameKey: 'fixed_assets.tax_categories.mx_34_vi', method: 'STRAIGHT_LINE', annualRate: 0.25, legalBasis: 'LISR, art. 34, fracción VI' },
      { code: 'MX-34-VII', nameKey: 'fixed_assets.tax_categories.mx_34_vii', method: 'STRAIGHT_LINE', annualRate: 0.3, legalBasis: 'LISR, art. 34, fracción VII' },
      { code: 'MX-34-VIII', nameKey: 'fixed_assets.tax_categories.mx_34_viii', method: 'STRAIGHT_LINE', annualRate: 0.35, legalBasis: 'LISR, art. 34, fracción VIII' },
    ],
    caveat: 'fixed_assets.tax_categories.mx_caveat',
  },
};
