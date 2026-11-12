import { coverageFor } from './queries/coverage';
import { marketCodes, marketFor } from './registry';

/**
 * What the declarations screen offers and what Settings › coverage declares must be the same fact
 * (audit 2026-11-07, FAC-CMP-03).
 *
 * The screen offers exactly what the market declares it files (`returns.filings`); coverage is what
 * the same package says beside it. If they disagreed, one screen would promise a filing the other
 * says does not exist — and a market with files to produce and nothing to produce them with is the
 * same defect from the other side.
 */
describe('fiscal returns: the screen and the coverage declare the same thing', () => {
  const markets = [...marketCodes()].sort();
  const level = (country: string, capability: string) =>
    coverageFor(country).capabilities.find((c) => c.capability === capability)?.level ?? 'not-implemented';

  it.each(markets)('%s', (country) => {
    const returns = marketFor(country).returns;

    // A generator is the name the client knows the files under: it exists exactly where files do.
    expect([country, returns.generator !== null]).toEqual([country, returns.filings.length > 0]);

    if (returns.filings.length === 0) {
      // Nothing may claim a filing, and the screen has reports to point to instead.
      expect(level(country, 'periodicReturns')).toBe('not-implemented');
      expect(returns.prepareWith.length).toBeGreaterThan(0);
      return;
    }

    // Files to produce: a capability that is offered may not be called missing — a generator the
    // market has may still wait on the company (Mexico's grouping codes), which is a level of its
    // own, not an absence.
    const capability = returns.filings.some((filing) => filing.code === 'balanza')
      ? 'electronicAccounting'
      : 'periodicReturns';
    expect(level(country, capability)).not.toBe('not-implemented');

    for (const filing of returns.filings) {
      expect(filing.code).toMatch(/^[A-Za-z0-9_-]{1,16}$/);
      expect(filing.labelKey.startsWith(`returns.${country.toLowerCase()}.`)).toBe(true);
      expect(filing.mediaType).toMatch(/^[a-z]+\/[a-z+-]+/);
      expect(filing.extension).toMatch(/^[a-z]{2,4}$/);
      // An option is checked against its own declaration before anything is built, so a choice
      // without values would accept nothing at all.
      for (const option of filing.options ?? []) {
        expect(option.labelKey.startsWith(`returns.${country.toLowerCase()}.`)).toBe(true);
        if (option.kind === 'CHOICE') expect((option.values ?? []).length).toBeGreaterThan(0);
      }
    }

    // Two filings of one market never share a code: the door resolves one by it.
    const codes = returns.filings.map((filing) => filing.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
