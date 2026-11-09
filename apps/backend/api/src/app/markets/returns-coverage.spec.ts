import { coverageFor } from './queries/coverage';
import { marketCodes, marketFor } from './registry';

/**
 * What the declarations screen tells a company and what Settings › coverage declares must be the
 * same fact (audit 2026-11-07, FAC-CMP-03).
 *
 * The returns screen reads the country pack's `fiscalReturns.generator`: DGII files, SAT
 * electronic accounting, or none — and then it says, in the company's own country's name, that the
 * authority's files are not generated and lists the reports to prepare them with. Coverage is what
 * the market's `returns.ts` declares beside the generator. If they disagreed, one screen would
 * promise a filing the other says does not exist; this keeps them in step for every market.
 */
describe('fiscal returns: the screen and the coverage declare the same thing', () => {
  const markets = [...marketCodes()].sort();
  const level = (country: string, capability: string) =>
    coverageFor(country).capabilities.find((c) => c.capability === capability)?.level ?? 'not-implemented';

  it.each(markets)('%s', (country) => {
    const returns = marketFor(country).returns;
    // A generator the market has may still wait on the company (Mexico's grouping codes): it is
    // offered, so coverage may not call it missing.
    if (returns.generator === 'DGII') {
      expect(level(country, 'periodicReturns')).not.toBe('not-implemented');
    } else if (returns.generator === 'SAT') {
      expect(level(country, 'electronicAccounting')).not.toBe('not-implemented');
    } else {
      // No generator: nothing may claim one, and the screen has reports to point to instead.
      expect(returns.generator).toBeNull();
      expect(level(country, 'periodicReturns')).toBe('not-implemented');
      expect(returns.prepareWith.length).toBeGreaterThan(0);
    }
  });
});
