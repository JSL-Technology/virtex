/**
 * Determining a sales tax rate from where the sale happens.
 *
 * ## Why this exists as a port and not a table lookup
 *
 * The United States has no national sales tax and no national rate. What a buyer pays is the sum
 * of a state rate, a county rate, a city rate and any special-district rate at the address the
 * goods are delivered to — and which of those apply depends on the state's sourcing rule, on
 * whether the seller has nexus there, and on whether the item or the buyer is exempt. Brazil is
 * differently but equally sub-national.
 *
 * `COUNTRY_TAX_SCHEMES` marks both `configurationRequired`, and `allowedTaxFractions` returned
 * null for them — so the rate came off the request with nothing checking it. That is not a missing
 * feature; it is a product sold in the United States charging whatever number reached the API.
 *
 * Two implementations are meaningful, which is why this is an interface:
 *
 * 1. The tenant's own registered jurisdictions, held in `tax_jurisdictions`. Correct and
 *    sufficient for a business with nexus in a handful of states, which is most of them, and it
 *    works from the first day with no third party involved.
 * 2. A determination provider — Avalara, Vertex, TaxJar — for a tenant whose footprint outgrows
 *    that. Building a rate table for twelve thousand jurisdictions in-house is not defensible.
 */

export interface TaxDeterminationAddress {
  countryCode: string;
  /** First-level division code: `TX`, `CA`, `SP`. */
  stateCode?: string | null;
  county?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

export interface TaxDeterminationRequest {
  organizationId: string;
  /** Where the goods or services are delivered. Decides the rate in a destination-sourced state. */
  destination: TaxDeterminationAddress;
  /** Where the seller is. Decides the rate in an origin-sourced state, for an intrastate sale. */
  origin?: TaxDeterminationAddress | null;
  /** The date the rate is read as of: the document's, never today's. */
  asOf: string;
}

/** One jurisdiction's share of the rate, named so the return can be filed. */
export interface TaxRateComponent {
  level: string;
  name: string;
  rate: number;
}

export interface TaxDetermination {
  /** The total rate to charge, as a fraction. Zero where there is no obligation. */
  rate: number;
  components: TaxRateComponent[];
  /**
   * Why the rate is what it is, in a form a person can act on.
   *
   * `NO_NEXUS` is not an error: a seller with no registration in the destination state does not
   * collect there, and the document should say so rather than imply the sale was tax-free for some
   * other reason. `NOT_DETERMINABLE` is: the address is not specific enough to price, and issuing
   * would be guessing.
   */
  outcome: 'DETERMINED' | 'NO_NEXUS' | 'NOT_DETERMINABLE';
  /** What is missing, when the outcome is not `DETERMINED`. A key, for the reader's language. */
  reasonKey?: string;
  reasonParams?: Record<string, unknown>;
  /** Which implementation answered, recorded on the document so a return can be traced to it. */
  source: string;
}

/** What any determination implementation must answer. */
export interface TaxDeterminationProvider {
  /** Stable identifier recorded on the document: `tenant-jurisdictions`, `avalara`. */
  readonly source: string;
  /** Whether this provider can answer for a country at all. */
  supports(countryCode: string): boolean;
  determine(request: TaxDeterminationRequest): Promise<TaxDetermination>;
}

/** DI token for the ordered list of providers. The first that supports a country answers. */
export const TAX_DETERMINATION_PROVIDERS = Symbol('TAX_DETERMINATION_PROVIDERS');
