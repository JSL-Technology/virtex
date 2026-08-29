import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionActiveGuard } from './subscription-active.guard';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ALLOW_INACTIVE_SUBSCRIPTION_KEY } from '../decorators/allow-inactive-subscription.decorator';

/**
 * Entitlement, stated as behaviour.
 *
 * The guard this replaces was applied to 1 of the application's 67 controllers, and it failed open
 * twice over: it returned true when the principal had no organization, and it skipped the check
 * entirely when `subscriptionStatus` was null — the exact state of an organization that never
 * completed checkout. The least-provisioned tenant was the least restricted.
 */
describe('SubscriptionActiveGuard', () => {
  const metadata: Record<string, boolean> = {};

  const reflector = {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;

  const guard = new SubscriptionActiveGuard(reflector);

  const context = (user: unknown): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user, url: '/api/v1/anything' }) }),
    }) as unknown as ExecutionContext;

  const withStatus = (subscriptionStatus: string | null, gracePeriodEnd: Date | null = null) => ({
    id: 'user-1',
    organization: { id: 'org-1', subscriptionStatus, gracePeriodEnd },
  });

  beforeEach(() => {
    for (const key of Object.keys(metadata)) delete metadata[key];
  });

  describe('statuses that permit work', () => {
    it.each(['active', 'trialing'])('allows %s', (status) => {
      expect(guard.canActivate(context(withStatus(status)))).toBe(true);
    });

    it('allows past_due — Stripe retries a failed payment for about two weeks', () => {
      // Cutting a paying customer off on the first declined card costs far more than the two
      // weeks of service it saves.
      expect(guard.canActivate(context(withStatus('past_due')))).toBe(true);
    });
  });

  describe('statuses that do not', () => {
    it.each(['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])(
      'refuses %s',
      (status) => {
        expect(() => guard.canActivate(context(withStatus(status)))).toThrow(ForbiddenException);
      },
    );

    it('refuses a null status rather than treating it as a free pass', () => {
      // Registration is payment-first and always records a status, so null means the tenant was
      // never provisioned properly. The previous guard let it through.
      expect(() => guard.canActivate(context(withStatus(null)))).toThrow(ForbiddenException);
    });

    it('refuses a principal with no organization', () => {
      // The cached principal is a projection and can legitimately omit the organization, so
      // `if (!user.organization) return true` was a bypass anyone could reach.
      expect(() => guard.canActivate(context({ id: 'user-1' }))).toThrow(ForbiddenException);
    });
  });

  describe('grace period', () => {
    it('allows a lapsed tenant inside an explicitly granted grace period', () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expect(guard.canActivate(context(withStatus('unpaid', future)))).toBe(true);
    });

    it('refuses once the grace period has passed', () => {
      const past = new Date(Date.now() - 1000);
      expect(() => guard.canActivate(context(withStatus('unpaid', past)))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('exemptions', () => {
    it('lets public routes through', () => {
      metadata[IS_PUBLIC_KEY] = true;
      expect(guard.canActivate(context(undefined))).toBe(true);
    });

    it('lets a route marked @AllowInactiveSubscription() through', () => {
      // Billing, plans, authentication and organization switching: the routes a suspended
      // customer must reach in order to stop being suspended.
      metadata[ALLOW_INACTIVE_SUBSCRIPTION_KEY] = true;
      expect(guard.canActivate(context(withStatus('canceled')))).toBe(true);
    });

    it('does not run outside HTTP', () => {
      const wsContext = { getType: () => 'ws' } as unknown as ExecutionContext;
      expect(guard.canActivate(wsContext)).toBe(true);
    });
  });
});
