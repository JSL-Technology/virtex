import type { CapabilityCoverage } from './coverage';

/**
 * The periodic returns a market's authority requires, and how the product helps file them.
 */

/** A report a tenant can prepare its returns with, where the product generates no file for them. */
export interface ReturnPreparationReport {
  /** Catalogue key of the report's name. */
  labelKey: string;
  /** Absolute application route (pages mount in tabs, so links must be absolute). */
  route: string;
}

export interface MarketReturns {
  /**
   * The return generator the product has for the market, by the name the client knows it under,
   * or null where it produces no return files there.
   */
  generator: string | null;
  /** Day of the following month a monthly return falls due, where the product knows it. */
  dueDay: number | null;
  /** The reports to prepare the returns with where there is no generator. */
  prepareWith: readonly ReturnPreparationReport[];
  /**
   * The periodic filings the authority requires, by their official name. Only populated where the
   * obligation is named and specific; an empty list means "not modelled", never "none".
   */
  obligations: readonly string[];
  /** What the product generates and what it does not, as coverage lines. */
  coverage: readonly CapabilityCoverage[];
}
