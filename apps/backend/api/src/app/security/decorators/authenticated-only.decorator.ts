import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ONLY_KEY = 'authenticatedOnly';

/**
 * The route needs a signed-in user and nothing more.
 *
 * `PermissionsGuard` is registered as an `APP_GUARD` and denies by default: a route that declares
 * no permission is refused, not allowed. That default is the whole point — the alternative was
 * tried and measured, and it does not hold. `CsrfGuard` and `SubscriptionActiveGuard` reached
 * "4 of 50" and "1 of 67" controllers while they were opt-in, and the permission decorator itself
 * reached 47 of 76: not because anyone decided those routes were open, but because a control you
 * have to remember is a control you forget. Ninety-eight of those routes were not decisions at
 * all, and among them were creating a product, editing a supplier and reading the finance
 * dashboard.
 *
 * So a route with no permission requirement must now say so out loud, and say why. The reason is
 * a required argument because the useful question is never "does this route have a decorator" but
 * "would a reviewer agree with this one" — and a reviewer cannot answer that from
 * `@AuthenticatedOnly()` alone.
 *
 * Legitimate uses are narrow, and they share a shape: the route's authorisation IS the identity of
 * the caller, so a permission would be redundant.
 *
 *  - **Self-service.** Reading or changing your own profile, your own sessions, your own MFA
 *    factors. The subject and the object are the same person.
 *  - **Session mechanics.** Step-up verification, WebAuthn registration, tenant switch. These
 *    establish or refine the identity that later permission checks read.
 *  - **Session-scoped reads.** Your work queue, your notifications, global search — each already
 *    filtered to what the caller can see, by the same permissions applied downstream.
 *  - **Infrastructure.** Health and configuration endpoints that expose no tenant data.
 *
 * It is NOT for "this one is harmless" or "the frontend never calls it without the right role".
 * A route that reads or writes tenant business data takes a permission, including when today's
 * only caller is a screen that already checks one — the API is reachable without that screen.
 *
 * @param reason Why this route needs no permission beyond being signed in. Written for the
 *               reviewer who will read it in a year, not for the linter.
 */
export const AuthenticatedOnly = (reason: string) =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, reason);
