import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { HttpRequest as Request } from '../../common/http/http.types';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ALLOW_INACTIVE_SUBSCRIPTION_KEY } from '../decorators/allow-inactive-subscription.decorator';
import { ForbiddenError } from '../../i18n/localized.exception';

/**
 * Refuse work for a tenant whose subscription is not in good standing.
 *
 * Declared per-controller, this reached exactly one of the sixty-seven controllers in the
 * application — invoices. Everything else in the product (accounting, inventory, payroll,
 * manufacturing, procurement, projects) was free forever once a subscription lapsed. A per-endpoint
 * entitlement check is not an entitlement model; it is a suggestion, and the sixty-six controllers
 * that never received it are the evidence.
 *
 * It also failed open in two ways that mattered more than the coverage. `if (!user.organization)
 * return true` let any request whose principal happened to lack an organization through, and the
 * cached principal is a projection that can legitimately omit it. And `if (status && ...)` skipped
 * the check entirely when `subscriptionStatus` was null — which is precisely the state of an
 * organization that never completed checkout. The least-provisioned tenant was the least
 * restricted one.
 *
 * Now: global, and closed by default. A route that a suspended customer must still reach — paying,
 * seeing the invoice, exporting their data, signing out — says so with
 * `@AllowInactiveSubscription()`, which is a decision visible in the diff rather than an omission
 * that nobody notices.
 */
@Injectable()
export class SubscriptionActiveGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionActiveGuard.name);

  /**
   * Statuses that permit work.
   *
   * `past_due` is deliberate: Stripe retries a failed payment for roughly two weeks, and cutting a
   * paying customer off on the first declined card costs far more than the two weeks of service.
   * `unpaid`, `canceled`, `incomplete` and `incomplete_expired` are terminal or pre-payment and do
   * not.
   */
  private static readonly ALLOWED_STATUSES: ReadonlySet<string> = new Set([
    'active',
    'trialing',
    'past_due',
  ]);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE_SUBSCRIPTION_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & { user?: { id?: string; organization?: { id?: string; subscriptionStatus?: string | null; gracePeriodEnd?: Date | null } } }
    >();
    const user = request.user;

    // No principal on a non-public route means the auth guard already rejected it, or a
    // misconfiguration. Either way there is no tenant whose entitlement can be checked.
    if (!user) {
      return true;
    }

    const organization = user.organization;
    if (!organization) {
      this.logger.error(
        { event: 'entitlement_no_organization', userId: user.id, url: request.url },
        '[BILLING] Authenticated principal has no organization; refusing.',
      );
      throw new ForbiddenError('SAAS.SUBSCRIPTION_REQUIRED');
    }

    const status = organization.subscriptionStatus;

    if (!status) {
      // An organization with no subscription status never completed checkout. Registration is
      // payment-first and always records one, so this is a provisioning fault — and the previous
      // code treated it as a free pass.
      this.logger.error(
        { event: 'entitlement_no_status', organizationId: organization.id, url: request.url },
        '[BILLING] Organization has no subscription status; refusing.',
      );
      throw new ForbiddenError('SAAS.SUBSCRIPTION_REQUIRED');
    }

    if (SubscriptionActiveGuard.ALLOWED_STATUSES.has(status)) {
      return true;
    }

    // A grace period explicitly granted by an operator outlives the status, and is the one way a
    // lapsed tenant keeps working — deliberately, with an end date, rather than by accident.
    const graceEnd = organization.gracePeriodEnd ? new Date(organization.gracePeriodEnd) : null;
    if (graceEnd && graceEnd > new Date()) {
      return true;
    }

    this.logger.warn(
      { event: 'entitlement_denied', organizationId: organization.id, status, url: request.url },
      '[BILLING] Refusing request for a tenant whose subscription is not in good standing.',
    );
    throw new ForbiddenError('SAAS.SUBSCRIPTION_SUSPENDED', { status });
  }
}
