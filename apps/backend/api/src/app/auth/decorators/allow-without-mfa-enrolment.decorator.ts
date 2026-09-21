import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_MFA_ENROLMENT_KEY = 'allowWithoutMfaEnrolment';

/**
 * Reachable by a session that is being held pending MFA enrolment.
 *
 * `MfaEnrolmentGuard` denies by default, so this marks the narrow set of routes a held session
 * must still reach: the enrolment flow itself, the step-up challenge it needs, signing out, and
 * the session bootstrap the client calls to discover it is held.
 *
 * The `reason` is mandatory for the same purpose it is on `@AuthenticatedOnly`: an exemption
 * somebody had to justify in a sentence is one a reviewer can agree or disagree with, whereas an
 * exemption with no text is indistinguishable from an oversight.
 */
export const AllowWithoutMfaEnrolment = (reason: string) =>
  SetMetadata(ALLOW_WITHOUT_MFA_ENROLMENT_KEY, reason);
