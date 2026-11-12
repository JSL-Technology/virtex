import type { MarketAccounting } from './accounting';
import type { MarketDocuments } from './documents';
import type { MarketEInvoicing } from './einvoicing';
import type { MarketIdentity } from './identity';
import type { MarketPayments } from './payments';
import type { MarketPayroll } from './payroll';
import type { MarketProfile } from './profile';
import type { MarketPurchases } from './purchases';
import type { MarketReturns } from './returns';
import type { MarketTaxes } from './taxes';

/**
 * Everything a market declares about itself (docs/ARQUITECTURA_MERCADOS.md).
 *
 * One member per capability, each answered by the file of the same name in `markets/<cc>/`. The
 * core reads a market through this shape and never by its name: a screen asks whether the market
 * withholds at source, an engine asks which document types it issues, provisioning asks which
 * payment methods a company starts with — and none of them names a country.
 *
 * A capability the product does not implement for a market is still answered: «not applicable» and
 * «not implemented» are answers; an absent one is not.
 */
export interface MarketDefinition {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly code: string;
  readonly profile: MarketProfile;
  readonly identity: MarketIdentity;
  readonly taxes: MarketTaxes;
  readonly documents: MarketDocuments;
  readonly purchases: MarketPurchases;
  readonly payments: MarketPayments;
  readonly accounting: MarketAccounting;
  readonly payroll: MarketPayroll;
  readonly returns: MarketReturns;
  readonly einvoicing: MarketEInvoicing;
}

/**
 * The capabilities, in the order a market's folder lists them. Each is a file of that name in every
 * `markets/<cc>/`, which `market-structure.spec.ts` asserts.
 */
export const MARKET_CAPABILITIES = [
  'profile',
  'identity',
  'taxes',
  'documents',
  'purchases',
  'payments',
  'accounting',
  'payroll',
  'returns',
  'einvoicing',
] as const satisfies ReadonlyArray<Exclude<keyof MarketDefinition, 'code'>>;
