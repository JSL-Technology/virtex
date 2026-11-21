import type { EntityManager } from 'typeorm';

/** A stretch of a tenant's authorised numbering: one document type, one series, inclusive bounds. */
export interface FiscalNumberStretch {
  organizationId: string;
  /** The authority's document-type code the numbers were drawn as. */
  documentType: string;
  /** The range's series, `''` where the market numbers without one. */
  series: string;
  from: number;
  to: number;
}

/**
 * A kind of document that carries numbers drawn from the tenant's authorised ranges — an invoice,
 * a till receipt — and can say how many of a stretch it already holds.
 *
 * Asked before a range is registered. A range whose numbers are already on documents was issued
 * under a state the range table no longer reflects (re-entered after a failed attempt, registered
 * twice under different series), and registering it would hand those numbers out a second time —
 * a duplicated fiscal number, which every authority treats as an offence, not as a typo. Each owner
 * answers for its own table, from the consecutive and series it recorded when the number was drawn
 * (`fiscal_sequence`, `fiscal_series`), never by parsing the formatted number.
 */
export interface IssuedFiscalNumbersSource {
  /** Stable and unique: a second source under the same name is a wiring mistake. */
  readonly sourceName: string;
  /** How many of this source's documents carry a number within the stretch. */
  countWithin(manager: EntityManager, stretch: FiscalNumberStretch): Promise<number>;
}
