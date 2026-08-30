import { SAAS_PLANS, minorUnitFactor } from './saas.config';
import { SaasResource } from './enums/saas-resource.enum';
import { SaasService } from './saas.service';

/**
 * Every plan prices every metered resource.
 *
 * `enforceLimit` used to return early when a plan had no `PlanLimit` row for the resource it was
 * asked about, which made "missing from the plan" mean "unlimited on that plan" — silently, and
 * for exactly the resources somebody had just added to the enum. It now refuses instead, so a gap
 * here is a broken tenant rather than a free tier nobody chose. This suite catches the gap first.
 */
describe('SaaS plan entitlements', () => {
  const resources = Object.values(SaasResource);

  it('offers three tiers', () => {
    expect(SAAS_PLANS.map((p) => p.slug)).toEqual(['starter', 'pro', 'enterprise']);
  });

  describe.each(SAAS_PLANS)('$slug', (plan) => {
    it('declares a limit for every metered resource', () => {
      const declared = plan.limits.map((l) => l.resource).sort();
      expect(declared).toEqual([...resources].sort());
    });

    it('declares each resource exactly once', () => {
      const declared = plan.limits.map((l) => l.resource);
      expect(new Set(declared).size).toBe(declared.length);
    });

    it('uses only period values the quota logic understands', () => {
      for (const limit of plan.limits) {
        expect(['monthly', 'lifetime']).toContain(limit.period);
      }
    });

    it('has a price and a Stripe price-id variable', () => {
      expect(plan.monthlyPrices[SaasService.baseCurrency()]).toBeGreaterThan(0);
      expect(plan.monthlyPriceIdVar).toMatch(/^STRIPE_PRICE_/);
    });

    it('prices every currency in whole minor units', () => {
      for (const [currency, amount] of Object.entries(plan.monthlyPrices)) {
        expect(currency).toMatch(/^[A-Z]{3}$/);
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      }
    });
  });

  describe('the tiers are actually ordered', () => {
    const limitFor = (slug: string, resource: SaasResource) => {
      const value = SAAS_PLANS.find((p) => p.slug === slug)!.limits.find(
        (l) => l.resource === resource,
      )!.limit;
      // -1 means unlimited; compare it as the largest possible value.
      return value === -1 ? Number.POSITIVE_INFINITY : value;
    };

    it.each(resources)('never gives a cheaper tier more %s than a dearer one', (resource) => {
      // A pricing table where the cheap plan wins on some axis is a table nobody proofread.
      expect(limitFor('starter', resource)).toBeLessThanOrEqual(limitFor('pro', resource));
      expect(limitFor('pro', resource)).toBeLessThanOrEqual(limitFor('enterprise', resource));
    });

    it('makes enterprise unlimited on every resource', () => {
      for (const limit of SAAS_PLANS.find((p) => p.slug === 'enterprise')!.limits) {
        expect(limit.limit).toBe(-1);
      }
    });

    it('withholds group consolidation from the entry tier', () => {
      expect(limitFor('starter', SaasResource.SUBSIDIARIES)).toBe(0);
    });
  });

  /**
   * A market is quoted in its own currency only when EVERY plan carries an amount for it.
   *
   * Without this, one plan could be priced in COP and the next fall back to USD on the same
   * screen — or, worse, be quoted locally and charged in the Stripe Price's default currency,
   * which is the defect this whole table exists to remove.
   */
  describe('currency coverage is all-or-nothing', () => {
    const currencies = new Set(SAAS_PLANS.flatMap((p) => Object.keys(p.monthlyPrices)));

    it.each([...currencies])('%s is priced on every plan or on none', (currency) => {
      const priced = SAAS_PLANS.filter((p) => typeof p.monthlyPrices[currency] === 'number');
      expect(priced.length).toBe(SAAS_PLANS.length);
    });

    it('always prices the base currency', () => {
      for (const plan of SAAS_PLANS) {
        expect(plan.monthlyPrices[SaasService.baseCurrency()]).toBeGreaterThan(0);
      }
    });

    it('only offers a market its own currency when every plan carries it', () => {
      // Mexico has no MXN amount configured, so it must be quoted in the base currency rather
      // than relabelled — the exact bug: "$49" shown, 4.900 MXN charged.
      expect(SaasService.currencyForCountry('MX')).toBe(SaasService.baseCurrency());
      expect(SaasService.currencyForCountry('US')).toBe('USD');
      // An unknown market falls back rather than guessing.
      expect(SaasService.currencyForCountry('ZZ')).toBe(SaasService.baseCurrency());
      expect(SaasService.currencyForCountry(undefined)).toBe(SaasService.baseCurrency());
    });

    it('quotes an amount that exists for the currency it resolved', () => {
      for (const plan of SAAS_PLANS) {
        const currency = SaasService.currencyForCountry('CL');
        expect(SaasService.priceFor(plan.slug, currency)).toBeGreaterThan(0);
      }
    });
  });

  describe('minor units', () => {
    it('treats CLP and PYG as zero-decimal, and the rest as hundredths', () => {
      expect(minorUnitFactor('CLP')).toBe(1);
      expect(minorUnitFactor('PYG')).toBe(1);
      expect(minorUnitFactor('USD')).toBe(100);
      expect(minorUnitFactor('COP')).toBe(100);
      expect(minorUnitFactor('mxn')).toBe(100);
    });
  });
});
