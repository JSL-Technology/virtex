import { SAAS_PLANS } from './saas.config';
import { SaasResource } from './enums/saas-resource.enum';

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
      expect(plan.monthlyPrice).toBeGreaterThan(0);
      expect(plan.monthlyPriceIdVar).toMatch(/^STRIPE_PRICE_/);
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
});
