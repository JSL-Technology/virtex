import { roundAmount } from '../common/money';

/**
 * The arithmetic of the full consolidation method, separated from the database so it can be
 * checked against a worked example (audit 2026-11-07, FINB-30).
 *
 * The previous engine pushed an informative "elimination" into a list and left both halves in the
 * totals: the parent's investment stayed among the assets, the subsidiary's pre-acquisition equity
 * stayed in equity, goodwill was ADDED on top, and the statement "balanced" only because equity was
 * computed as assets minus liabilities. Assets were overstated by the investment plus the goodwill.
 *
 * Here, per subsidiary (NIIF 10.B86, NIIF 3.32, NIC 21.47; non-controlling interest measured at its
 * proportionate share of net assets, NIIF 3.19(b)):
 *
 *   - the parent's investment is removed from assets;
 *   - the subsidiary's equity is removed and replaced by what it is to the group:
 *       · the parent's share of the equity at acquisition, which offsets the investment;
 *       · the parent's share of what was earned after acquisition (group reserves);
 *       · the parent's share of the translation difference (other comprehensive income);
 *       · the non-controlling interest: the outside share of the whole equity;
 *   - goodwill = cost − parent's share of net assets at acquisition, kept in the subsidiary's
 *     functional currency and translated at the closing rate (NIC 21.47); its own translation
 *     difference goes to the translation reserve;
 *   - a negative difference is a bargain purchase: no goodwill, a gain for the parent (NIIF 3.34).
 *
 * Every figure below is in the presentation currency unless its name says `functional`.
 */
export interface SubsidiaryEquityInput {
  /** Fraction owned by the parent, 0–1. */
  parentShare: number;
  /** Net assets at the acquisition date, in the subsidiary's functional currency. */
  equityAtAcquisitionFunctional: number;
  /** Net assets at the reporting date, in the functional currency. */
  equityFunctional: number;
  /** Net assets at the reporting date, translated (assets and liabilities at closing). */
  equityPresented: number;
  /** Rate on the acquisition date (functional → presentation). */
  historicalRate: number;
  /** Rate at the reporting date. */
  closingRate: number;
  /**
   * Average rate between the acquisition and the reporting date: what the post-acquisition
   * results are taken to have been earned at (NIC 21.40 permits an average for that purpose).
   */
  averageSinceAcquisitionRate: number;
  /** What the parent paid, in the presentation currency; `null` when it was not recorded. */
  acquisitionCost: number | null;
}

export interface SubsidiaryEquityResult {
  /** Parent's share of equity at acquisition, translated at the historical rate. */
  parentShareAtAcquisition: number;
  /** Parent's share of the post-acquisition change, at the average since acquisition. */
  parentPostAcquisition: number;
  /** Parent's share of the subsidiary's translation difference. */
  parentTranslation: number;
  /** The outside share of the subsidiary's whole equity. */
  nonControlling: number;
  /** Goodwill at the closing rate (0 for a bargain purchase or an unknown cost). */
  goodwill: number;
  /** The translation difference on goodwill itself. */
  goodwillTranslation: number;
  /** A bargain purchase gain (NIIF 3.34), or 0. */
  bargainPurchaseGain: number;
  /** The parent's investment, to remove from assets; 0 when no cost was recorded. */
  investmentEliminated: number;
  /**
   * The parent's share of equity at acquisition that could NOT be eliminated because no cost was
   * recorded. It stays in group equity, and the statements say so.
   */
  uneliminatedPreAcquisition: number;
}

export function splitSubsidiaryEquity(input: SubsidiaryEquityInput): SubsidiaryEquityResult {
  const share = Math.min(1, Math.max(0, input.parentShare));
  const atAcquisitionPresented = roundAmount(input.equityAtAcquisitionFunctional * input.historicalRate);
  const parentShareAtAcquisition = roundAmount(share * atAcquisitionPresented);
  const changeFunctional = input.equityFunctional - input.equityAtAcquisitionFunctional;
  const changePresented = roundAmount(changeFunctional * input.averageSinceAcquisitionRate);
  const parentPostAcquisition = roundAmount(share * changePresented);
  const nonControlling = roundAmount((1 - share) * input.equityPresented);
  // Whatever of the parent's share is neither the acquisition-date equity nor the result earned
  // since: the effect of translating at the closing rate what was measured at other rates.
  const parentTranslation = roundAmount(
    input.equityPresented - nonControlling - parentShareAtAcquisition - parentPostAcquisition,
  );

  if (input.acquisitionCost === null) {
    return {
      parentShareAtAcquisition,
      parentPostAcquisition,
      parentTranslation,
      nonControlling,
      goodwill: 0,
      goodwillTranslation: 0,
      bargainPurchaseGain: 0,
      investmentEliminated: 0,
      uneliminatedPreAcquisition: parentShareAtAcquisition,
    };
  }

  const cost = roundAmount(input.acquisitionCost);
  const differenceAtHistorical = roundAmount(cost - parentShareAtAcquisition);
  if (differenceAtHistorical < 0) {
    return {
      parentShareAtAcquisition,
      parentPostAcquisition,
      parentTranslation,
      nonControlling,
      goodwill: 0,
      goodwillTranslation: 0,
      bargainPurchaseGain: roundAmount(-differenceAtHistorical),
      investmentEliminated: cost,
      uneliminatedPreAcquisition: 0,
    };
  }

  // NIC 21.47: goodwill is an asset of the foreign operation, in its functional currency.
  const goodwillFunctional = input.historicalRate > 0 ? differenceAtHistorical / input.historicalRate : 0;
  const goodwill = roundAmount(goodwillFunctional * input.closingRate);
  return {
    parentShareAtAcquisition,
    parentPostAcquisition,
    parentTranslation,
    nonControlling,
    goodwill,
    goodwillTranslation: roundAmount(goodwill - differenceAtHistorical),
    bargainPurchaseGain: 0,
    investmentEliminated: cost,
    uneliminatedPreAcquisition: 0,
  };
}
