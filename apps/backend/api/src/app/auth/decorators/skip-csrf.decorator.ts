import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Exempt a route from CSRF validation.
 *
 * Use it only where the request carries its own proof of intent and cannot come from a browser
 * riding an ambient session:
 *
 *   - a webhook authenticated by a provider's signature over the raw body (Stripe);
 *   - a flow whose token IS the credential and whose caller has no session yet — password reset,
 *     invitation acceptance — where OWASP explicitly exempts a one-time secret from needing a
 *     second anti-CSRF token, and where requiring one would be impossible anyway because the user
 *     has never had an XSRF cookie.
 *
 * Every exemption must say which of those it is. "It was easier" is not one of them: CSRF is now
 * enforced by an APP_GUARD, precisely because declaring it per-endpoint left 46 of 50
 * state-changing controllers without it.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
