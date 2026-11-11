import { allMarkets, marketFor, knownMarket } from './registry';
import { CHECKSUM_ALGORITHMS, IDENTITY_DOCUMENT_TYPES, validateTaxId } from './queries/identity';
import { coverageFor } from './queries/coverage';
import { ADJUSTMENT_REASONS, PAYMENT_SETTLEMENT_KINDS } from './contracts';

/**
 * The integrity of what the markets declare (docs/ARQUITECTURA_MERCADOS.md §2.7).
 *
 * `market-structure.spec.ts` checks that every market answers every question; this checks that the
 * answers are well-formed — the kind of mistake a reviewer reading one country's file cannot see,
 * because it only shows up beside the other eighteen.
 */
const markets = allMarkets();

describe('market catalogue', () => {
  describe.each(markets.map((m) => [m.code, m] as const))('%s', (code, market) => {
    it('has a well-formed profile', () => {
      const { profile } = market;
      expect(profile.currency).toMatch(/^[A-Z]{3}$/);
      // The locale names the market's own region: its formats and its wording patch follow it.
      expect(profile.locale).toMatch(new RegExp(`^[a-z]{2}-${code}$`));
      expect(profile.booksLanguage).toBe(profile.locale.slice(0, 2));
      expect(() => new Intl.DateTimeFormat('en', { timeZone: profile.timeZone })).not.toThrow();
      expect(profile.callingCode).toMatch(/^\d{1,4}$/);
      expect(profile.fiscalAuthority.trim()).not.toBe('');
      expect(profile.formats.thousandSeparator).not.toBe(profile.formats.decimalSeparator);
      for (const division of profile.address.divisions ?? []) expect(division.code.trim()).not.toBe('');
      if (profile.address.postalCodePattern && profile.examples.postalCode) {
        expect(profile.examples.postalCode).toMatch(new RegExp(profile.address.postalCodePattern));
      }
    });

    it('names its identity checks after itself, and cites only checks that exist', () => {
      const prefix = `${code.toLowerCase()}_`;
      for (const name of Object.keys(market.identity.checksums)) expect(name.startsWith(prefix)).toBe(true);
      for (const name of market.identity.structuralChecks) expect(Object.keys(market.identity.checksums)).toContain(name);
      for (const document of market.identity.documents) {
        for (const name of [document.checksum, ...Object.values(document.kindChecksums ?? {})]) {
          if (name) expect(CHECKSUM_ALGORITHMS[name]).toBeDefined();
        }
      }
      const codes = market.identity.documents.map((d) => d.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('accepts the example of every registration document it issues', () => {
      for (const document of market.identity.documents.filter((d) => d.usedFor.includes('registration') && d.example)) {
        expect(validateTaxId(code, document.example as string)).toBe(true);
      }
    });

    it('shows a document number its own rule accepts, or shows none', () => {
      // The sample of an import template and a form's placeholder. A market that publishes no shape
      // the product checks shows nothing: another market's number is not a sample of this one.
      const { example, check } = market.purchases.receivedDocument;
      if (example === undefined) return;
      expect(['ok', 'unverified']).toContain(check(example).status);
      expect(check(example).error).toBeNull();
    });

    it('declares taxes, rates and withholding that can be applied', () => {
      for (const tax of market.taxes.scheme.taxes) {
        expect(tax.rate).toBeGreaterThanOrEqual(0);
        expect(tax.rate).toBeLessThanOrEqual(100);
      }
      expect(market.taxes.principalTaxName.trim()).not.toBe('');
      expect(market.taxes.serviceChargeRate).toBeGreaterThanOrEqual(0);
      expect(market.taxes.serviceChargeRate).toBeLessThan(1);
      const { withholding } = market.taxes;
      if (!withholding.applies) expect(withholding.regimes).toHaveLength(0);
      if (withholding.configurationRequired) expect(withholding.configurationNote?.trim()).toBeTruthy();
      for (const regime of withholding.regimes) {
        expect(regime.rate).toBeGreaterThan(0);
        expect(regime.rate).toBeLessThanOrEqual(1);
        expect(regime.legalBasis.trim()).not.toBe('');
        if (regime.effectiveFrom && regime.effectiveTo) expect(regime.effectiveTo >= regime.effectiveFrom).toBe(true);
      }
    });

    it('declares document types once each', () => {
      const types = market.documents.types.map((t) => t.code);
      expect(new Set(types).size).toBe(types.length);
      if (!market.documents.fiscalNumbering) expect(market.documents.types).toHaveLength(0);
    });

    it('writes the authority\'s code for every reason a note can carry, or none at all', () => {
      const codes = market.documents.adjustmentCodes;
      // Nothing in between: a reason with no code is a note the regime cannot write, and a market
      // that writes none says so once rather than per reason.
      if (codes === null) return;
      for (const reason of ADJUSTMENT_REASONS) {
        expect([reason, codes[reason]?.trim()]).toEqual([reason, expect.stringMatching(/.+/)]);
      }
      // A code only means something to the authority that publishes it.
      expect(market.documents.fiscalNumbering || market.einvoicing.regime !== null).toBe(true);
    });

    it('starts companies with payment methods it can settle', () => {
      const methods = market.payments.defaults;
      expect(methods.length).toBeGreaterThan(0);
      expect(new Set(methods.map((m) => m.code)).size).toBe(methods.length);
      for (const method of methods) expect(PAYMENT_SETTLEMENT_KINDS).toContain(method.kind);
      // A catalogue the authority fixes is the authority's codes, every one of them.
      if (market.payments.catalogue === 'AUTHORITY_FIXED') {
        expect(market.payments.authority).toBeTruthy();
        for (const method of methods) expect(method.fiscalCode).toBe(method.code);
      }
    });

    it('calls an obligation the law does not impose «not applicable», and nothing else', () => {
      const level = (capability: string) => coverageFor(code).capabilities.find((line) => line.capability === capability)?.level;
      expect(level('electronicInvoicing') === 'not-applicable').toBe(!market.einvoicing.required);
      expect(level('withholding') === 'not-applicable').toBe(!market.taxes.withholding.applies);
      // Every market taxes sales, files returns and pays wages.
      for (const capability of ['accounting', 'taxDetermination', 'periodicReturns', 'payroll']) {
        expect([capability, level(capability)]).not.toEqual([capability, 'not-applicable']);
      }
    });

    it('says what the taxpayer must supply wherever coverage waits on them', () => {
      for (const line of coverageFor(code).capabilities) {
        if (line.level === 'needs-credentials' || line.level === 'needs-configuration') {
          expect(line.requires?.trim()).toBeTruthy();
        }
      }
    });
  });

  it('never lets two markets declare the same check', () => {
    const names = markets.flatMap((market) => Object.keys(market.identity.checksums));
    expect(new Set(names).size).toBe(names.length);
  });

  it('files every identity document under the market that issues it, or under XX', () => {
    const codes = new Set([...markets.map((m) => m.code), 'XX']);
    for (const document of IDENTITY_DOCUMENT_TYPES) expect(codes.has(document.countryCode)).toBe(true);
  });

  describe('a country the product is not sold in', () => {
    it.each(['ZZ', '', null])('answers %p with the neutral market, claiming nothing', (code) => {
      const market = marketFor(code);
      expect(knownMarket(code)).toBeNull();
      expect(market.profile).toBeNull();
      expect(market.identity.documents).toHaveLength(0);
      expect(market.documents.fiscalNumbering).toBe(false);
      expect(market.taxes.withholding.applies).toBe(false);
      expect(market.payments.catalogue).toBe('EDITABLE');
      expect(market.purchases.receivedDocument.kind).toBe('INVOICE_NUMBER');
    });
  });
});
