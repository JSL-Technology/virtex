import { Logger } from '@nestjs/common';
import { MfaPolicyPort } from '../ports/mfa-policy.port';

/**
 * The `mfaEnrolmentRequired` claim every successful authentication must carry.
 *
 * Three call sites mint a session on success — password login, social login, enterprise SSO —
 * and each one has to ask this same question before doing so. A hold that only the password path
 * checked is a hold social login and SSO bypassed entirely: an unenrolled member of an
 * MFA-required organization signed in through either and received an unrestricted token
 * `MfaEnrolmentGuard` never saw reason to narrow. One function, called from all three, so the
 * answer cannot drift between them the way five different `NODE_ENV` comparisons once did.
 *
 * Fails OPEN by explicit trade-off: the setting is a tenant policy, not a credential, and a
 * settings row that cannot be read must not stop a user who has already proven their identity
 * from signing in. It degrades for everyone equally and is restored with the read.
 */
export async function resolveMfaEnrolmentClaim(
  mfaPolicy: MfaPolicyPort,
  organizationId: string | null | undefined,
  logger: Logger,
): Promise<{ mfaEnrolmentRequired: true } | Record<string, never>> {
  if (!organizationId) return {};
  try {
    const required = await mfaPolicy.requiresMfa(organizationId);
    return required ? { mfaEnrolmentRequired: true } : {};
  } catch (error) {
    logger.warn(
      { event: 'mfa_policy_unavailable', organizationId },
      `Could not read the organization MFA policy: ${(error as Error).message}`,
    );
    return {};
  }
}
