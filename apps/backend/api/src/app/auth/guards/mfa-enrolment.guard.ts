import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../../security/principal';
import { ForbiddenError } from '../../i18n/localized.exception';
import { ALLOW_WITHOUT_MFA_ENROLMENT_KEY } from '../decorators/allow-without-mfa-enrolment.decorator';
import { MfaPolicyPort } from '../ports/mfa-policy.port';

/**
 * Holds a session to the enrolment path while its organization requires a second factor the
 * member has not enrolled.
 *
 * ## Derived per request, not carried in the token
 *
 * The decision used to be minted once, at sign-in, as a `mfaEnrolmentRequired` claim — and every
 * other place that issues tokens had to remember to carry it. None of them did: a refresh, a
 * tenant switch or an invitation-redeemed sign-in each produced a token without it, so a single
 * `POST /auth/refresh` lifted the hold. It was also decided for the HOME organization only, so a
 * member acting in another tenant (by the `x-virtex-organization` header) was never held by that
 * tenant's policy at all.
 *
 * A security decision that depends on every issuer remembering a claim is one issuer away from
 * being bypassed, so it is not a claim any more. It is asked here, on every request, about the
 * organization the request ACTS in (`ActiveTenantGuard` has already resolved it) and about the
 * member's real second-factor state (the principal is re-read from the cached projection, which
 * enabling 2FA evicts). The policy lookup is cached by `MfaPolicyPort`.
 *
 * ## Failing closed
 *
 * If the policy cannot be read, the request is held. The enrolment path and sign-out stay
 * reachable, so a transient failure costs a moment of friction, never access that a tenant turned
 * off.
 *
 * ## Impersonation
 *
 * A session an operator opened by impersonation is not held. The operator authenticated as
 * themselves, under their own organization's policy, and passed a single-use step-up to begin; the
 * impersonated person's missing factor says nothing about who is at the keyboard, and the operator
 * cannot enrol a factor on someone else's behalf.
 */
@Injectable()
export class MfaEnrolmentGuard implements CanActivate {
  private readonly logger = new Logger(MfaEnrolmentGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly mfaPolicy: MfaPolicyPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user?.organizationId) return true;
    if (user.isImpersonating) return true;

    const held = !user.isTwoFactorEnabled && (await this.organizationRequiresMfa(user));
    user.mfaEnrolmentRequired = held;
    if (!held) return true;

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

  private async organizationRequiresMfa(user: AuthenticatedUser): Promise<boolean> {
    try {
      return await this.mfaPolicy.requiresMfa(user.organizationId);
    } catch (error) {
      this.logger.error(
        { event: 'mfa_policy_unavailable', organizationId: user.organizationId },
        `MFA policy could not be read; holding the request: ${(error as Error).message}`,
      );
      return true;
    }
  }
}
