import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../../interfaces/authenticated-user.interface';

/**
 * Resolves the access token when one is present, and lets the request through when it is not.
 *
 * `JwtAuthGuard` answers a different question: "is this caller allowed in?". Rejection there is
 * the correct outcome, and 401 is the correct way to say it. But a route whose entire purpose is
 * to REPORT whether a session exists has no such thing as an unauthorised caller — "nobody is
 * signed in" is a valid answer to that question, not a failure to answer it. Modelling it with
 * `JwtAuthGuard` turned every anonymous page load into a 401 on the login screen: an error in the
 * browser console, in the access log and in any error-rate alert, describing the single most
 * common state the application is ever in.
 *
 * Overriding `handleRequest` so it returns `null` instead of throwing is the documented way to
 * express that. Passport still extracts, verifies signature/issuer/audience/expiry and resolves
 * the principal through the very same `JwtStrategy`, so an INVALID token yields `null` here
 * exactly as a missing one does — there is no second, weaker verification path to drift out of
 * sync with the real one.
 *
 * Use it only for endpoints that must answer identically to everyone and expose nothing that a
 * signed-out caller may not see. Everything else keeps `JwtAuthGuard`.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser | null {
    return user || null;
  }
}
