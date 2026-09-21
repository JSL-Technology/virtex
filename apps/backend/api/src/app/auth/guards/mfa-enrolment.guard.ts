import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../../security/principal';
import { ForbiddenError } from '../../i18n/localized.exception';
import { ALLOW_WITHOUT_MFA_ENROLMENT_KEY } from '../decorators/allow-without-mfa-enrolment.decorator';

/**
 * Holds a session to enrolment-only while its organization requires a second factor the member
 * does not yet have.
 *
 * ## Why a restricted session rather than a refused login
 *
 * Enrolling a second factor requires being signed in: `POST /auth/2fa/generate` is an
 * authenticated route and its step-up challenge is the account password. Refusing the sign-in
 * outright would therefore tell the user to do something they cannot do — the same dead end the
 * SSO step-up path documents, where accounts were told to "enable two-step verification" for an
 * action that itself required two-step verification.
 *
 * So the session is issued and then narrowed. The token carries `mfaEnrolmentRequired`, this guard
 * denies everything that is not on the enrolment path, and the moment the factor is enrolled the
 * next sign-in issues an ordinary session.
 *
 * ## Why the exemption is a decorator and not a URL list
 *
 * A path allow-list in this file would be a second place routes are described, and it would drift
 * from the routes themselves the first time one was renamed. `@AllowWithoutMfaEnrolment(reason)`
 * puts the exemption on the handler, next to what it exempts, and makes the author write down why
 * — the same shape as `@AuthenticatedOnly(reason)` and `@AllowInactiveSubscription()`.
 *
 * ## Order
 *
 * Registered after `PermissionsGuard`, so a route the caller could not reach anyway is refused for
 * the reason it is actually refused for, and before `SubscriptionActiveGuard`, because "you must
 * enrol" is a truer answer than "your subscription lapsed" for someone who cannot act at all.
 */
@Injectable()
export class MfaEnrolmentGuard implements CanActivate {
  private readonly logger = new Logger(MfaEnrolmentGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    // No session (a @Public() route), or a session that is not held: nothing to do.
    if (!user?.mfaEnrolmentRequired) return true;

    const exemptionReason = this.reflector.getAllAndOverride<string>(
      ALLOW_WITHOUT_MFA_ENROLMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exemptionReason) return true;

    this.logger.log(
      { event: 'mfa_enrolment_required', userId: user.id, organizationId: user.organizationId },
      'Request held: the organization requires a second factor this member has not enrolled',
    );
    throw new ForbiddenError('auth.mfa_required_by_organization');
  }
}
